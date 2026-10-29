/**
 * Budget magnitude ceiling for google_ads_update_campaign_budget.
 *
 * The bidding tool already refuses a >20% target change without
 * confirm_large_change. The budget tool had no ceiling at all: a typo
 * (daily_budget 1000 instead of 100) went straight through. These tests pin
 * the ceiling at the pure-function level and through the real manager method.
 */

import { describe, expect, it } from "vitest";

import { GoogleAdsManager } from "./index.js";
import {
  evaluateBudgetChange,
  MagnitudeCeilingBlocked,
} from "./writeGuards.js";

const CUSTOMER_ID = "1234567890";

function base(newDollars: number, extra: Partial<Parameters<typeof evaluateBudgetChange>[0]> = {}) {
  return {
    campaignId: "111",
    campaignName: "Brand Search",
    oldMicros: 100_000_000, // $100.00/day
    newMicros: Math.round(newDollars * 1_000_000),
    ...extra,
  };
}

describe("evaluateBudgetChange", () => {
  it("allows a change under 20% without confirmation", () => {
    const r = evaluateBudgetChange(base(115));
    expect(r.overCeiling).toBe(false);
    expect(r.override).toBe(false);
    expect(r.deltaPct).toBeCloseTo(15);
  });

  it("allows a change of exactly +20% and exactly -20% without confirmation", () => {
    expect(evaluateBudgetChange(base(120)).overCeiling).toBe(false);
    expect(evaluateBudgetChange(base(80)).overCeiling).toBe(false);
  });

  it("refuses a +21% change and names campaign, old, new and percentage", () => {
    let err: unknown;
    try {
      evaluateBudgetChange(base(121));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MagnitudeCeilingBlocked);
    const msg = (err as Error).message;
    expect(msg).toContain("Brand Search");
    expect(msg).toContain("111");
    expect(msg).toContain("$100.00");
    expect(msg).toContain("$121.00");
    expect(msg).toContain("+21%");
    expect(msg).toContain("confirm_large_change");
    expect(msg).toContain("reason");
  });

  it("refuses a -50% change (the ceiling is symmetric)", () => {
    expect(() => evaluateBudgetChange(base(50))).toThrow(/-50%/);
  });

  it("refuses an override that has confirm_large_change but no reason", () => {
    expect(() => evaluateBudgetChange(base(300, { confirmLargeChange: true }))).toThrow(
      MagnitudeCeilingBlocked
    );
    expect(() =>
      evaluateBudgetChange(base(300, { confirmLargeChange: true, reason: "   " }))
    ).toThrow(/reason/);
  });

  it("refuses a reason without confirm_large_change", () => {
    expect(() => evaluateBudgetChange(base(300, { reason: "launch week" }))).toThrow(
      MagnitudeCeilingBlocked
    );
  });

  it("allows an override with confirm_large_change and a non-empty reason, flagged as an override", () => {
    const r = evaluateBudgetChange(base(300, { confirmLargeChange: true, reason: "launch week" }));
    expect(r.overCeiling).toBe(true);
    expect(r.override).toBe(true);
    expect(r.deltaPct).toBeCloseTo(200);
  });

  it("does not count confirm_large_change on an in-ceiling change as an override", () => {
    const r = evaluateBudgetChange(base(110, { confirmLargeChange: true, reason: "x" }));
    expect(r.override).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manager wiring: the real updateCampaignBudget reads the current budget and
// enforces the ceiling before any mutate.
// ---------------------------------------------------------------------------

function makeFakeCustomer(amountMicros: number) {
  const budgetUpdates: any[] = [];
  const mutateResourcesCalls: any[] = [];
  const customer = {
    async query(_gaql: string) {
      return [
        {
          campaign: { id: "111", name: "Brand Search", bidding_strategy: undefined },
          campaign_budget: { id: "777", amount_micros: amountMicros, name: "Brand Budget" },
        },
      ];
    },
    campaignBudgets: {
      async update(ops: any[]) {
        budgetUpdates.push(...ops);
        return { results: ops.map((o) => ({ resource_name: o.resource_name })) };
      },
    },
    async mutateResources(ops: any[]) {
      mutateResourcesCalls.push(ops);
      return {
        mutate_operation_responses: [
          { campaign_budget_result: { resource_name: "customers/1234567890/campaignBudgets/555" } },
        ],
      };
    },
  };
  return { customer, budgetUpdates, mutateResourcesCalls };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("updateCampaignBudget — magnitude ceiling wiring", () => {
  it("in-place: refuses a +50% change and makes no write", async () => {
    const fake = makeFakeCustomer(100_000_000);
    const mgr = makeManager(fake.customer);
    await expect(mgr.updateCampaignBudget(CUSTOMER_ID, "111", 150, false)).rejects.toThrow(
      MagnitudeCeilingBlocked
    );
    expect(fake.budgetUpdates).toHaveLength(0);
  });

  it("create_new_budget: refuses a +50% change and makes no write", async () => {
    const fake = makeFakeCustomer(100_000_000);
    const mgr = makeManager(fake.customer);
    await expect(mgr.updateCampaignBudget(CUSTOMER_ID, "111", 150, true)).rejects.toThrow(
      MagnitudeCeilingBlocked
    );
    expect(fake.mutateResourcesCalls).toHaveLength(0);
  });

  it("in-place: allows a +10% change", async () => {
    const fake = makeFakeCustomer(100_000_000);
    const mgr = makeManager(fake.customer);
    await mgr.updateCampaignBudget(CUSTOMER_ID, "111", 110, false);
    expect(fake.budgetUpdates).toHaveLength(1);
    expect(fake.budgetUpdates[0].amount_micros).toBe(110_000_000);
  });

  it("in-place: confirm_large_change without reason is refused, with reason is written", async () => {
    const fake = makeFakeCustomer(100_000_000);
    const mgr = makeManager(fake.customer);
    await expect(
      mgr.updateCampaignBudget(CUSTOMER_ID, "111", 150, false, { confirm_large_change: true })
    ).rejects.toThrow(/reason/);
    expect(fake.budgetUpdates).toHaveLength(0);

    const result = await mgr.updateCampaignBudget(CUSTOMER_ID, "111", 150, false, {
      confirm_large_change: true,
      reason: "launch week",
      overrideLog: { logPath: null, webhookUrl: null },
    });
    expect(fake.budgetUpdates).toHaveLength(1);
    expect((result as any).large_change_override).toBe(true);
  });
});
