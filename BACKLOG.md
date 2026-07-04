# Backlog

## Done

### create_responsive_search_ad silently drops `labels` parameter
**Found:** 2026-04-22 (Forcepoint NAM Week 7 ad swap)
**Fixed:** 2026-07-03 (branch `fix/custom-labels-dropped`)
**Root cause:** `createResponsiveSearchAd` called `autoLabelCreated` (the `claude-MM-DD-YY` auto-label) but never called `applyCustomLabels` with the caller's `ad.labels`, so custom labels were silently dropped after a successful create.
**Fix:** Added `await this.applyCustomLabels(customerId, adRNs, "ad", ad.labels)` immediately after `autoLabelCreated` in `createResponsiveSearchAd` (runs after creation, so the ad resource names exist).
**Sibling audit result:** Of the 4 suspected siblings, NONE were affected — none exposes a custom-label parameter that reaches the handler:
- `create_ad_group` — no `labels`/`label` param in the tool schema.
- `create_keywords` — exposes `label` (singular); the handler applies it correctly via `ensureLabelExists` + `labelAdGroupCriteria`.
- `create_shared_set` — no `labels` param (`createSharedSet(customerId, name)`).
- `create_sitelink` — no `labels` param.
Adding label support to those would be a new feature, not a bug fix.
**Regression test:** `src/createResponsiveSearchAd.labels.test.ts` (drives the real `createResponsiveSearchAd` with a fake customer; asserts the aggregate set of labels attached to the created ad includes both the auto label and all caller-supplied labels).

<details><summary>Original report</summary>

**Severity:** Medium — breaks audit-trail labeling and ad-group filter workflows.
**Symptom:** Pass `labels: ["my-tag", "my-other-tag"]` to `google_ads_create_responsive_search_ad`. Tool accepts it, reports success, auto-applies `Claude-MM-DD-YY`, but the custom labels never attach. Confirmed via `ad_group_ad_label` GAQL query — only the auto label is present.
**Workaround:** Call `google_ads_apply_label` after create (one call per label, passing the new `ad_ids`). Works end-to-end.
**Root cause hypothesis:** The create handler either never calls `applyCustomLabels`, or calls it before the ad resource is returned by the mutate, or calls it with the wrong resource name format. Suspect the path goes via `autoLabelCreated` only (which handles the `Claude-MM-DD-YY` auto-label) and skips the user-supplied `labels` array entirely.

</details>
