# Add VIDEO (YouTube) campaign type to google-ads MCP

**Status:** Backlog (deferred from v1.2.0 Demand Gen rollout)
**Target version:** v1.3.0 or later
**Dependencies:** v1.2.0 campaign-param extension + image asset upload (for video thumbnails if needed)

## Objective
Extend google-ads MCP to create Video campaigns with YouTube-based video responsive ads.

## Scope

### Asset
- New tool `google_ads_create_youtube_video_asset`:
  - Inputs: `youtube_video_id` (string), `name` (string)
  - Uploads via `customer.assets.create` with `AssetType.YOUTUBE_VIDEO`
  - Returns `{ asset_id, resource_name }`

### Campaign level (likely already done by DG work)
- `channel_type: "VIDEO"` → `enums.AdvertisingChannelType.VIDEO`

### Ad group level
- `create_ad_group` accepts `type: "VIDEO_TRUE_VIEW_IN_STREAM"` | `"VIDEO_RESPONSIVE"`

### New tool
- `google_ads_create_video_responsive_ad`:
  - `ad_group_id`, `final_urls[]`
  - `headlines[]` (max 5, ≤30 chars)
  - `long_headlines[]` (max 5, ≤90 chars)
  - `descriptions[]` (max 5, ≤90 chars)
  - `call_to_action` (enum: LEARN_MORE, SIGN_UP, etc.)
  - `business_name`
  - `youtube_video_asset_ids[]` (min 1)
  - `labels[]` (optional)

## TDD requirements
Strict red/green/refactor. TDD_LOG.md maintained. Tests to write:
1. Contract test for `create_youtube_video_asset` schema.
2. Contract test for `create_video_responsive_ad` schema.
3. Validation: rejects missing YouTube video ID.
4. Validation: rejects ads without at least 1 video asset.
5. Behavior: happy-path creates a VideoResponsiveAd mutation.
6. Regression: existing RSA/DG ad creation unchanged.

## Estimated effort
~300 LOC. ~8–10 TDD cycles.
