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

### Cycle 8e — isDemandGenAdGroup accepts parent-campaign signal [hotfix 2026-04-17]
RED: 5 tests for new pure helper `isDemandGenAdGroup(row)`. Reason for red:
the function didn't exist. Discovered during live DG ad creation on
Survey Measure — UI-created DG campaigns auto-generated ad groups whose
ad_group.type returns undefined from google-ads-api v23 (because proto
value 21 isn't in the lib's enum map), causing the old type-only guard
to reject valid DG ad groups.
GREEN: added isDemandGenAdGroup() to validateDemandGenAd.ts. Function
returns true when EITHER (a) ad_group.type is 21 / "21" /
"DEMAND_GEN_MULTI_ASSET_AD_GROUP" (future-proof for when the lib adds
the name) OR (b) campaign.advertising_channel_type === 14 / "DEMAND_GEN"
(the authoritative check: DG campaigns can only contain DG ad groups).
Updated the guard in createDemandGenMultiAssetAd to use the helper and
the GAQL query to fetch campaign.advertising_channel_type alongside
ad_group.type. +35 LOC.
5 new tests; 297 → 302 passing. 0 regressions.
REFACTOR: none.

### Cycle 8d — DEMAND_GEN network_settings: content_network=true [hotfix 2026-04-17]
RED: `DEMAND_GEN sets network_settings: content_network=true, others=false`
— previous cycle pinned all four flags to false, but Google Ads API then
rejects with "Must target at least one network." DG serves on YouTube /
Discover / Gmail, which Google categorizes as content-network inventory.
GREEN: flip target_content_network to true in the DG branch of the
builder; Search + Partner-Search remain false. +1 LOC change.
Test was updated in-place (not a separate new test). 0 regressions.
REFACTOR: none.

### Cycle 8c — DEMAND_GEN network_settings explicit [hotfix 2026-04-17]
RED: `DEMAND_GEN sets explicit network_settings (all false; DG runs on its
own surfaces)` — the field was undefined. Google Ads API rejects DG
campaign create with "The required field was not present" if
network_settings is omitted. DG runs on YouTube/Discover/Gmail — never on
Search/Display/Partner networks — so every flag must be explicit false.
Discovered during live DG campaign creation after the explicitly_shared
fix landed.
GREEN: set network_settings = { all-four-networks: false } in the builder
when channel_type === "DEMAND_GEN". SEARCH path unchanged (retains
implicit server defaults for back-compat). +13 LOC incl comment.
Back-compat guard test added: SEARCH does NOT set network_settings.
275 → 279 passing (+4 new tests), 0 regressions.
REFACTOR: none.

### Cycle 8b — Dedicated budget (explicitly_shared: false) [hotfix 2026-04-17]
RED: `budget is dedicated (not shared)` — field was undefined; Google Ads
API defaults to explicitly_shared=true when omitted, which makes auto-
bidding strategies (MAXIMIZE_CONVERSIONS, TARGET_CPA, etc.) reject with
"Bidding strategy type is incompatible with shared budget". Discovered
during live DG campaign creation attempt for Survey Measure — 4 orphan
shared budgets created before the fix.
GREEN: added `explicitly_shared: false` to the budget payload in
`campaignBuilder.ts` (+8 LOC incl comment). Updated back-compat test to
include the new field (contract evolution). 274 → 275 passing, zero
regressions.
REFACTOR: none.

---

## Commit 2 — Ad group types + image asset upload

### Cycle 9 — google_ads_create_ad_group schema accepts `type`
RED: `create_ad_group accepts type SEARCH_STANDARD | DEMAND_GEN_MULTI_ASSET_AD_GROUP` — schema missing enum.
GREEN: added `type` field with enum to tools.ts (~6 LOC).
REFACTOR: none.

### Cycle 10 — buildAdGroupCreatePayload (back-compat)
RED: `defaults to SEARCH_STANDARD when type not specified` — module missing.
GREEN: created adGroupBuilder.ts + test (~40 LOC).
REFACTOR: none.

### Cycle 11 — DEMAND_GEN produces proto value 21
Test written as regression coverage; passed immediately from cycle 10's
GREEN (type mapped to AD_GROUP_TYPE_DEMAND_GEN_MULTI_ASSET=21 when DG).
**Blocker resolution:** google-ads-api v23's AdGroupType enum map is missing
DEMAND_GEN_MULTI_ASSET_AD_GROUP (proto value 21). We emit the raw int and
route DG ad group creation through customer.mutateResources (which trusts the
numeric value) rather than customer.adGroups.create (which validates against
the stale local enum).

### Cycle 12 — google_ads_create_image_asset tool registered
RED: expected tool list includes `google_ads_create_image_asset` — tool missing.
GREEN: added tool schema + updated tool count (~15 LOC).
REFACTOR: none.

