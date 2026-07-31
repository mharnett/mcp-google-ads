import { describe, it, expect } from "vitest";
import {
  buildBiddingCampaignUpdate,
  BIDDING_TYPE_ENUM_TO_NAME,
  wouldDetachPortfolioStrategy,
  PortfolioDetachBlocked,
  DEFAULT_MAGNITUDE_CEILING_PCT,
  computeMagnitudeDeltaPct,
  exceedsMagnitudeCeiling,
  isStrategyLooseningChange,
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

  // Ground truth from the installed google-ads-api v23 BiddingStrategyType enum
  // (node_modules/google-ads-api/build/src/protos/autogen/enums.d.ts). The prior
  // map was built from a misremembered enum ordering and was wrong for every
  // entry except 10/11 — which is exactly why the test above never caught it.
  // Anchors below pin each numeric value this tool can actually round-trip
  // through updateCampaignBidding's "preserve current strategy" fallback.
  it.each([
    [3, "MANUAL_CPC"],
    [6, "TARGET_CPA"],
    [8, "TARGET_ROAS"],
    [9, "MAXIMIZE_CLICKS"], // API type TARGET_SPEND=9, exposed to callers as MAXIMIZE_CLICKS
    [10, "MAXIMIZE_CONVERSIONS"],
    [11, "MAXIMIZE_CONVERSION_VALUE"],
  ])("enum %i maps to the real BiddingStrategyType name %s", (enumValue, name) => {
    expect(BIDDING_TYPE_ENUM_TO_NAME[enumValue]).toBe(name);
  });

  it("every mapped name round-trips through buildBiddingCampaignUpdate without throwing (or is a documented target-required exception)", () => {
    const targetRequired = new Set(["TARGET_CPA", "TARGET_ROAS"]);
    for (const name of Object.values(BIDDING_TYPE_ENUM_TO_NAME)) {
      if (targetRequired.has(name)) {
        expect(() => buildBiddingCampaignUpdate(name, { resourceName: RN })).toThrow();
      } else {
        expect(() => buildBiddingCampaignUpdate(name, { resourceName: RN })).not.toThrow();
      }
    }
  });

  it("does not map enum values outside this tool's supported strategy set (ENHANCED_CPC=2, PERCENT_CPC=12) — better to fall through to UNKNOWN and throw than silently misapply a strategy", () => {
    expect(BIDDING_TYPE_ENUM_TO_NAME[2]).toBeUndefined();
    expect(BIDDING_TYPE_ENUM_TO_NAME[12]).toBeUndefined();
  });
});

