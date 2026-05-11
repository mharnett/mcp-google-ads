# Add tool for campaign-level user_list exclusion (NCA-style suppression)

**Found:** 2026-05-11 (Forcepoint DG NCA setup)
**Severity:** Medium — biggest single audience lever per Google's DG best-practices guide is currently only reachable via the UI.

## Symptom

`google_ads_add_campaign_negatives` is keyword-only. There is no MCP tool to add a `CampaignCriterion` with `user_list` type set to `negative = true`. This is the standard way to suppress an existing-customer list at campaign level (the Demand Gen equivalent of Search's "New Customers Only" mode — Google's DG best-practices guide cites ~11.5% better new-customer ratio + ~3% lower CAC from configurations like this).

## Concrete blocked use case

Forcepoint has `Customers-Partners-Suppression` user_list (id 8979393153, 17K members). We want to attach it as a negative CampaignCriterion to 14 enabled DG campaigns. Today this is 14 separate UI clicks; with an MCP tool it's a single call across all 14 campaign IDs.

## Fix direction

New tool `google_ads_add_campaign_user_list_exclusion`:
- `campaign_ids` (required, list)
- `user_list_id` (required)
- `confirm` (dry-run default)

Implementation: for each campaign_id, build a `CampaignCriterion` with `negative = true` and `user_list.user_list = "customers/.../userLists/{id}"`, send via `MutateCampaignCriteriaRequest`.

Consider also a paired `google_ads_remove_campaign_user_list_exclusion` for reversibility.

## Test plan

- Add exclusion to 1 campaign → GAQL on `campaign_criterion WHERE type = 'USER_LIST' AND negative = TRUE` confirms attachment.
- Add to 3 campaigns in one call → all 3 attached atomically.
- Dry-run preview shows campaign list and user_list name before mutating.
- Removal tool round-trips the addition.
