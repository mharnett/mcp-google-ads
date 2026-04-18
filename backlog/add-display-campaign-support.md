# Add DISPLAY campaign type to google-ads MCP

**Status:** Backlog (deferred from v1.2.0 Demand Gen rollout)
**Target version:** v1.3.0 or later
**Dependencies:** v1.2.0 campaign-param extension (DG work) lands first

## Objective
Extend google-ads MCP to create Display campaigns with responsive display ads.

## Scope

### Campaign level (likely already done by DG work)
- `channel_type: "DISPLAY"` accepted in `create_campaign` → maps to `enums.AdvertisingChannelType.DISPLAY`
- Default bidding for DISPLAY: `MAXIMIZE_CONVERSIONS`

### Ad group level
- `create_ad_group` accepts `type: "DISPLAY_STANDARD"` → `enums.AdGroupType.DISPLAY_STANDARD`

### New tool
- `google_ads_create_responsive_display_ad`:
  - `ad_group_id`, `final_urls[]`
  - `headlines[]` (max 5, ≤30 chars)
  - `long_headline` (single, ≤90 chars)
  - `descriptions[]` (max 5, ≤90 chars)
  - `business_name`
  - `marketing_image_asset_ids[]` (1.91:1 landscape, min 1)
  - `square_marketing_image_asset_ids[]` (1:1, min 1)
  - `logo_image_asset_ids[]` (optional)
  - `square_logo_image_asset_ids[]` (optional)
  - `labels[]` (optional)
  - Auto-label applied; validation of character limits before API call.

## TDD requirements
Follow strict red/green/refactor. One failing test at a time. Maintain TDD_LOG.md. Tests to write:
1. Contract test: tool schema accepts all required fields.
2. Validation test: rejects headline >30 chars.
3. Validation test: rejects missing required image asset.
4. Behavior test: happy-path creates a ResponsiveDisplayAd mutation with correct resource shape.
5. Regression test: existing RSA creation unchanged.

## Estimated effort
~300 LOC across `src/index.ts`, `src/tools.ts`, `src/validate*.ts` (new), tests. ~8–12 TDD cycles.
