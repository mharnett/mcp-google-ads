# Allow replacing the existing Audience criterion on an ad group

**Found:** 2026-05-11 (Forcepoint Demand Gen audience refresh)
**Severity:** Medium — blocks audience updates on any DG ad group that already has an Audience criterion (which is every DG ad group, since the UI auto-attaches one at create time).

## Symptom

Calling `google_ads_create_and_attach_audience_bundle` against a Demand Gen ad group that already has an `ad_group_criterion` of type `AUDIENCE` fails with:

```
Audience segment attachment is not allowed when use audience grouped bit is set to true.
(field: operations.create.audience.audience; code: {"criterion_error":"ONE_AUDIENCE_ALLOWED_PER_AD_GROUP"})
```

Reproduced across 10 parallel calls on 26 distinct Forcepoint DG ad groups (customer 4948252953) — every call hit the same error. The tool description acknowledges the limit ("each ad group can only have one Audience criterion ... the call will fail for ad groups that already have one"), but doesn't offer a path to replace.

## Why this matters

In Demand Gen, every ad group ends up with an Audience criterion at creation — either because the user set one in the UI, or because Google attaches a default placeholder. So in practice `create_and_attach_audience_bundle` only works on brand-new ad groups during their first audience attachment. Any subsequent refresh requires manual UI work.

## Workaround (current)

1. GAQL query `ad_group_criterion` filtered to `type = 'AUDIENCE'` to find the existing criterion ID per ad group.
2. Manually remove it in the Google Ads UI.
3. Re-run `create_and_attach_audience_bundle`.

Or: edit the existing Audience resource's `dimensions.audience_segments.segments` to add/remove user_lists (changes apply to every ad group sharing that Audience — coarser than needed).

## Fix direction

Add a new tool — or new mode on the existing one — that performs a **replace** in a single mutate batch:

1. Look up the existing `ad_group_criterion` of type AUDIENCE on each target ad group.
2. In one `MutateAdGroupCriteriaRequest`, send `remove` operations for the existing criterion(s) and `create` operations for the new bundled-Audience criterion.
3. The Google Ads API accepts mixed remove+create operations atomically — this should clear the `ONE_AUDIENCE_ALLOWED_PER_AD_GROUP` collision because removes are processed before creates in the same batch.

Suggested signatures:
- New tool: `google_ads_replace_audience_bundle` (same params as `create_and_attach_audience_bundle`, plus implicit remove-first).
- OR new param on existing: `replace_existing: true` (defaults false to preserve current behavior).

Also nice-to-have: an `update_audience` tool that mutates the `Audience` resource directly to add/remove user_list segments, so a single shared Audience can be refined without touching each ad group's criterion.

## Test plan

- Create a fresh DG ad group, verify default Audience criterion exists.
- Call replace tool with new bundle → assert old criterion removed, new criterion attached, no `ONE_AUDIENCE_ALLOWED_PER_AD_GROUP` error.
- Negative test: pass `replace_existing: false` (or use the original tool) on the same ad group → confirm it still errors with the same message (regression guard).
- Multi-ad-group test: 5 ad groups in one call, each with a distinct existing Audience → all replaced atomically.
