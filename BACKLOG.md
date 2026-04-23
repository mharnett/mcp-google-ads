# Backlog

## Open

### create_responsive_search_ad silently drops `labels` parameter
**Found:** 2026-04-22 (Forcepoint NAM Week 7 ad swap)
**Severity:** Medium — breaks audit-trail labeling and ad-group filter workflows.
**Symptom:** Pass `labels: ["my-tag", "my-other-tag"]` to `google_ads_create_responsive_search_ad`. Tool accepts it, reports success, auto-applies `Claude-MM-DD-YY`, but the custom labels never attach. Confirmed via `ad_group_ad_label` GAQL query — only the auto label is present.
**Workaround:** Call `google_ads_apply_label` after create (one call per label, passing the new `ad_ids`). Works end-to-end.
**Root cause hypothesis:** The create handler (`case "google_ads_create_responsive_search_ad"` in `src/index.ts` around line 2580) either never calls `applyCustomLabels`, or calls it before the ad resource is returned by the mutate, or calls it with the wrong resource name format. Suspect the path goes via `autoLabelCreated` only (which handles the `Claude-MM-DD-YY` auto-label) and skips the user-supplied `labels` array entirely.
**Fix direction:**
1. Grep the create handler for `applyCustomLabels`. If missing, add a call after `autoLabelCreated` with the user's `labels`.
2. Add a regression test: create RSA with `labels: ["test-a","test-b"]`, then query `ad_group_ad_label` and assert both are attached alongside the auto label.
3. Apply the same audit to `create_ad_group`, `create_keywords`, `create_shared_set`, `create_sitelink` — likely same bug class.
