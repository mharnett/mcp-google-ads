/**
 * Manager-level regression tests for campaign start/end dates.
 *
 * Google Ads API v24 has no Campaign.start_date / Campaign.end_date: the
 * resource carries start_date_time / end_date_time ("yyyy-MM-dd HH:mm:ss",
 * customer time zone). The builder used to emit the legacy keys, which the
 * protobuf encoder drops without an error, so a campaign created with dates
 * started on creation day and never ended.
 *
 * These tests drive the REAL createCampaign with a fake customer and then
 * push the captured payload through the installed v24 Campaign message, so
 * a key the API version does not define fails here instead of in an account.
 *
 * Pattern source: updateCampaignBidding.test.ts (Object.create + stubbed
 * getCustomer). No network, no credentials.
 */

import { describe, expect, it } from "vitest";
import { enums, resources } from "google-ads-api";

import { GoogleAdsManager } from "./index.js";

const CUSTOMER_ID = "1234567890";
const BUDGET_RN = `customers/${CUSTOMER_ID}/campaignBudgets/555`;
const CAMPAIGN_RN = `customers/${CUSTOMER_ID}/campaigns/777`;

function makeFakeCustomer() {
  const budgetCreates: any[] = [];
  const campaignCreates: any[] = [];
  const mutateResourcesCalls: any[][] = [];
  const criteriaCreates: any[] = [];

  const customer = {
    campaignBudgets: {
      async create(payloads: any[]) {
        budgetCreates.push(...payloads);
        return { results: [{ resource_name: BUDGET_RN }] };
      },
    },
    campaigns: {
      async create(payloads: any[]) {
        campaignCreates.push(...payloads);
        return { results: [{ resource_name: CAMPAIGN_RN }] };
      },
    },
    campaignCriteria: {
      async create(payloads: any[]) {
        criteriaCreates.push(...payloads);
        return { results: [] };
      },
    },
    async mutateResources(ops: any[]) {
      mutateResourcesCalls.push(ops);
      return {
        mutate_operation_responses: [{ campaign_result: { resource_name: CAMPAIGN_RN } }],
      };
    },
  };

  return { customer, budgetCreates, campaignCreates, mutateResourcesCalls, criteriaCreates };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => fakeCustomer;
  (mgr as any).autoLabelCreated = async () => undefined;
  return mgr;
}

/** What the API would actually receive: the payload after v24 proto encoding. */
function asSentToApi(payload: Record<string, any>): Record<string, any> {
  const Campaign = (resources as any).Campaign;
  return Campaign.toObject(Campaign.fromObject(payload));
}

describe("createCampaign — Demand Gen start and end dates", () => {
  it("demand gen create with dates sends both dates in the campaign payload", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.createCampaign(CUSTOMER_ID, {
      name: "DG dated flight",
      budget_amount_micros: 10_000_000,
      channel_type: "DEMAND_GEN",
      start_date: "2026-11-12",
      end_date: "2026-11-30",
    });

    expect(fake.campaignCreates).toHaveLength(0);
    expect(fake.mutateResourcesCalls).toHaveLength(1);
    const [op] = fake.mutateResourcesCalls[0];
    expect(op.entity).toBe("campaign");
    expect(op.operation).toBe("create");

    const sent = asSentToApi(op.resource);
    expect(sent.start_date_time).toBe("2026-11-12 00:00:00");
    expect(sent.end_date_time).toBe("2026-11-30 23:59:59");
    // Safety behaviour untouched.
    expect(sent.status).toBe(enums.CampaignStatus.PAUSED);
    expect(sent.campaign_budget).toBe(BUDGET_RN);
  });

  it("demand gen create without dates sends no date fields", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.createCampaign(CUSTOMER_ID, {
      name: "DG open ended",
      budget_amount_micros: 10_000_000,
      channel_type: "DEMAND_GEN",
    });

    const [op] = fake.mutateResourcesCalls[0];
    expect(op.resource).not.toHaveProperty("start_date_time");
    expect(op.resource).not.toHaveProperty("end_date_time");
  });

  it("rejects a date that is not YYYY-MM-DD before creating the budget", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await expect(
      mgr.createCampaign(CUSTOMER_ID, {
        name: "DG bad date",
        budget_amount_micros: 10_000_000,
        channel_type: "DEMAND_GEN",
        end_date: "11/30/2026",
      })
    ).rejects.toThrow(/end_date.*YYYY-MM-DD/);

    expect(fake.budgetCreates).toHaveLength(0);
    expect(fake.mutateResourcesCalls).toHaveLength(0);
  });
});

describe("createCampaign — Search creates", () => {
  it("search create without dates sends the same payload as before", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.createCampaign(CUSTOMER_ID, {
      name: "Search plain",
      budget_amount_micros: 10_000_000,
    });

    // Still the typed campaigns.create path, never mutateResources.
    expect(fake.mutateResourcesCalls).toHaveLength(0);
    expect(fake.criteriaCreates).toHaveLength(0);
    expect(fake.campaignCreates).toEqual([
      {
        name: "Search plain",
        status: enums.CampaignStatus.PAUSED,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        contains_eu_political_advertising: 3,
        geo_target_type_setting: {
          positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
        },
        network_settings: {
          target_google_search: true,
          target_search_network: false,
          target_content_network: false,
          target_partner_search_network: false,
        },
        manual_cpc: {},
        campaign_budget: BUDGET_RN,
      },
    ]);
  });

  it("search create with dates sends both dates in the campaign payload", async () => {
    const fake = makeFakeCustomer();
    const mgr = makeManager(fake.customer);

    await mgr.createCampaign(CUSTOMER_ID, {
      name: "Search dated",
      budget_amount_micros: 10_000_000,
      start_date: "2026-11-12",
      end_date: "2026-11-30",
    });

    expect(fake.mutateResourcesCalls).toHaveLength(0);
    expect(fake.campaignCreates).toHaveLength(1);
    const sent = asSentToApi(fake.campaignCreates[0]);
    expect(sent.start_date_time).toBe("2026-11-12 00:00:00");
    expect(sent.end_date_time).toBe("2026-11-30 23:59:59");
    expect(sent.status).toBe(enums.CampaignStatus.PAUSED);
  });
});
