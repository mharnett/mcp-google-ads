# Add PERFORMANCE_MAX campaign type to google-ads MCP

**Status:** Backlog (deferred from v1.2.0 Demand Gen rollout — largest outstanding task)
**Target version:** v1.3.0 or later (may want its own release given complexity)
**Dependencies:** v1.2.0 campaign-param extension + image asset upload; optionally text asset and YouTube video asset support

## Objective
Extend google-ads MCP to create Performance Max campaigns. PMax is structurally different from other campaign types — **no ad groups**. Uses **Asset Groups** that bundle all creative assets in one container, and **Asset Group Signals** to guide Google's AI on audience targeting.

## Scope

### Campaign level (done by DG work except PMax-specific validation)
- `channel_type: "PERFORMANCE_MAX"` → `enums.AdvertisingChannelType.PERFORMANCE_MAX`
- Default bidding: `MAXIMIZE_CONVERSIONS` or `MAXIMIZE_CONVERSION_VALUE` (tROAS variant)
- PMax-specific: `final_url_expansion` (default false for now — we usually want our exact URL)
- Validation: reject `create_ad_group` calls for PMax campaigns (fail-fast with clear error)

### New tool: `google_ads_create_asset_group`
Container for all creative assets attached to a PMax campaign.

Inputs:
- `campaign_id`
- `name`
- `final_urls[]`
- `headlines[]` (3–5, ≤30 chars)
- `long_headlines[]` (1–5, ≤90 chars)
- `descriptions[]` (2–5, ≤90 chars)
- `business_name`
- `marketing_image_asset_ids[]` (1.91:1 landscape, 1–20)
- `square_marketing_image_asset_ids[]` (1:1, 1–20)
- `portrait_marketing_image_asset_ids[]` (optional, ≤20)
- `logo_image_asset_ids[]` (1:1, 1–5)
- `landscape_logo_image_asset_ids[]` (optional)
- `youtube_video_asset_ids[]` (optional, strongly recommended — Google auto-generates from images if missing, poorly)
- `call_to_action_selection` (enum)
- `path1`, `path2` (display URL paths)
- `status` (PAUSED default)

Behavior: creates the AssetGroup + all AssetGroupAsset links (potentially 20+ operations). Use batched mutation to avoid rate limits.

### New tool: `google_ads_create_asset_group_signal`
Tells PMax's AI model what audience to prioritize.

Inputs:
- `asset_group_id`
- Optional: `user_list_ids` (first-party audiences), `custom_audience_ids`, `interest_ids`, `demographics` (ages[], genders[], parental_status[])

## TDD requirements
Strict red/green/refactor. TDD_LOG.md maintained. Start with:
1. Contract test: PMax campaign creation accepts `final_url_expansion` flag.
2. Validation test: creating ad group on PMax campaign is rejected with specific error.
3. Contract test: `create_asset_group` schema includes all required fields.
4. Validation test: rejects asset group with <3 headlines or >5.
5. Validation test: rejects asset group with <1 landscape image OR <1 square image.
6. Behavior test: happy-path creates AssetGroup + linked AssetGroupAssets.
7. Contract test: `create_asset_group_signal` schema.
8. Behavior test: signal creation with user list only; with interests only.
9. Regression tests for all previous campaign types.

## Complexity flags
- PMax has no ad groups — this is the biggest cognitive break for anyone using the MCP. Document in tool description and README.
- Listing Group Filter (for retail PMax) is deliberately out of scope — adds Merchant Center dependency.
- Asset Group Listing Group Filter also out of scope.
- AssetGroupSignal → AudienceSignal wraps user lists, customer match segments, in-market interests, and demographics. Modeling this cleanly may require its own validator module.

## Estimated effort
~500–700 LOC. ~15–20 TDD cycles. Likely its own PR.