describe("wouldDetachPortfolioStrategy", () => {
  it("returns true for a populated portfolio strategy resource name", () => {
    expect(
      wouldDetachPortfolioStrategy("customers/4948252953/biddingStrategies/111")
    ).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(wouldDetachPortfolioStrategy(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(wouldDetachPortfolioStrategy(null)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(wouldDetachPortfolioStrategy("")).toBe(false);
  });
});

describe("PortfolioDetachBlocked", () => {
  it("carries campaignId, campaignName, portfolioStrategyResource and names both in the message", () => {
    const err = new PortfolioDetachBlocked(
      "22989093772",
      "Brand — Search",
      "customers/4948252953/biddingStrategies/111"
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.campaignId).toBe("22989093772");
    expect(err.campaignName).toBe("Brand — Search");
    expect(err.portfolioStrategyResource).toBe(
      "customers/4948252953/biddingStrategies/111"
    );
    expect(err.message).toContain("customers/4948252953/biddingStrategies/111");
    expect(err.message).toContain("google_ads_detach_portfolio_bid_strategy");
  });
});

// Origin: 2026-07-31 Forcepoint session — 4 live campaigns' target CPA was
// changed via updateCampaignBidding with no guard at all (a companion
// magnitude-ceiling gate exists in a DIFFERENT repo, automation/quality-
// control's gads_apply.py, DEFAULT_MAGNITUDE_CEILING_PCT=20.0, but has zero
// integration with this MCP server). These mirror that repo's naming/
// threshold for cross-repo consistency, extended to cover a case Python's
// version doesn't need to: this session's actual mutations were "remove an
// existing target entirely" then "add a target where none existed" — neither
// is a clean percentage delta from a baseline, and losing a target
// (portfolio/strategy detach) is the literal incident this whole feature
// class was built for.
describe("computeMagnitudeDeltaPct", () => {
  it("computes signed percent change from an existing baseline", () => {
    expect(computeMagnitudeDeltaPct(2_200_000_000, 2_700_000_000)).toBeCloseTo(22.727, 2);
    expect(computeMagnitudeDeltaPct(4_400_000_000, 6_000_000_000)).toBeCloseTo(36.364, 2);
    expect(computeMagnitudeDeltaPct(1_000_000, 500_000)).toBeCloseTo(-50, 5);
  });

  it("returns null when there is no usable baseline (undefined, null, or zero) — no percentage is meaningful", () => {
    expect(computeMagnitudeDeltaPct(undefined, 2_700_000_000)).toBeNull();
    expect(computeMagnitudeDeltaPct(null, 2_700_000_000)).toBeNull();
    expect(computeMagnitudeDeltaPct(0, 2_700_000_000)).toBeNull();
  });

  it("returns null when there is no new value to compare (e.g. dropping a target)", () => {
    expect(computeMagnitudeDeltaPct(2_200_000_000, undefined)).toBeNull();
    expect(computeMagnitudeDeltaPct(2_200_000_000, null)).toBeNull();
  });
});

describe("exceedsMagnitudeCeiling", () => {
  it("flags a delta beyond the default 20% ceiling in either direction", () => {
    expect(DEFAULT_MAGNITUDE_CEILING_PCT).toBe(20);
    expect(exceedsMagnitudeCeiling(4_400_000_000, 6_000_000_000)).toBe(true); // +36.4%
    expect(exceedsMagnitudeCeiling(1_000_000, 500_000)).toBe(true); // -50%
  });

  it("does not flag a delta within the ceiling", () => {
    expect(exceedsMagnitudeCeiling(2_200_000_000, 2_400_000_000)).toBe(false); // +9.1%
  });

  it("respects a caller-supplied ceiling override", () => {
    expect(exceedsMagnitudeCeiling(2_200_000_000, 2_700_000_000, 30)).toBe(false); // +22.7% < 30%
    expect(exceedsMagnitudeCeiling(2_200_000_000, 2_700_000_000, 10)).toBe(true); // +22.7% > 10%
  });

  it("never flags when there is no baseline to compare against (handled separately by isStrategyLooseningChange)", () => {
    expect(exceedsMagnitudeCeiling(undefined, 2_700_000_000)).toBe(false);
    expect(exceedsMagnitudeCeiling(0, 2_700_000_000)).toBe(false);
  });
});

describe("isStrategyLooseningChange", () => {
  it("flags removing an existing numeric target entirely (cap -> uncapped) — this session's first mutation", () => {
    expect(
      isStrategyLooseningChange(2_200_000_000, undefined, "TARGET_CPA", "MAXIMIZE_CONVERSIONS")
    ).toBe(true);
  });

  it("does NOT flag adding a target where none existed — tightening, not loosening (this session's second mutation)", () => {
    expect(
      isStrategyLooseningChange(undefined, 2_700_000_000, "MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSIONS")
    ).toBe(false);
  });

  it("flags switching away from a target-based strategy even if a target value is still nominally present", () => {
    expect(
      isStrategyLooseningChange(2_200_000_000, 2_200_000_000, "TARGET_CPA", "MANUAL_CPC")
    ).toBe(true);
  });

  it("does not flag a plain value change within the same target-based strategy (percentage math handles that)", () => {
    expect(
      isStrategyLooseningChange(2_200_000_000, 2_700_000_000, "TARGET_CPA", "TARGET_CPA")
    ).toBe(false);
  });

  it("does not flag when neither side ever had a target and strategy is unchanged", () => {
    expect(
      isStrategyLooseningChange(undefined, undefined, "MANUAL_CPC", "MANUAL_CPC")
    ).toBe(false);
  });
});
