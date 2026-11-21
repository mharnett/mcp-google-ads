---
name: google-ads-program-audit
description: "When the user wants to audit a stalled or underperforming B2B Google Ads program, run a Google Ads account audit, or asks 'why isn't our Google Ads working', especially in a program's first 90 days. Use for a B2B paid search review, a new-account health check or a Google Ads postmortem. Checks setup before assets: what the bidder is trained on, whether CRM outcomes reach it, auto-applied recommendations, broad match and negatives, Search Partners and Display expansion, Performance Max and AI Max, location targeting, landing-page destinations and budget limits; then offer, message and landing page. Ends in a stated theory of what to change next. Every check is a read-only call to the mcp-google-ads server."
metadata:
  version: 1.0.0
  author: Mark Harnett
  requires: "mcp-google-ads (read-only tools only; write mode not needed)"
---

# Google Ads Program Audit

A runnable audit for a B2B Google Ads program that has stalled in its first
90 days. Work the sections in order. Setup comes before assets: a bidder
trained on the wrong signal, or traffic leaking to the wrong network or
country, caps every copy and landing-page fix. The audit must end in a stated
theory of what to change next, not a list of everything that could be better.

Every check is a read-only call to the
[mcp-google-ads](https://github.com/mharnett/mcp-google-ads) server. Nothing
here changes the account.

## 1. Before you start

- **Pin the account.** Call `google_ads_get_client_context`, or pass
  `customer_id` to every call, and say which account you are auditing.
- **Pick the windows.** Use the last 90 days for totals and a weekly trend of
  at least 6 weeks for anything you call a change. One week's swing is usually
  noise that reverts.
- **Keep history whole.** Include paused and removed campaigns, keywords and
  ads when reading past spend. The report tools already do. In raw GAQL, never
  filter historical metrics on current status.
- **Split brand from non-brand** before judging any cost per lead. Brand
  search is cheap because the buyer already knows you, so a low brand cost per
  lead says little about whether the program creates demand.
- **Ask for the CRM number.** Get the qualified outcome (SQL, opportunity or
  pipeline) by campaign if the user has it. Platform conversions and CRM
  pipeline measure different things. Both are evidence; a gap between them is
  not a discrepancy to reconcile.

**Reading results.** The server returns enum fields as numbers
(`status: 2`). Filter on enum names in the WHERE clause
(`campaign.status = 'ENABLED'`) so every returned row already matches, rather
than decoding numbers. GAQL has no `LAST_90_DAYS`: use
`segments.date BETWEEN '<start>' AND '<end>'`. Money is in micros (divide by
1,000,000). GAQL has no `OR`, so run a second query instead.

## 2. Setup checks

Each check says what to run, what a red flag looks like and what to do.

### 2.1 What the bidder is trained on

Smart Bidding optimizes toward whatever is marked Primary. In B2B, a Primary
newsletter signup, page view or content download teaches the bidder to buy
cheap, unqualified engagement.

**Run** (`google_ads_gaql_query`): Primary actions that are micro or
engagement actions, and Primary actions that count every conversion per click.

```sql
SELECT conversion_action.name, conversion_action.primary_for_goal
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
  AND conversion_action.primary_for_goal = TRUE
  AND conversion_action.category IN ('PAGE_VIEW', 'ENGAGEMENT', 'OUTBOUND_CLICK',
      'DOWNLOAD', 'SIGNUP', 'GET_DIRECTIONS', 'CONTACT')
```

```sql
SELECT conversion_action.name
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
  AND conversion_action.primary_for_goal = TRUE
  AND conversion_action.counting_type = 'MANY_PER_CLICK'
```

Then list every action with `google_ads_list_conversion_actions` and read the
names. Category is often left at DEFAULT, so a "Whitepaper Download" can hide
there. Finally, check what each campaign actually bids on:

```sql
SELECT campaign.name, campaign_conversion_goal.category, campaign_conversion_goal.origin
FROM campaign_conversion_goal
WHERE campaign.status = 'ENABLED' AND campaign_conversion_goal.biddable = TRUE
```

- **Red flag:** a micro or engagement action is Primary on Performance Max,
  Display or Demand Gen; a lead action counts every conversion per click
  instead of one.
- **Do:** make the deliberate action (demo request, contact sales, qualified
  lead) the only Primary on broad-reach campaigns and keep the rest Secondary
  for reporting. Engagement as a bidding signal is defensible only on brand or
  tight non-brand Search, and then watch the conversion mix.

### 2.2 Whether CRM outcomes reach the bidder

A form fill is a proxy. If qualified-lead or opportunity stages never come
back into Google Ads, the bidder cannot tell a real buyer from a student.

**Run** (`google_ads_gaql_query`): imported actions, whether each action is
still receiving data, and auto-tagging.

```sql
SELECT conversion_action.name
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
  AND conversion_action.type IN ('UPLOAD_CLICKS', 'UPLOAD_CALLS', 'SALESFORCE')
```

```sql
SELECT segments.conversion_action_name, segments.week, metrics.all_conversions
FROM customer
WHERE segments.date BETWEEN '<start>' AND '<end>' AND metrics.all_conversions > 0
```

```sql
SELECT customer.auto_tagging_enabled FROM customer
```

- **Red flag:** no imported action at all; an imported action whose weekly
  counts stopped; auto-tagging off, so there is no click ID to match a CRM
  record back to.
- **Do:** import the first qualified CRM stage as a conversion. Keep it
  Secondary and watch it next to the form-fill count until it has enough
  monthly volume for the bidder to learn from, then make it the Primary.

### 2.3 Auto-applied recommendations

Auto-apply can raise budgets, switch match types and add keywords without
anyone deciding to.

**Run** (`google_ads_gaql_query`): enabled subscriptions, then what
recommendations and automated rules changed in the last 30 days.
`change_event` only covers the last 30 days and needs both date bounds and a
LIMIT.

```sql
SELECT recommendation_subscription.type
FROM recommendation_subscription
WHERE recommendation_subscription.status = 'ENABLED'
```

```sql
SELECT change_event.change_date_time, change_event.client_type,
       change_event.change_resource_type, change_event.resource_change_operation
FROM change_event
WHERE change_event.change_date_time >= '<30 days ago>'
  AND change_event.change_date_time <= '<today>'
  AND change_event.client_type IN ('GOOGLE_ADS_RECOMMENDATIONS',
      'GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION', 'GOOGLE_ADS_AUTOMATED_RULE')
LIMIT 1000
```

The subscription type is readable in each row's `resource_name`
(`.../recommendationSubscriptions/<TYPE>`). Some types read UNKNOWN through
the API, so confirm on the Recommendations, Auto-apply page in the UI.

- **Red flag:** an enabled subscription for keywords, broad match, bidding or
  budgets; changes in the log that nobody can account for.
- **Do:** turn off auto-apply for anything that changes targeting, bidding or
  spend, and review those recommendations by hand.

### 2.4 Broad match with few negatives

Broad match lets Google decide which queries a keyword covers. On a bidder
trained on a deliberate action with volume, that can work. On Manual CPC,
Maximize Clicks or a micro-conversion, it buys whatever is cheapest.

**Run** (`google_ads_gaql_query`): spend by match type (repeat with
`'PHRASE'` and `'EXACT'` and sum cost per type), campaign negatives and shared
negative lists.

```sql
SELECT ad_group_criterion.keyword.match_type, metrics.cost_micros, metrics.conversions
FROM keyword_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND ad_group_criterion.keyword.match_type = 'BROAD'
```

```sql
SELECT campaign.name, campaign_criterion.keyword.text
FROM campaign_criterion
WHERE campaign_criterion.negative = TRUE
  AND campaign_criterion.type = 'KEYWORD'
  AND campaign.status = 'ENABLED'
```

```sql
SELECT campaign.name, shared_set.name, shared_set.member_count
FROM campaign_shared_set
WHERE campaign_shared_set.status = 'ENABLED'
  AND shared_set.type = 'NEGATIVE_KEYWORDS'
  AND campaign.status = 'ENABLED'
```

Without the `campaign_shared_set.status` filter, removed list links come back
too. Then read the queries themselves with `google_ads_search_term_report`
over the same window.

- **Red flag:** most non-brand spend on broad match under a bidder that is
  not trained on a deliberate action; a campaign with no negatives and no
  shared list; job seekers, students, "free" and definition queries among the
  top spend.
- **Do:** move to phrase and exact until the bidder has a deliberate signal
  with volume, build a shared negative list from the search terms, and read
  search terms weekly.

### 2.5 Search Partners and Display expansion

Search campaigns can also serve on Google's search partner sites and on
Display. B2B buyers rarely convert there.

**Run** (`google_ads_gaql_query`): Search campaigns with partners switched on
(repeat with `target_content_network` for Display), then spend by network.

```sql
SELECT campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND campaign.network_settings.target_partner_search_network = TRUE
```

```sql
SELECT campaign.name, segments.ad_network_type, metrics.cost_micros, metrics.conversions
FROM campaign
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.ad_network_type IN ('SEARCH_PARTNERS', 'CONTENT')
  AND metrics.cost_micros > 0
```

- **Red flag:** Search campaigns spending on partners or Display with no
  qualified conversions there.
- **Do:** turn off Search Partners and Display expansion on non-brand Search
  until Google Search itself is working.

### 2.6 Performance Max and AI Max

Both hand query and placement choice to Google. Early in a program, without a
deliberate conversion with volume, they spend fast on the cheapest signal. AI
Max can serve on queries that share no words with your keywords, so negatives
and match types stop containing it.

**Run** (`google_ads_gaql_query`): Performance Max spend and bidding, AI Max
campaigns, and where traffic actually landed.

```sql
SELECT campaign.name, campaign.bidding_strategy_type, metrics.cost_micros, metrics.conversions
FROM campaign
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
```

```sql
SELECT campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED' AND campaign.ai_max_setting.enable_ai_max = TRUE
```

```sql
SELECT expanded_landing_page_view.expanded_final_url, metrics.clicks,
       metrics.cost_micros, metrics.conversions
FROM expanded_landing_page_view
WHERE segments.date BETWEEN '<start>' AND '<end>' AND metrics.clicks > 0
ORDER BY metrics.cost_micros DESC
```

Ignore the query string when comparing expanded URLs. For what Performance
Max matched, use `google_ads_search_term_insights` one campaign at a time.

- **Red flag:** Performance Max running before Search has a working
  deliberate conversion; Performance Max bidding on a micro-conversion; AI
  Max on brand or competitor campaigns; destinations in the expanded list
  that nobody chose (final URL expansion).
- **Do:** hold Performance Max until the conversion signal is real; test AI
  Max only as an experiment arm with a weekly search-term review; exclude
  brand from Performance Max when brand Search exists.

### 2.7 Location: presence or interest

"Presence or interest" serves ads to people searching about a place, not only
people in it. For B2B sales territories, that means leads from outside the
market.

**Run** (`google_ads_gaql_query`): campaigns on presence or interest, then
spend that came from interest rather than presence.

```sql
SELECT campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.geo_target_type_setting.positive_geo_target_type = 'PRESENCE_OR_INTEREST'
```

```sql
SELECT geographic_view.country_criterion_id, metrics.cost_micros, metrics.conversions
FROM geographic_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND geographic_view.location_type = 'AREA_OF_INTEREST'
  AND metrics.cost_micros > 0
```

Resolve a country ID to its name:
`SELECT geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id = <id>`.

- **Red flag:** any campaign on presence or interest; interest-only spend
  with no qualified leads; CRM leads from countries you do not sell to.
- **Do:** switch to presence only (people in, or regularly in, the targeted
  locations).

### 2.8 Landing-page destinations

**Run** (`google_ads_gaql_query`): spend and conversions by landing page.

```sql
SELECT landing_page_view.unexpanded_final_url, metrics.clicks,
       metrics.cost_micros, metrics.conversions
FROM landing_page_view
WHERE segments.date BETWEEN '<start>' AND '<end>' AND metrics.clicks > 0
ORDER BY metrics.cost_micros DESC
```

Cross-check each ad's final URL with `google_ads_ad_performance`, and tracking
templates and URL suffixes with `google_ads_get_campaign_tracking`. A broken
suffix can strip the click ID that the CRM import in 2.2 depends on.

- **Red flag:** high-intent queries landing on the homepage, a blog post or a
  gated asset when the ad promised a demo; one page taking most of the spend
  at a conversion rate far below the rest; tracking that drops the click ID.
- **Do:** send each intent to the page that answers it, with the form on that
  page.

### 2.9 Budget, and limited by budget on Maximize Conversions

**Run** (`google_ads_gaql_query`), or `google_ads_get_campaign_diagnostics`
for the same status reasons plus the last 7 days in one call:

```sql
SELECT campaign.name, campaign.primary_status_reasons, campaign_budget.amount_micros,
       metrics.search_budget_lost_impression_share,
       metrics.search_rank_lost_impression_share,
       metrics.cost_micros, metrics.conversions
FROM campaign
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND campaign.bidding_strategy_type IN ('MAXIMIZE_CONVERSIONS', 'TARGET_CPA')
  AND metrics.cost_micros > 0
```

- **Red flag:** `BUDGET_CONSTRAINED` with a high cost per conversion; a daily
  budget below the target cost per conversion, so the bidder sees less than
  one conversion a day to learn from; budget spread across so many campaigns
  that none gets enough volume.
- **Do:** test under-training against signal quality before cutting. Raise
  the budget or consolidate campaigns, and audit search terms (2.4) and
  landing pages (2.8), before tightening targets or cutting spend. Any budget
  recommendation states the cost per conversion of the last spend step, read
  over 6+ weeks (compare higher- and lower-spend weeks), not the account
  average.

## 3. Asset checks

Run these only once setup is sound. Otherwise you are tuning copy for a
bidder pointed at the wrong target.

### 3.1 Offer

What does each campaign ask the searcher to do, and does it fit the query?
Read the top-spend queries from `google_ads_search_term_report` next to each
ad's final URL from `google_ads_ad_performance`.

- **Red flag:** "what is" research queries sent to a demo request; pricing or
  vendor queries sent to an ebook; one offer for every stage.
- **Do:** match offer to intent. Bottom-of-funnel queries go to a demo or
  pricing page; research queries go to content, kept out of the bidder's
  Primary goal (2.1).

### 3.2 Message: judge copy by Expected CTR, not Ad Strength

Ad Strength scores asset variety, not performance. Judge copy by the keyword
quality components instead, weighted by impressions.

- `google_ads_keyword_performance` returns expected CTR, ad relevance and
  landing page experience per keyword. Weight each by impressions: below
  average expected CTR on the top-impression keywords is the copy problem.
- `google_ads_ad_performance` returns the headlines and descriptions to
  rewrite.
- `google_ads_get_ad_strength` is useful only to find ads short of assets.

- **Red flag:** below average expected CTR on most impressions; copy that
  never names the buyer, the problem or a qualifier ("for IT teams of 500+"),
  so it attracts clicks you do not want.
- **Do:** rewrite the ad groups carrying the most below-average impressions
  first, with the qualifier and the offer in the headlines.

### 3.3 Landing page

Use the landing page experience component from
`google_ads_keyword_performance` and the conversion rate per page from 2.8.

- **Red flag:** below average landing page experience; a page converting far
  below others on similar traffic; an ad promise the page headline does not
  repeat; a long form.
- **Do:** fix the page with the most spend and the worst conversion rate
  first.

## 4. Theory of what to change next

End with one paragraph in this shape:

> The program is stalled because **[cause]**, shown by **[numbers, with
> campaigns named]**. The next change is **[one change]**. If it works,
> **[metric]** moves **[direction]** within **[window]**. If it has not by
> then, the next suspect is **[second cause]**.

- Make one setup change at a time, so its effect can be read.
- Name every campaign, ad group and conversion action. An ID alone is not
  readable; put it in parentheses after the name.
- Read the effect on a trend of 6 or more weeks.
- Stage changes as drafts or experiments. This skill only reads.

## Output

One table per section, then the theory paragraph:

| Check | Evidence | Verdict | Fix |
|---|---|---|---|
| 2.1 What the bidder is trained on | numbers, named entities | OK / Flag / Can't tell | the change |

"Can't tell" says which data is missing and who has it.
