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
    // EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING = 3
    // Required for new campaigns; must be non-zero (proto3 strips default/0 values)
    expect(plan.campaign.contains_eu_political_advertising).toBe(3);
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
  it("sets demand_gen_campaign_settings.upgraded_targeting = false", () => {
    // Google defaults upgraded_targeting to TRUE, which routes location/language
    // targeting to the AD GROUP. Every campaign-level geo write then fails with a
    // masked `request_error: UNKNOWN` on operations.create.location, and the flag
    // is IMMUTABLE after creation — the campaign can only be rebuilt, never fixed.
    //
    // That is the exact configuration behind the 2026-07-16 Forcepoint geo leak:
    // $37,187 of $42,044 (88.4%) spent in countries the campaigns never targeted,
    // reporting a plausible $137 CPA throughout. Reproduced 2026-08-13 building the
    // Q3 retargeting flight — campaign 24140358400 had to be removed.
    const plan = buildCampaignCreatePayload({
      name: "DG Upgraded Targeting",
      budget_amount_micros: 5_000_000,
      channel_type: "DEMAND_GEN",
    });

    expect(plan.campaign.demand_gen_campaign_settings).toEqual({
      upgraded_targeting: false,
    });
  });

  it("SEARCH campaigns do not carry demand_gen_campaign_settings", () => {
    const plan = buildCampaignCreatePayload({
      name: "Search Campaign",
      budget_amount_micros: 5_000_000,
    });

    expect(plan.campaign.demand_gen_campaign_settings).toBeUndefined();
  });

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

  it("DEMAND_GEN sets correct network_settings and audience_setting", () => {
    // target_google_search=true signals DG surfaces (YouTube, Discover, Gmail).
    // target_content_network=false required — API rejects true as of Apr 2026.
    // audience_setting.use_audience_grouped=true is required for all DG campaigns.
    const plan = buildCampaignCreatePayload({
      name: "DG Campaign",
      budget_amount_micros: 20_000_000,
      channel_type: "DEMAND_GEN",
    });

    expect(plan.campaign.network_settings).toEqual({
      target_google_search: true,
      target_search_network: false,
      target_content_network: false,
      target_partner_search_network: false,
    });
    expect(plan.campaign.audience_setting).toEqual({ use_audience_grouped: true });
  });

  it("SEARCH does NOT set network_settings (back-compat — unchanged behavior)", () => {
    const plan = buildCampaignCreatePayload({
      name: "Search Campaign",
      budget_amount_micros: 10_000_000,
    });
    expect(plan.campaign.network_settings).toBeUndefined();
  });
});

describe("buildCampaignCreatePayload — geo_target_type_setting always PRESENCE", () => {
  // Google Ads API defaults geo_target_type_setting.positive_geo_target_type to
  // PRESENCE_OR_INTEREST when omitted, which serves ads worldwide to anyone
  // "interested in" the targeted location regardless of correct geo_target_ids.
  // Caught 3x in production (2026-07-20, 2026-07-31, 2026-08-01) via next-day
  // geo_sweep monitoring, never at creation time — this must always be PRESENCE.
  it("sets positive_geo_target_type=PRESENCE on a SEARCH campaign with geo targeting", () => {
    const plan = buildCampaignCreatePayload({
      name: "Search Geo",
      budget_amount_micros: 10_000_000,
      geo_target_ids: ["2840"],
    });
    expect(plan.campaign.geo_target_type_setting).toEqual({
      positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
    });
  });

  it("sets positive_geo_target_type=PRESENCE on a DEMAND_GEN campaign with geo targeting", () => {
    const plan = buildCampaignCreatePayload({
      name: "DG Geo",
      budget_amount_micros: 10_000_000,
      channel_type: "DEMAND_GEN",
      geo_target_ids: ["21134"],
    });
    expect(plan.campaign.geo_target_type_setting).toEqual({
      positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
    });
  });

  it("sets positive_geo_target_type=PRESENCE even when no geo_target_ids are provided (back-compat call)", () => {
    const plan = buildCampaignCreatePayload({
      name: "Test Campaign",
      budget_amount_micros: 10_000_000,
    });
    expect(plan.campaign.geo_target_type_setting).toEqual({
      positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
    });
  });
});
