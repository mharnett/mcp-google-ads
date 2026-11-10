import { describe, it, expect } from "vitest";
import {
  recommendationTypeEnum,
  planRecommendationSubscriptionChanges,
} from "./recommendationSubscriptionUpdate.js";

const CID = "4948252953";

describe("recommendationTypeEnum", () => {
  it("maps the two RSA types to their API enum values", () => {
    expect(recommendationTypeEnum("RESPONSIVE_SEARCH_AD")).toBe(18);
    expect(recommendationTypeEnum("RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH")).toBe(23);
  });
  it("rejects unknown and unspecified types", () => {
    expect(() => recommendationTypeEnum("BOGUS")).toThrow(/Unsupported/);
    expect(() => recommendationTypeEnum("UNSPECIFIED")).toThrow(/Unsupported/);
    expect(() => recommendationTypeEnum("UNKNOWN")).toThrow(/Unsupported/);
  });
});

describe("planRecommendationSubscriptionChanges", () => {
  it("existing ENABLED subscription + PAUSED -> one update on the type-keyed resource name, status only", () => {
    const plan = planRecommendationSubscriptionChanges(CID, ["RESPONSIVE_SEARCH_AD"], "PAUSED", new Map([[18, "ENABLED"]]));
    expect(plan.creates).toEqual([]);
    expect(plan.noops).toEqual([]);
    expect(plan.updates).toEqual([
      { resource_name: `customers/${CID}/recommendationSubscriptions/RESPONSIVE_SEARCH_AD`, status: 3 },
    ]);
  });

  it("no subscription row + PAUSED -> noop (never ticked, nothing to untick)", () => {
    const plan = planRecommendationSubscriptionChanges(CID, ["RESPONSIVE_SEARCH_AD"], "PAUSED", new Map());
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.noops).toEqual([{ type: "RESPONSIVE_SEARCH_AD", reason: "no subscription exists" }]);
  });

  it("already in the target status -> noop", () => {
    const plan = planRecommendationSubscriptionChanges(CID, ["RESPONSIVE_SEARCH_AD"], "PAUSED", new Map([[18, "PAUSED"]]));
    expect(plan.updates).toEqual([]);
    expect(plan.noops[0].reason).toMatch(/already PAUSED/);
  });

  it("no row + ENABLED -> create with type and status", () => {
    const plan = planRecommendationSubscriptionChanges(CID, ["RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH"], "ENABLED", new Map());
    expect(plan.creates).toEqual([{ type: 23, status: 2 }]);
  });

  it("existing PAUSED + ENABLED -> update", () => {
    const plan = planRecommendationSubscriptionChanges(CID, ["RESPONSIVE_SEARCH_AD"], "ENABLED", new Map([[18, "PAUSED"]]));
    expect(plan.updates).toEqual([{ resource_name: `customers/${CID}/recommendationSubscriptions/RESPONSIVE_SEARCH_AD`, status: 2 }]);
  });

  it("rejects an empty type list and a bad status", () => {
    expect(() => planRecommendationSubscriptionChanges(CID, [], "PAUSED", new Map())).toThrow(/at least one/i);
    expect(() => planRecommendationSubscriptionChanges(CID, ["RESPONSIVE_SEARCH_AD"], "REMOVED" as any, new Map())).toThrow(/status/i);
  });
});
