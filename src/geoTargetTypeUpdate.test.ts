import { describe, it, expect } from "vitest";
import {
  buildGeoTargetTypeCampaignUpdate,
  buildGeoTargetTypeCampaignUpdates,
  POSITIVE_GEO_TARGET_TYPE,
} from "./geoTargetTypeUpdate.js";

const RN = "customers/4948252953/campaigns/22923427830";
const RN2 = "customers/4948252953/campaigns/22923427831";

describe("buildGeoTargetTypeCampaignUpdate — anchors", () => {
  it("maps PRESENCE to enum 7", () => {
    const u = buildGeoTargetTypeCampaignUpdate(RN, "PRESENCE");
    expect(u.geo_target_type_setting.positive_geo_target_type).toBe(7);
  });

  it("maps PRESENCE_OR_INTEREST to enum 5", () => {
    const u = buildGeoTargetTypeCampaignUpdate(RN, "PRESENCE_OR_INTEREST");
    expect(u.geo_target_type_setting.positive_geo_target_type).toBe(5);
  });

  it("always includes the resource_name", () => {
    const u = buildGeoTargetTypeCampaignUpdate(RN, "PRESENCE");
    expect(u.resource_name).toBe(RN);
  });

  it("produces only resource_name + geo_target_type_setting (the field mask is derived from these two)", () => {
    const u = buildGeoTargetTypeCampaignUpdate(RN, "PRESENCE");
    expect(Object.keys(u).sort()).toEqual(["geo_target_type_setting", "resource_name"]);
    expect(Object.keys(u.geo_target_type_setting)).toEqual(["positive_geo_target_type"]);
  });

  it("rejects SEARCH_INTEREST — not one of the two allowed modes", () => {
    expect(() => buildGeoTargetTypeCampaignUpdate(RN, "SEARCH_INTEREST")).toThrow();
  });

  it("rejects an unknown mode rather than silently defaulting", () => {
    expect(() => buildGeoTargetTypeCampaignUpdate(RN, "BOGUS")).toThrow();
    expect(() => buildGeoTargetTypeCampaignUpdate(RN, "")).toThrow();
  });
});

describe("buildGeoTargetTypeCampaignUpdates", () => {
  it("builds one update per resource name, all with the same mode", () => {
    const updates = buildGeoTargetTypeCampaignUpdates([RN, RN2], "PRESENCE");
    expect(updates).toHaveLength(2);
    expect(updates[0].resource_name).toBe(RN);
    expect(updates[1].resource_name).toBe(RN2);
    expect(updates[0].geo_target_type_setting.positive_geo_target_type).toBe(7);
    expect(updates[1].geo_target_type_setting.positive_geo_target_type).toBe(7);
  });

  it("rejects an invalid mode before building any update", () => {
    expect(() => buildGeoTargetTypeCampaignUpdates([RN, RN2], "PRESENCE_OR_NOPE")).toThrow();
  });
});

describe("POSITIVE_GEO_TARGET_TYPE", () => {
  it("exposes exactly the two supported modes", () => {
    expect(POSITIVE_GEO_TARGET_TYPE).toEqual({
      PRESENCE: 7,
      PRESENCE_OR_INTEREST: 5,
    });
  });
});
