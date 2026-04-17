# Validate bidding_strategy against channel_type pre-flight

**Status:** Backlog
**Priority:** Medium — cost today is a cryptic Google Ads API error and an orphaned budget
**Dependencies:** v1.2.0 DG support (landed)

## Problem

The current `createCampaign` path accepts any `{channel_type, bidding_strategy}` combination and forwards it to Google Ads. Google's server rejects invalid combinations with `OperationAccessDeniedError: "The operation is not allowed for the given context"` — which (a) isn't actionable and (b) happens AFTER the budget has already been created, leaving an orphaned budget named `<campaign>  Budget` that blocks retries.

Observed 2026-04-17: called `create_campaign(channel_type=DEMAND_GEN, bidding_strategy=MAXIMIZE_CLICKS)` — API error, orphan budget `SM | Demand Gen | Alaska | Survey Starts Budget` left behind, next retry failed on budget-name conflict.

## Allowed bidding strategies per channel type

From Google Ads API docs:

| channel_type | Allowed bidding strategies |
|---|---|
| SEARCH | MANUAL_CPC, MAXIMIZE_CLICKS, MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE, TARGET_CPA, TARGET_ROAS, TARGET_IMPRESSION_SHARE |
| DEMAND_GEN | MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE, TARGET_CPA, TARGET_ROAS |
| DISPLAY | MAXIMIZE_CLICKS, MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE, TARGET_CPA, TARGET_ROAS |
| VIDEO | MANUAL_CPV, MAXIMIZE_CONVERSIONS, TARGET_CPA, TARGET_CPM |
| PERFORMANCE_MAX | MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE |

## Fix

1. RED test: `createCampaign({channel_type: "DEMAND_GEN", bidding_strategy: "MAXIMIZE_CLICKS"})` throws a clean validation error BEFORE any API call.
2. GREEN: add a `validateBiddingStrategyForChannel(channelType, strategy)` helper (pure function, unit-testable) in `campaignBuilder.ts`. Called at the top of `buildCampaignCreatePayload`.
3. Table-driven tests covering every invalid combo per the matrix above.

## TDD requirements

- Red-first. One failing test at a time. Log each cycle in `TDD_LOG.md`.
- Error message must tell the caller which strategies ARE allowed for the requested channel type.

## Estimated effort

~50 LOC + ~6 TDD cycles. Half a day.
