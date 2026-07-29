import { describe, it, expect } from "vitest";
import {
  buildAdRotationCampaignUpdate,
  AD_SERVING_OPTIMIZATION_STATUS,
  AD_SERVING_OPTIMIZATION_STATUS_ENUM_TO_NAME,
} from "./adRotationUpdate.js";

const RN = "customers/4948252953/campaigns/22923427830";

describe("buildAdRotationCampaignUpdate — anchors", () => {
  it("maps ROTATE to enum 4 (self-reverts to OPTIMIZE after 90 days per Google)", () => {
    const u = buildAdRotationCampaignUpdate(RN, "ROTATE");
    expect(u.ad_serving_optimization_status).toBe(4);
  });

  it("maps ROTATE_INDEFINITELY to enum 5 (does NOT auto-revert)", () => {
    const u = buildAdRotationCampaignUpdate(RN, "ROTATE_INDEFINITELY");
    expect(u.ad_serving_optimization_status).toBe(5);
  });

  it("maps OPTIMIZE to enum 2", () => {
    const u = buildAdRotationCampaignUpdate(RN, "OPTIMIZE");
    expect(u.ad_serving_optimization_status).toBe(2);
  });

  it("maps CONVERSION_OPTIMIZE to enum 3", () => {
    const u = buildAdRotationCampaignUpdate(RN, "CONVERSION_OPTIMIZE");
    expect(u.ad_serving_optimization_status).toBe(3);
  });

  it("always includes the resource_name", () => {
    const u = buildAdRotationCampaignUpdate(RN, "ROTATE");
    expect(u.resource_name).toBe(RN);
  });

  it("rejects an unknown mode rather than silently defaulting", () => {
    expect(() => buildAdRotationCampaignUpdate(RN, "ROTATE_FOREVER")).toThrow();
    expect(() => buildAdRotationCampaignUpdate(RN, "")).toThrow();
  });
});

describe("AD_SERVING_OPTIMIZATION_STATUS", () => {
  it("exposes the enum values the tool schema documents", () => {
    expect(AD_SERVING_OPTIMIZATION_STATUS).toEqual({
      OPTIMIZE: 2,
      CONVERSION_OPTIMIZE: 3,
      ROTATE: 4,
      ROTATE_INDEFINITELY: 5,
    });
  });
});

describe("AD_SERVING_OPTIMIZATION_STATUS_ENUM_TO_NAME", () => {
  it("is the exact inverse of AD_SERVING_OPTIMIZATION_STATUS", () => {
    for (const [name, num] of Object.entries(AD_SERVING_OPTIMIZATION_STATUS)) {
      expect(AD_SERVING_OPTIMIZATION_STATUS_ENUM_TO_NAME[num]).toBe(name);
    }
  });
});