### Cycle 13 — validateImageInput: both or neither path+data
RED: missing module ./imageAsset.js.
GREEN: created imageAsset.ts with validateImageInput (~25 LOC).
REFACTOR: none.

### Cycles 14 — additional validateImageInput coverage (both provided / empty name / happy input)
Tests added as regression; all pass from cycle 13 GREEN.

### Cycle 15 — detectMimeType (PNG/JPEG/GIF magic bytes)
RED: imported `detectMimeType` not exported.
GREEN: added detectMimeType (~30 LOC).
REFACTOR: none.

### Cycle 16 — getImageDimensions (PNG header parse)
RED: `getImageDimensions` not exported.
GREEN: added getImageDimensions supporting PNG/JPG/GIF headers (~50 LOC).
REFACTOR: none.

### Cycle 17 — prepareImageForUpload (orchestrator)
RED: `prepareImageForUpload` not exported; rejects-missing-file test fails.
GREEN: added prepareImageForUpload + fs reads (~70 LOC).
REFACTOR: none.

### Cycle 18 — size / wrong-mime / dimension / happy-path coverage
5 additional tests added for prepareImageForUpload — all pass from cycle 17's
GREEN since that impl already handles each branch. Kept as regression coverage.

### Cycle 19 — Wire createImageAsset manager + handler
No new test (prepared-image test covers validation; API wiring is mechanical).
Added mimeToAssetMimeEnum helper, extended autoLabelCreated to support "asset"
type, added createImageAsset manager method using customer.assets.create, added
handler case. Build green; full suite 258 passed / 8 skipped.

---

## Commit 3 — Demand Gen multi-asset ad

### Cycle 20 — google_ads_create_demand_gen_multi_asset_ad tool registered
RED: expected tool list includes the new tool + required-fields check fails.
GREEN: added tool schema with business_name, CTA, marketing_image_asset_ids,
optional image arrays, headlines / long_headlines / descriptions, labels.
REFACTOR: none.

### Cycle 21 — validateDemandGenAd base case
RED: module validateDemandGenAd.js missing.
GREEN: created validateDemandGenAd.ts with headlines/descriptions/long_headlines
caps + required-field checks (~95 LOC).
REFACTOR: none.

### Cycles 22-27 — per-rule coverage
11 tests added at once for: headline >40 / >5 / 0; description >90 / >5;
long_headline >90 / >5; missing final_urls / marketing_images / business_name /
call_to_action. All pass from cycle 21's GREEN — kept as regression coverage.

### Cycle 28 — buildDemandGenAdPayload
RED: `maps asset IDs to resource names` — builder not exported.
GREEN: added buildDemandGenAdPayload; asset IDs expand to
`customers/{cid}/assets/{id}`; optional image arrays are only set when
non-empty. long_headlines are emitted to the payload even though the v23
typed Ad field stub doesn't include them — the payload goes through
mutateResources which forwards unknown fields to the server.

### Cycle 29 — Wire createDemandGenMultiAssetAd manager + handler
No new test (builder + validator are tested; API wiring is mechanical).
Added manager method that:
  1. pre-validates with validateDemandGenAd;
  2. queries the ad_group and fails fast if type != 21 (DG ad group) —
     the guard accepts numeric 21, string "DEMAND_GEN_MULTI_ASSET_AD_GROUP"
     and "21" to be forward-compat with any future client enum update;
  3. submits via customer.mutateResources with entity=ad_group_ad;
  4. auto-labels the resulting ad + applies any caller-supplied labels.

Full suite 274 passed / 8 skipped.

---

## Commit 4 — Housekeeping

No new tests (doc/version update). README now reflects 36 tools + a concrete
Demand Gen end-to-end example block. CHANGELOG has a full v1.2.0 entry.
package.json bumped to 1.2.0 with the new description.

`npm run build` — zero TS errors.
`npm test` — 274 passed + 8 skipped (baseline 231 + 8; +43 new tests).

---

## Blockers encountered (resolved)

1. **v23 AdGroupType enum missing DEMAND_GEN_MULTI_ASSET_AD_GROUP (proto 21).**
   Resolution: emit the raw numeric 21 and route DG ad group creation through
   customer.mutateResources (which doesn't validate against the local enum map).
   Documented in adGroupBuilder.ts.
2. **v23 DemandGenMultiAssetAdInfo typed field missing long_headlines.**
   Resolution: emit `long_headlines` on the payload anyway; mutateResources
   forwards unknown fields to the server. Documented in validateDemandGenAd.ts.
3. **BiddingStrategyType uses "TARGET_SPEND" (not "MAXIMIZE_CLICKS").**
   The user-facing param is `MAXIMIZE_CLICKS` but internally we set the
   `target_spend` field on the Campaign resource. Documented in campaignBuilder.ts.
