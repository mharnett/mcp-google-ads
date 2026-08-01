/**
 * Manager-level regression tests for the portfolio-bid-strategy silent-detach
 * guard. Both updateCampaignBidding and updateCampaignBudget's
 * createNewBudget path build a campaign mutate that clears the
 * `bidding_strategy` (portfolio) oneof as a side effect. Before this guard,
 * a caller updating a campaign's target CPA — or breaking a shared budget —
 * on a campaign attached to a portfolio strategy would silently detach it.
 * These tests drive the REAL manager methods (not just the pure builder) so
 * the wiring between the query, the guard, and the mutate call is covered.
 *
 * Pattern source: createResponsiveSearchAd.labels.test.ts — bypass the
 * credential-requiring constructor with Object.create() and stub
 * getCustomer with a fake customer object.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";
import { PortfolioDetachBlocked } from "./biddingUpdate.js";

const CUSTOMER_ID = "1234567890";
const PORTFOLIO_RESOURCE = "customers/1234567890/biddingStrategies/999";

interface FakeCampaign {
  id: string;
  name: string;
  bidding_strategy?: string;
  bidding_strategy_type?: number;
  budget_id?: string;
  budget_amount_micros?: number;
}

function makeFakeCustomer(campaign: FakeCampaign) {
  const campaignsUpdateOps: any[] = [];
  const mutateResourcesCalls: any[] = [];
  const campaignBudgetsUpdateOps: any[] = [];

  const customer = {
    async query(_gaql: string) {
      return [
        {
          campaign: {
            id: campaign.id,
            name: campaign.name,
            bidding_strategy: campaign.bidding_strategy,
            bidding_strategy_type: campaign.bidding_strategy_type,
          },
          campaign_budget: campaign.budget_id
            ? {
                id: campaign.budget_id,
                amount_micros: campaign.budget_amount_micros ?? 0,
                name: `${campaign.name} Budget`,
              }
            : undefined,
        },
      ];
    },
    campaigns: {
      async update(ops: any[]) {
        campaignsUpdateOps.push(...ops);
        return { results: ops.map((o) => ({ resource_name: o.resource_name })) };
      },
    },
    campaignBudgets: {
      async update(ops: any[]) {
        campaignBudgetsUpdateOps.push(...ops);
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

  return { customer, campaignsUpdateOps, mutateResourcesCalls, campaignBudgetsUpdateOps };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("updateCampaignBidding — portfolio detach guard", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  it("throws PortfolioDetachBlocked for a portfolio-attached campaign and never calls campaigns.update", async () => {
    fake = makeFakeCustomer({
      id: "111",
      name: "Portfolio Campaign",
      bidding_strategy: PORTFOLIO_RESOURCE,
      bidding_strategy_type: 6, // TARGET_CPA
    });
    mgr = makeManager(fake.customer);

    await expect(
      mgr.updateCampaignBidding(CUSTOMER_ID, "111", { target_cpa_dollars: 50 })
    ).rejects.toThrow(PortfolioDetachBlocked);

    expect(fake.campaignsUpdateOps).toHaveLength(0);
  });

  it("proceeds and calls campaigns.update exactly once for a standalone (non-portfolio) campaign", async () => {
    fake = makeFakeCustomer({
      id: "222",
      name: "Standalone Campaign",
      bidding_strategy: undefined,
      bidding_strategy_type: 6, // TARGET_CPA
    });
    mgr = makeManager(fake.customer);

    const result = await mgr.updateCampaignBidding(CUSTOMER_ID, "222", { target_cpa_dollars: 50 });

    expect(fake.campaignsUpdateOps).toHaveLength(1);
    expect(result.campaign_id).toBe("222");
  });
});

describe("updateCampaignBudget(createNewBudget=true) — portfolio detach guard", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  it("throws PortfolioDetachBlocked for a portfolio-attached campaign and never calls mutateResources", async () => {
    fake = makeFakeCustomer({
      id: "333",
      name: "Portfolio Budget Campaign",
      bidding_strategy: PORTFOLIO_RESOURCE,
      budget_id: "777",
      budget_amount_micros: 10_000_000,
    });
    mgr = makeManager(fake.customer);

    await expect(
      mgr.updateCampaignBudget(CUSTOMER_ID, "333", 25, true)
    ).rejects.toThrow(PortfolioDetachBlocked);

    expect(fake.mutateResourcesCalls).toHaveLength(0);
  });

  it("proceeds unchanged for a non-portfolio campaign (regression check on the atomic-create-budget path)", async () => {
    fake = makeFakeCustomer({
      id: "444",
      name: "Standalone Budget Campaign",
      bidding_strategy: undefined,
      budget_id: "888",
      budget_amount_micros: 10_000_000,
    });
    mgr = makeManager(fake.customer);

    const result = await mgr.updateCampaignBudget(CUSTOMER_ID, "444", 25, true);

    expect(fake.mutateResourcesCalls).toHaveLength(1);
    expect(result.action).toBe("created_new_budget");
    expect(result.new_daily_budget).toBe(25);
  });
});

describe("detachPortfolioBidStrategy", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  it("detaches a portfolio-attached campaign: returns the expected shape and calls campaigns.update once with maximize_conversions target_cpa_micros:0", async () => {
    fake = makeFakeCustomer({
      id: "555",
      name: "Portfolio Campaign",
      bidding_strategy: PORTFOLIO_RESOURCE,
    });
    mgr = makeManager(fake.customer);

    const result = await mgr.detachPortfolioBidStrategy(CUSTOMER_ID, "555");

    expect(fake.campaignsUpdateOps).toHaveLength(1);
    expect(fake.campaignsUpdateOps[0].maximize_conversions).toEqual({ target_cpa_micros: 0 });
    expect(fake.campaignsUpdateOps[0].resource_name).toBe("customers/1234567890/campaigns/555");

    expect(result).toEqual({
      campaign_id: "555",
      campaign_name: "Portfolio Campaign",
      previous_portfolio_strategy_resource: PORTFOLIO_RESOURCE,
      new_strategy: "MAXIMIZE_CONVERSIONS",
      warning: "Detached from portfolio strategy → campaign-level Maximize Conversions with no target. Re-apply tCPA/tROAS targets if needed.",
    });
  });

  it("throws 'nothing to detach' for a non-portfolio campaign and never calls campaigns.update", async () => {
    fake = makeFakeCustomer({
      id: "666",
      name: "Standalone Campaign",
      bidding_strategy: undefined,
    });
    mgr = makeManager(fake.customer);

    await expect(mgr.detachPortfolioBidStrategy(CUSTOMER_ID, "666")).rejects.toThrow(
      "Campaign 666 is not attached to a portfolio bid strategy — nothing to detach"
    );
    expect(fake.campaignsUpdateOps).toHaveLength(0);
  });
});
