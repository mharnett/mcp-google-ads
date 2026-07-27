import { describe, it, expect } from "vitest";
import {
  buildBiddingCampaignUpdate,
  BIDDING_TYPE_ENUM_TO_NAME,
} from "./biddingUpdate.js";

const RN = "customers/4948252953/campaigns/22989093772";

// The bidding-payload oneof fields we care about (excludes resource_name).
const BIDDING_KEYS = [
  "maximize_conversions",
  "maximize_conversion_value",
  "target_cpa",
  "target_roas",
  "manual_cpc",
  "target_spend",
];

function biddingFieldOf(update: Record<string, any>) {
  const keys = Object.keys(update).filter((k) => BIDDING_KEYS.includes(k));
  return { keys, field: keys[0], value: update[keys[0]] };
}

describe("buildBiddingCampaignUpdate — anchors", () => {
  it("MAXIMIZE_CONVERSIONS with no target carries an explicit target_cpa_micros:0 (never {})", () => {
    // THE bug: an empty {} sub-message gets dropped from the google-ads field
    // mask, so the mutate silently no-ops. The zero sentinel keeps it non-empty.
    const u = buildBiddingCampaignUpdate("MAXIMIZE_CONVERSIONS", { resourceName: RN });
    expect(u.maximize_conversions).toEqual({ target_cpa_micros: 0 });
  });

  it("MAXIMIZE_CONVERSIONS with a target passes the target through", () => {
    const u = buildBiddingCampaignUpdate("MAXIMIZE_CONVERSIONS", {
      resourceName: RN,
      targetCpaMicros: 4_400_000_000,
    });
    expect(u.maximize_conversions).toEqual({ target_cpa_micros: 4_400_000_000 });
  });

  it("MAXIMIZE_CONVERSION_VALUE with no target carries an explicit target_roas:0 (never {})", () => {
    const u = buildBiddingCampaignUpdate("MAXIMIZE_CONVERSION_VALUE", { resourceName: RN });
    expect(u.maximize_conversion_value).toEqual({ target_roas: 0 });
  });

  it("MAXIMIZE_CONVERSION_VALUE with a target passes tROAS through", () => {
    const u = buildBiddingCampaignUpdate("MAXIMIZE_CONVERSION_VALUE", {
      resourceName: RN,
      targetRoas: 3,
    });
    expect(u.maximize_conversion_value).toEqual({ target_roas: 3 });
  });

  it("TARGET_CPA sets target_cpa and requires a target", () => {
    const u = buildBiddingCampaignUpdate("TARGET_CPA", {
      resourceName: RN,
      targetCpaMicros: 200_000_000,
    });
    expect(u.target_cpa).toEqual({ target_cpa_micros: 200_000_000 });
    expect(() => buildBiddingCampaignUpdate("TARGET_CPA", { resourceName: RN })).toThrow();
  });

  it("TARGET_ROAS sets target_roas and requires a target", () => {
    const u = buildBiddingCampaignUpdate("TARGET_ROAS", { resourceName: RN, targetRoas: 4 });
    expect(u.target_roas).toEqual({ target_roas: 4 });
    expect(() => buildBiddingCampaignUpdate("TARGET_ROAS", { resourceName: RN })).toThrow();
  });

  it("always includes the resource_name and rejects unknown strategies", () => {
    const u = buildBiddingCampaignUpdate("MAXIMIZE_CONVERSIONS", { resourceName: RN });
    expect(u.resource_name).toBe(RN);
    expect(() => buildBiddingCampaignUpdate("NONSENSE", { resourceName: RN })).toThrow();
  });
});

describe("buildBiddingCampaignUpdate — shape invariant (no silent no-op)", () => {
  // Every smart-bidding switch must set EXACTLY ONE bidding field, and that
  // field must be a NON-EMPTY object — an empty {} is what the field mask drops.
  const cases: Array<[string, Record<string, any>]> = [
    ["MAXIMIZE_CONVERSIONS", { resourceName: RN }],
    ["MAXIMIZE_CONVERSIONS", { resourceName: RN, targetCpaMicros: 200_000_000 }],
    ["MAXIMIZE_CONVERSION_VALUE", { resourceName: RN }],
    ["MAXIMIZE_CONVERSION_VALUE", { resourceName: RN, targetRoas: 3 }],
    ["TARGET_CPA", { resourceName: RN, targetCpaMicros: 200_000_000 }],
    ["TARGET_ROAS", { resourceName: RN, targetRoas: 3 }],
  ];

  it.each(cases)("%s sets exactly one non-empty bidding field", (strategy, opts) => {
    const u = buildBiddingCampaignUpdate(strategy, opts as any);
    const { keys, value } = biddingFieldOf(u);
    expect(keys).toHaveLength(1);
    expect(typeof value).toBe("object");
    expect(Object.keys(value).length).toBeGreaterThan(0);
  });
});

describe("BIDDING_TYPE_ENUM_TO_NAME", () => {
  it("maps the smart-bidding enums used by GAQL reads", () => {
    expect(BIDDING_TYPE_ENUM_TO_NAME[10]).toBe("MAXIMIZE_CONVERSIONS");
    expect(BIDDING_TYPE_ENUM_TO_NAME[11]).toBe("MAXIMIZE_CONVERSION_VALUE");
  });
});
