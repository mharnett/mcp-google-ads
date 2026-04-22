import { describe, it, expect } from "vitest";
import { buildAdGroupAdResourceName } from "./resourceNames.js";

describe("buildAdGroupAdResourceName", () => {
  // Regression: previous code built `customers/{cid}/adGroupAds/{adId}`
  // (missing adGroupId + ~ separator). That crashed adGroupAdLabels.create,
  // adGroupAds.update, and adGroupAds.remove with
  // "part of the resource name is invalid".
  it("produces composite `{adGroupId}~{adId}` format", () => {
    const rn = buildAdGroupAdResourceName("4948252953", "186741271357", "806351154918");
    expect(rn).toBe("customers/4948252953/adGroupAds/186741271357~806351154918");
  });

  it("never emits a resource name with a bare ad id after the slash", () => {
    const rn = buildAdGroupAdResourceName("4948252953", "186741271357", "806351154918");
    expect(rn).toMatch(/adGroupAds\/\d+~\d+$/);
    expect(rn).not.toMatch(/adGroupAds\/\d+$/); // the broken shape
  });

  it("accepts numeric ids", () => {
    const rn = buildAdGroupAdResourceName("4948252953", 186741271357, 806351154918);
    expect(rn).toBe("customers/4948252953/adGroupAds/186741271357~806351154918");
  });
});
