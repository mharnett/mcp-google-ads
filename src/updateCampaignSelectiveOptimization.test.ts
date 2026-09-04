/**
 * Manager-level tests for updateCampaignSelectiveOptimization — a single-field
 * campaign mutate that sets campaign.selective_optimization.conversion_actions
 * to a full-array replacement (not additive) built from bare numeric
 * conversion action IDs.
 *
 * Pattern source: updateCampaignBidding.test.ts — bypass the credential-requiring
 * constructor with Object.create() and stub getCustomer with a fake customer object.
 */

import { describe, expect, it } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CUSTOMER_ID = "1234567890";

function makeFakeCustomer() {
  const campaignsUpdateOps: any[] = [];

  const customer = {
    campaigns: {
      async update(ops: any[]) {
        campaignsUpdateOps.push(...ops);
        return { results: ops.map((o) => ({ resource_name: o.resource_name })) };
      },
    },
  };

  return { customer, campaignsUpdateOps };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("updateCampaignSelectiveOptimization", () => {
  it("builds a mutate with selective_optimization.conversion_actions as the exact full resource-name array", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.updateCampaignSelectiveOptimization(CUSTOMER_ID, "111", ["222", "333"]);

    expect(fake.campaignsUpdateOps).toHaveLength(1);
    const op = fake.campaignsUpdateOps[0];
    expect(op.resource_name).toBe("customers/1234567890/campaigns/111");
    expect(op.selective_optimization).toEqual({
      conversion_actions: [
        "customers/1234567890/conversionActions/222",
        "customers/1234567890/conversionActions/333",
      ],
    });
  });

  it("touches no other campaign field on the mutate op", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.updateCampaignSelectiveOptimization(CUSTOMER_ID, "111", ["222"]);

    const op = fake.campaignsUpdateOps[0];
    expect(Object.keys(op).sort()).toEqual(["resource_name", "selective_optimization"]);
  });

  it("replaces (not appends to) the previous array on a second call with a different ID list", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.updateCampaignSelectiveOptimization(CUSTOMER_ID, "111", ["222", "333"]);
    await mgr.updateCampaignSelectiveOptimization(CUSTOMER_ID, "111", ["444"]);

    expect(fake.campaignsUpdateOps).toHaveLength(2);
    const secondOp = fake.campaignsUpdateOps[1];
    expect(secondOp.selective_optimization.conversion_actions).toEqual([
      "customers/1234567890/conversionActions/444",
    ]);
  });
});
