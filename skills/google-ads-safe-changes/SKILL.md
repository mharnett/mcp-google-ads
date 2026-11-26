---
name: google-ads-safe-changes
description: "When the user wants an agent to change a Google Ads account through the mcp-google-ads server: create campaigns, ad groups, ads, keywords or asset links, enable or pause them, change budgets, bids, URLs or settings, or remove anything. Use before turning on write mode, before enabling anything, and whenever a write tool refuses or returns a dry-run preview. Covers the guardrails the server enforces (read-only by default, everything created PAUSED, claude-MM-DD-YY audit labels, dry-run confirm flags, the 20% budget and bid ceiling, expected_old, the lead-form gate) and the one it leaves to the agent: getting the user's explicit yes before anything goes live."
metadata:
  version: 1.0.0
  author: Mark Harnett
  requires: "mcp-google-ads; write tools need GOOGLE_ADS_MCP_WRITE=true in the server environment"
  writes: true
---

# Google Ads Safe Changes

How to change a Google Ads account through the
[mcp-google-ads](https://github.com/mharnett/mcp-google-ads) server without
anything going live, or spending more, by accident.

Most of the guardrails below are enforced by the server: a call that breaks
them is refused or returns a preview. One is not. The server never asks
before it enables something; it states that enabling **requires user
approval** and leaves the asking to you. Each rule says which kind it is.

## 1. The rules

1. **Read-only until the user opts in** (server). Write tools are hidden from
   the tool list until `GOOGLE_ADS_MCP_WRITE=true` is set in the MCP server's
   environment. A write tool called without it returns an error naming that
   variable. Don't set it yourself, and don't ask for it to finish a task that
   only reads.
2. **New things are created PAUSED** (server). Campaigns, ad groups,
   responsive search ads, keywords, Demand Gen ads and asset links
   (sitelinks, callouts, structured snippets, lead forms) all land PAUSED and
   serve only once enabled.
3. **Nothing goes live without the user's explicit yes** (you). The tools
   that enable campaigns, ad groups, ads and keywords, and the one that pauses
   them, say REQUIRES USER APPROVAL, but when called they act. Name exactly
   what will change, wait for a clear yes, and treat each batch as its own
   approval. If your MCP client asks permission per tool call, that prompt is
   a second check, not a substitute.
4. **Every change carries an audit label** (server). Creates and edits stamp
   `claude-MM-DD-YY` (the America/Los_Angeles date) on the campaign, ad group,
   ad or keyword they touch. Budgets, campaign criteria, negatives and asset
   links can't carry a label, so their campaign or ad group gets it. Assets
   and shared sets can't be labeled at all, and the tool result says so.
5. **`confirm: true` is the change; everything before it is a preview**
   (server). A tool with a `confirm` parameter changes nothing until you pass
   `confirm: true`. Omit it first, show the user the preview, then apply. A
   write tool without a `confirm` parameter writes on its first call.
6. **Big budget and bid moves need a stated reason** (server). Budget and
   bidding updates refuse a change larger than 20% unless you pass
   `confirm_large_change: true` and a non-empty `reason`. Every override is
   logged.
7. **Say what you think you're overwriting** (server, opt-in). Update tools
   accept `expected_old`, the value you read. If the live value differs, the
   tool refuses, returns current versus expected and writes nothing.
8. **Lead forms only when the user asked for one** (server). Creating a lead
   form, linking one and enabling a lead-form link all refuse without
   `explicit_lead_form_request=true`. Pass it only when the user asked for a
   lead form in so many words.

## 2. The workflow

Work the steps in order. Each names the tools it uses.

### 2.1 Pin the account

Call `google_ads_get_client_context` with the working directory, or pass
`customer_id` to every call. The server picks the account from the working
directory, so say which account you are about to change before the first
write.

### 2.2 Read the current state

Read before you write, and keep what you read: it is your `expected_old`
later. Use `google_ads_list_campaigns`, `google_ads_list_ad_groups`,
`google_ads_get_campaign_tracking` and `google_ads_gaql_query`.

- A result returned as `{ rows, truncated: true, ... }` is partial. Narrow the
  query and re-run before counting or totalling anything.
- When reading which campaigns a shared negative list is linked to, filter
  `campaign_shared_set.status = 'ENABLED'`. Without it, links that were
  removed come back looking attached, and the server adds a warning to the
  result.

### 2.3 Validate ads before creating them

`google_ads_validate_ad` checks a responsive search ad without creating it:
3 to 15 headlines of up to 30 characters, 2 to 4 descriptions of up to 90,
at least one final URL, both display paths of up to 15 characters, and at
least one label. It also holds the server's house floor of 15 headlines and
4 descriptions unless you pass `allow_partial_assets: true`.
`google_ads_create_responsive_search_ad` runs the same checks before it
creates.

### 2.4 Create, which lands PAUSED

`google_ads_create_campaign`, `google_ads_create_ad_group`,
`google_ads_create_responsive_search_ad`, `google_ads_create_keywords` and
`google_ads_create_demand_gen_multi_asset_ad` create PAUSED items.
`google_ads_create_demand_gen_multi_asset_ad` also refuses a logo whose asset
name reads as a photo of a person; `allow_person_photo_logos: true` skips that
check.

Asset links are dry-run first and PAUSED once made:
`google_ads_link_asset_to_campaign`, `google_ads_link_asset_to_ad_group` and
`google_ads_link_asset_to_customer` preview without `confirm: true` and
create the link PAUSED with it.

### 2.5 Show the user what is pending

`google_ads_list_pending_changes` lists PAUSED campaigns, ad groups, ads and
keywords that carry a `claude-` label. If the result says `truncated: true`, it
is partial: read the rest with `entity_type` and `offset` set to each
`next_offset`, or narrow it with `label`. It does not list asset links; report
those from the create results. Give the user the name of each item, and ask
them to review it in the Google Ads UI or Editor.

### 2.6 Enable only after an explicit yes

Enabled means live and spending. After the user says yes to a named list:

- `google_ads_enable_items` enables campaigns, ad groups or ads.
- `google_ads_enable_keywords` enables keywords by criterion resource name.
- `google_ads_enable_asset_links` enables PAUSED asset links by the resource
  names the link tools returned. It is dry-run until `confirm: true`, and a
  lead-form link also needs `explicit_lead_form_request=true`. Enabling an ad
  group's first ad-group sitelink switches its campaign-level sitelinks off
  there.

Pausing stops serving and needs the same yes: `google_ads_pause_items`,
`google_ads_pause_keywords` and `google_ads_pause_asset_links`.

### 2.7 Change budgets and bids inside the ceiling

- `google_ads_update_campaign_budget` reads the current budget first and
  refuses a change larger than 20% either way.
- `google_ads_update_campaign_bidding` refuses a target change larger than
  20%, and any change that removes a target or switches off a target-based
  strategy.

Either can pass with `confirm_large_change: true` and a non-empty `reason`,
and each override is logged (`GOOGLE_ADS_MCP_OVERRIDE_LOG`). Use that only
after the user has seen the before and after numbers and given the reason.
Pass `expected_old` with the value you read in 2.2.

Neither tool will silently break a portfolio bid strategy.
`google_ads_detach_portfolio_bid_strategy` is the only way, it is
irreversible, and it needs `confirm: true`.

### 2.8 Preview every other edit

Many edit tools are dry-run by default, for example
`google_ads_update_campaign_network_settings`,
`google_ads_update_recommendation_subscriptions`,
`google_ads_update_ad_final_urls` and `google_ads_rename_campaign`. Call once
without `confirm`, show the preview, then call again with `confirm: true`.

Others have no `confirm` and write on the first call, for example
`google_ads_update_campaign_tracking`, `google_ads_update_campaign_ad_urls`,
`google_ads_add_campaign_negatives` and `google_ads_promote_experiment` (which
makes the treatment arm the permanent campaign). For these, show the user the
exact change and get the yes before the call, not after.

`google_ads_update_asset_urls` changes the URL on every campaign, ad group
and account link that uses the asset, so check where the asset is linked
(`google_ads_gaql_query` on `campaign_asset`, `ad_group_asset` and
`customer_asset`) before you confirm.

### 2.9 Remove last

`google_ads_remove_items` is irreversible at the API level. It is dry-run
until `confirm: true`, labels each item before removing it so the audit trail
survives, and removes children before parents. Pausing is the reversible
alternative; say so when the user asks for a removal.

### 2.10 Find and undo a day's changes

The label is the rollback key. Find what was changed on a day with
`google_ads_gaql_query`, for example:

```sql
SELECT campaign.id, campaign.name, campaign.status, label.name
FROM campaign
WHERE label.name LIKE 'claude-11-23-26%'
```

Run the same shape `FROM ad_group` and `FROM ad_group_ad`. Then pause what
went wrong with `google_ads_pause_items`, after the user's yes. Assets and
shared sets carry no label, so keep your own list of the ones you created.

## 3. When a write is refused

| The tool says | What it means | Do this |
|---|---|---|
| Write operations are disabled. Set GOOGLE_ADS_MCP_WRITE=true ... | Write mode is off | Tell the user. Only they turn it on, in the server's environment. |
| A preview, not a result | `confirm` was omitted | Nothing changed. Show the preview; apply with `confirm: true` after a yes. |
| ... exceeding the ... ceiling, or ... removes an existing target | Budget or bid change over the 20% ceiling, or a bidding change that loosens a target | Make a smaller change, or get the user's reason and pass `confirm_large_change: true` with it. |
| expected_old does not match the live value ... No write was made | Someone or something changed it since you read it | Re-read, show the user the new value, and retry only if they still want the change. |
| A lead-form refusal | `explicit_lead_form_request` was not passed | Stop unless the user asked for a lead form. |
