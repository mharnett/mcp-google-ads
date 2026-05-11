# Add `update_audience` tool (modify segments on an existing Audience resource)

**Found:** 2026-05-11 (Forcepoint DG audience refresh)
**Severity:** Medium — forces UI-only work for any Audience-resource refinement.

## Symptom

There is no MCP tool to add or remove `audience_segments` on an existing `Audience` resource. `create_and_attach_audience_bundle` only creates new Audience resources; it can't mutate the segments of an already-created one. To add a single user_list to a shared Audience we currently have to:

1. Read the Audience definition via GAQL on `audience`
2. Manually re-enter every existing segment in the Google Ads UI
3. Add the new segment
4. Save

This is fragile and not scriptable. It also blocks the workaround pattern for the sibling backlog item `replace-existing-audience-on-ad-group.md` — if we could just edit the shared Audience instead of replacing the ad-group criterion, half of those use cases go away.

## Concrete blocked use case

Forcepoint Audience 320456709 (`Top Searchers and Interests- No Primer Exclusions`) is attached to 5 DG ad groups (NAM Safeguard + 4× DSPM Gartner TOFU). We want to add `DSPM Xsell LaL` (9375751901) and `XSell | DSPM |Any` (9374794078) as segments — a 30-second change via API, currently a manual UI re-entry.

## Fix direction

New tool `google_ads_update_audience`:
- `audience_id` (required)
- `add_user_list_ids` (optional list)
- `remove_user_list_ids` (optional list)
- `add_user_interest_ids`, `remove_user_interest_ids` (optional)
- `add_custom_audience_ids`, `remove_custom_audience_ids` (optional)
- `confirm` (dry-run default)

Implementation: read current `audience.dimensions`, apply add/remove deltas to `audience_segments.segments`, send a `MutateAudiencesRequest` with `update` operation and `update_mask = "dimensions"`.

## Test plan

- Create an Audience with 2 user_lists.
- `update_audience(add_user_list_ids=[X])` → assert 3 segments.
- `update_audience(remove_user_list_ids=[X])` → back to 2.
- Mixed add+remove in one call → assert delta applied atomically.
- Dry-run preview shows the resulting segment list before mutating.
