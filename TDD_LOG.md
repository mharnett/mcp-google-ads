# TDD Log — v1.2.0 Demand Gen Support

Format:
```
### Cycle N — <one-line description>
RED: <test name> — <failure reason>
GREEN: <files changed, LOC delta>
REFACTOR: <what, or "none">
```

---

## Commit 1 — DEMAND_GEN channel + richer bidding

### Cycle 1 — Back-compat gate for buildCampaignCreatePayload
RED: `back-compat gate` — module `./campaignBuilder.js` doesn't exist.
GREEN: added src/campaignBuilder.ts (+50 LOC), src/campaignBuilder.test.ts (+34 LOC).
REFACTOR: none.

### Cycle 2 — DEMAND_GEN channel defaults to MAXIMIZE_CONVERSIONS
RED: `channel_type=DEMAND_GEN defaults bidding to MAXIMIZE_CONVERSIONS` — campaign still had SEARCH channel and manual_cpc.
GREEN: mapped channel_type + switch on bidding strategy (~15 LOC).
REFACTOR: none.

### Cycle 3 — MAXIMIZE_CLICKS maps to target_spend
RED: `MAXIMIZE_CLICKS maps to target_spend` — no target_spend field set.
GREEN: added MAXIMIZE_CLICKS case producing target_spend with optional cpc_bid_ceiling_micros (+10 LOC).
REFACTOR: none.

### Cycle 4 — TARGET_CPA strategy
RED: `TARGET_CPA sets target_cpa_micros` — no target_cpa field set.
GREEN: added TARGET_CPA case (throws if target_cpa missing) (+7 LOC).
REFACTOR: none. (Additional coverage test `TARGET_CPA without target_cpa throws` already green at write — kept for regression.)

### Cycle 5 — start_date/end_date pass-through
RED: `passes start_date and end_date through` — fields undefined on campaign.
GREEN: 2 lines added to pass dates through.
REFACTOR: none.

### Cycle 6 — geo_target_ids + default language criterion
RED: `emits one LOCATION criterion per geo_target_id` — criteria array empty.
GREEN: build criteria array in builder (~13 LOC).
REFACTOR: none.

### Cycle 7 — tools.ts schema exposes new fields
RED: `create_campaign accepts channel_type, bidding_strategy, ...` — fields missing from tool input schema.
GREEN: extended google_ads_create_campaign tool schema (+36 LOC).
REFACTOR: none.

### Cycle 8 — Wire manager + handler to use builder
No new test (builder tests already cover the payload shape). Refactored
GoogleAdsManager.createCampaign to use buildCampaignCreatePayload + attach
criteria post-campaign-create; updated handler to thread through new params.
All 8 new tests + 231 existing tests still pass (239/8).
