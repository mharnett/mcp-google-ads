import { describe, it, expect } from "vitest";
import { buildCampaignCreatePayload } from "./campaignBuilder.js";
import { enums } from "google-ads-api";

describe("buildCampaignCreatePayload — back-compat gate", () => {
  it("existing call signature {name, budget} produces identical SEARCH + manual_cpc campaign as before", () => {
    const plan = buildCampaignCreatePayload({
      name: "Test Campaign",
      budget_amount_micros: 10_000_000,
    });

    // Budget payload shape — always dedicated (explicitly_shared: false)
    // to stay compatible with auto-bidding strategies.
    expect(plan.budget).toEqual({
      name: "Test Campaign Budget",
      amount_micros: 10_000_000,
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
      explicitly_shared: false,
    });

    // Campaign payload shape — status paused, SEARCH channel, manual_cpc
    expect(plan.campaign.name).toBe("Test Campaign");
    expect(plan.campaign.status).toBe(enums.CampaignStatus.PAUSED);
    expect(plan.campaign.advertising_channel_type).toBe(enums.AdvertisingChannelType.SEARCH);
    expect(plan.campaign.manual_cpc).toEqual({});
    // No extra bidding strategy fields
    expect((plan.campaign as any).maximize_conversions).toBeUndefined();
    expect((plan.campaign as any).target_cpa).toBeUndefined();
    expect((plan.campaign as any).target_spend).toBeUndefined();

    // No criteria (no geo / language targeting supplied)
    expect(plan.criteria).toEqual([]);
    // No start/end date
    expect(plan.campaign.start_date).toBeUndefined();
    expect(plan.campaign.end_date).toBeUndefined();
  });
});

describe("buildCampaignCreatePayload — budget is dedicated (not shared)", () => {
  it("emits explicitly_shared: false on the budget so auto-bidding strategies work", () => {
    // Google Ads API defaults explicitly_shared to true when omitted, which
    // makes MAXIMIZE_CONVERSIONS / TARGET_CPA reject with 'Bidding strategy
    // type is incompatible with shared budget'. Every campaign we create has
    // a 1:1 dedicated budget, so this field must always be false.
    const plan = buildCampaignCreatePayload({
      name: "Dedicated Budget Test",
      budget_amount_micros: 10_000_000,
      channel_type: "DEMAND_GEN",
      bidding_strategy: "MAXIMIZE_CONVERSIONS",
    });
    expect(plan.budget.explicitly_shared).toBe(false);
  });
});

describe("buildCampaignCreatePayload — DEMAND_GEN channel", () => {
  it("MAXIMIZE_CLICKS maps to target_spend; target_cpc_cap (dollars) becomes cpc_bid_ceiling_micros", () => {
    const plan = buildCampaignCreatePayload({
      name: "DG Max Clicks",
      budget_amount_micros: 5_000_000,
      channel_type: "DEMAND_GEN",
      bidding_strategy: "MAXIMIZE_CLICKS",
      target_cpc_cap: 2.5,
    });

    expect(plan.campaign.target_spend).toEqual({ cpc_bid_ceiling_micros: 2_500_000 });
    expect(plan.campaign.manual_cpc).toBeUndefined();
    expect(plan.campaign.maximize_conversions).toBeUndefined();
  });

  it("TARGET_CPA sets target_cpa_micros from dollars", () => {
    const plan = buildCampaignCreatePayload({
      name: "DG Target CPA",
      budget_amount_micros: 5_000_000,
      channel_type: "DEMAND_GEN",
      bidding_strategy: "TARGET_CPA",
      target_cpa: 25,
    });

    expect(plan.campaign.target_cpa).toEqual({ target_cpa_micros: 25_000_000 });
    expect(plan.campaign.manual_cpc).toBeUndefined();
    expect(plan.campaign.maximize_conversions).toBeUndefined();
  });

  it("emits one LOCATION criterion per geo_target_id and one LANGUAGE criterion (defaulting to 1000)", () => {
    const plan = buildCampaignCreatePayload({
      name: "DG Geo",
      budget_amount_micros: 1_000_000,
      channel_type: "DEMAND_GEN",
      geo_target_ids: ["21134", "21141"],
    });

    expect(plan.criteria).toEqual([
      { location: { geo_target_constant: "geoTargetConstants/21134" } },
      { location: { geo_target_constant: "geoTargetConstants/21141" } },
      { language: { language_constant: "languageConstants/1000" } },
    ]);
  });

  it("passes start_date and end_date through when provided (YYYY-MM-DD format)", () => {
    const plan = buildCampaignCreatePayload({
      name: "DG scheduled",
      budget_amount_micros: 1_000_000,
      channel_type: "DEMAND_GEN",
      start_date: "2026-05-01",
      end_date: "2026-06-30",
    });

    expect(plan.campaign.start_date).toBe("2026-05-01");
    expect(plan.campaign.end_date).toBe("2026-06-30");
  });

  it("TARGET_CPA without target_cpa throws a clear error", () => {
    expect(() =>
      buildCampaignCreatePayload({
        name: "X",
        budget_amount_micros: 1_000_000,
        channel_type: "DEMAND_GEN",
        bidding_strategy: "TARGET_CPA",
      })
    ).toThrow(/target_cpa/);
  });

  it("channel_type=DEMAND_GEN defaults bidding to MAXIMIZE_CONVERSIONS (no target_cpa)", () => {
    const plan = buildCampaignCreatePayload({
      name: "DG Campaign",
      budget_amount_micros: 20_000_000,
      channel_type: "DEMAND_GEN",
    });

    expect(plan.campaign.advertising_channel_type).toBe(enums.AdvertisingChannelType.DEMAND_GEN);
    expect(plan.campaign.maximize_conversions).toEqual({});
    expect(plan.campaign.manual_cpc).toBeUndefined();
  });

  it("DEMAND_GEN sets network_settings: content_network=true, others=false", () => {
    // Google Ads API requires at least one network flag to be true, rejecting
    // DG campaign create with "Must target at least one network." if all are
    // false. YouTube / Discover / Gmail inventory is served via the content
    // network for DG, so target_content_network must be true. Search-side
    // flags stay false (DG never runs on Search).
    const plan = buildCampaignCreatePayload({
      name: "DG Campaign",
      budget_amount_micros: 20_000_000,
      channel_type: "DEMAND_GEN",
    });

    expect(plan.campaign.network_settings).toEqual({
      target_google_search: false,
      target_search_network: false,
      target_content_network: true,
      target_partner_search_network: false,
    });
  });

  it("SEARCH does NOT set network_settings (back-compat — unchanged behavior)", () => {
    const plan = buildCampaignCreatePayload({
      name: "Search Campaign",
      budget_amount_micros: 10_000_000,
    });
    expect(plan.campaign.network_settings).toBeUndefined();
  });
});
