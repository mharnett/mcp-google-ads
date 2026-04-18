# Rollback orphan budget when campaign creation fails

**Status:** Backlog
**Priority:** Medium — blocks retries after any campaign-create error
**Dependencies:** None

## Problem

`GoogleAdsManager.createCampaign` creates the budget resource first (step 1), then the campaign resource (step 2) that references the budget. If step 2 fails for any reason (policy rejection, invalid bidding strategy, geo target access, etc.), the budget from step 1 is left orphaned in the account with name `<campaign name> Budget`.

Next time the caller retries `createCampaign` with the same campaign name, step 1 fails with `A campaign budget with this name already exists` — blocking the retry entirely. The caller has to either:
- Rename the campaign (polluting naming conventions)
- Manually delete the orphan budget in the Google Ads UI
- Reach in with GAQL + raw mutation to re-link the existing budget

Observed 2026-04-17 during Demand Gen v1.2.0 launch testing.

## Desired behavior

When campaign creation fails after the budget was successfully created, one of:

1. **Transactional rollback (preferred):** delete the budget before surfacing the error.
2. **Reuse on retry:** detect existing budget with the same name, skip create step, use existing `resource_name`. Only safe if budget settings match (amount, delivery_method).
3. **Hybrid:** try campaign-first with budget-creation via single transaction using `customer.mutateResources([budget_op, campaign_op])` so both either land or both roll back atomically.

Option 3 is the cleanest but requires restructuring `createCampaign` to use raw mutation with multi-operation semantics.

## Fix sketch

```ts
// In createCampaign:
try {
  const budgetResult = await customer.campaignBudgets.create([...]);
  try {
    const campaignResult = await customer.campaigns.create([...]);
    return { budget: budgetResult, campaign: campaignResult };
  } catch (campaignErr) {
    // Best-effort rollback of the budget we just created
    await customer.campaignBudgets.remove([budgetResult.results[0].resource_name])
      .catch(() => {/* log but don't mask the original error */});
    throw campaignErr;
  }
} catch (budgetErr) {
  throw budgetErr;
}
```

Better approach: migrate to `customer.mutateResources([budget_op, campaign_op])` with a single transactional call.

## TDD requirements

1. RED: mock campaigns.create to throw → assert campaignBudgets.remove is called with the just-created budget resource_name.
2. RED: mock campaigns.create to throw AND budgets.remove to also throw → assert the ORIGINAL campaign error is what surfaces (not the rollback error).
3. RED: happy path unchanged — no rollback call on success.
4. GREEN after each.

## Estimated effort

~30 LOC + ~5 TDD cycles. 1-2 hours including the test mocks.
