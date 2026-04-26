# Add `update_ad_group` and ad-naming support

**Status:** Backlog
**Priority:** Medium — blocks programmatic renames; UI workaround is one click per resource
**Discovered:** 2026-04-22 during Survey Measure DG launch

## Problem

The MCP currently exposes `create_ad_group` and `pause_items` / `enable_items` / `remove_items` for ad groups, but no `update_ad_group`. Operators can't:
- Rename an ad group ("Ad group 1" → "AK | Survey Recruit")
- Change CPC bid after creation
- Change ad-group type (rare; mostly create-time anyway)
- Update DG-specific channel controls

Same gap on the ad side: `create_demand_gen_multi_asset_ad` doesn't accept a `name` parameter, so DG ads land with Google's auto-generated default name. There's no `update_ad` for renames or copy edits — the only path today is `remove_items` + recreate, which destroys the ad's history (impressions, conversions, learning phase).

## Scope

**`google_ads_update_ad_group`** — inputs: `ad_group_id`, optional `name`, `cpc_bid`, `status`. Returns the before/after diff.

**`google_ads_update_ad`** — inputs: `ad_id`, optional `name`. Headline / description / image edits NOT supported (Google Ads API treats those as immutable on ad_group_ad — same constraint Meta has on ad creatives, see `mcp__meta-ads__update_ad_creative` description). Document this clearly in the tool description so callers don't expect content edits.

**Extend `google_ads_create_demand_gen_multi_asset_ad`** — add optional `name` parameter so callers can name ads at create time (cleanest fix; avoids retro-renaming).

## TDD requirements

- Strict red/green/refactor.
- Back-compat: existing `create_demand_gen_multi_asset_ad` calls without `name` produce the same payload as today.
- Tests for: rename ad group; change CPC bid only (no rename); reject empty name; happy-path ad rename.

## Estimated effort

~150 LOC. ~6 TDD cycles. 1-2 hours.
