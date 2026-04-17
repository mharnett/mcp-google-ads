# Changelog

## [1.2.0] - 2026-04-17

### Added
- **Demand Gen campaign creation end-to-end.** Narrow DG v1; Display / Video /
  Performance Max remain in `backlog/`.
- `google_ads_create_campaign` extended with:
  - `channel_type`: "SEARCH" (default) | "DEMAND_GEN"
  - `bidding_strategy`: "MANUAL_CPC" | "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS" | "TARGET_CPA"
  - `target_cpa`, `target_cpc_cap` (dollars)
  - `geo_target_ids[]`, `language_id` (default "1000" = English)
  - `start_date`, `end_date` (YYYY-MM-DD)
- `google_ads_create_ad_group` extended with `type`: "SEARCH_STANDARD" (default)
  or "DEMAND_GEN_MULTI_ASSET_AD_GROUP" (routes through `mutateResources` because
  the v23 client enum map is missing the DG value).
- New tool **`google_ads_create_image_asset`** — upload a PNG/JPG/GIF image
  asset for use in Demand Gen ads. Validates mime type (magic bytes), size
  (≤5 MB), and minimum dimensions (600×314). Accepts either `file_path` or
  `base64_data`. Auto-labels the created asset.
- New tool **`google_ads_create_demand_gen_multi_asset_ad`** — create a DG
  multi-asset ad (PAUSED). Validates headlines ≤40 chars / long_headlines ≤90 /
  descriptions ≤90 and count caps (≤5 each) before the API call. Fails fast if
  the ad_group isn't a DG ad group. Auto-labels the created ad.

### Changed
- Back-compat preserved: existing `google_ads_create_campaign({name, daily_budget})`
  calls still produce the same SEARCH + MANUAL_CPC shape as v1.1.
- Back-compat preserved: existing `google_ads_create_ad_group({name, campaign_id})`
  calls still produce the same SEARCH_STANDARD ad group.

### Internal
- Pure payload/validation logic extracted to `campaignBuilder.ts`,
  `adGroupBuilder.ts`, `imageAsset.ts`, `validateDemandGenAd.ts` for unit
  testing without a live Google Ads client.
- Full test suite: 274 passed + 8 skipped (baseline was 231 + 8).

## [1.0.13] - 2026-04-04

### Security
- Error responses now pass through `safeResponse` to prevent oversized error payloads
- `safeResponse` deep-clones before truncation to avoid mutating original data

### Fixed
- Budget unit documentation clarified (dollars, not microcurrency) in tool descriptions

## [1.0.9] - 2026-04-09

### Added
- Published to npm
- CLI flags (--help, --version)
- SIGTERM/SIGINT graceful shutdown
- Env var trimming and validation

### Security
- GAQL injection fix in query parameters
- All logging to stderr (stdout reserved for MCP protocol)
- Auth errors not retried (fail fast on 401/403)
