import { describe, it, expect } from "vitest";
import { validateDemandGenAd, buildDemandGenAdPayload } from "./validateDemandGenAd.js";

const BASE_VALID = {
  final_urls: ["https://example.com/"],
  business_name: "Example Org",
  call_to_action: "LEARN_MORE",
  marketing_image_asset_ids: ["123"],
  headlines: ["Headline 1", "Headline 2"],
  long_headlines: ["A longer headline that still fits within ninety characters for a DG ad."],
  descriptions: ["Description 1", "Description 2"],
};

describe("validateDemandGenAd — base case", () => {
  it("accepts a fully-valid DG ad", () => {
    const result = validateDemandGenAd(BASE_VALID);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateDemandGenAd — headlines", () => {
  it("rejects headline > 40 chars", () => {
    const result = validateDemandGenAd({
      ...BASE_VALID,
      headlines: ["x".repeat(41), "Headline 2"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Headline 1 too long/.test(e))).toBe(true);
  });

  it("rejects more than 5 headlines", () => {
    const result = validateDemandGenAd({
      ...BASE_VALID,
      headlines: Array.from({ length: 6 }, (_, i) => `H${i}`),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Maximum 5 headlines/.test(e))).toBe(true);
  });

  it("rejects zero headlines", () => {
    const result = validateDemandGenAd({ ...BASE_VALID, headlines: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /At least one headline/i.test(e))).toBe(true);
  });
});

describe("validateDemandGenAd — descriptions", () => {
  it("rejects description > 90 chars", () => {
    const result = validateDemandGenAd({
      ...BASE_VALID,
      descriptions: ["x".repeat(91), "Description 2"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Description 1 too long/.test(e))).toBe(true);
  });

  it("rejects more than 5 descriptions", () => {
    const result = validateDemandGenAd({
      ...BASE_VALID,
      descriptions: Array.from({ length: 6 }, (_, i) => `D${i}`),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Maximum 5 descriptions/.test(e))).toBe(true);
  });
});

describe("validateDemandGenAd — long_headlines", () => {
  it("rejects long_headline > 90 chars", () => {
    const result = validateDemandGenAd({
      ...BASE_VALID,
      long_headlines: ["x".repeat(91)],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Long headline 1 too long/.test(e))).toBe(true);
  });

  it("rejects more than 5 long_headlines", () => {
    const result = validateDemandGenAd({
      ...BASE_VALID,
      long_headlines: Array.from({ length: 6 }, (_, i) => `L${i}`),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Maximum 5 long_headlines/.test(e))).toBe(true);
  });
});

describe("validateDemandGenAd — required fields", () => {
  it("rejects missing final_urls", () => {
    const result = validateDemandGenAd({ ...BASE_VALID, final_urls: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /final URL/i.test(e))).toBe(true);
  });

  it("rejects missing marketing_image_asset_ids", () => {
    const result = validateDemandGenAd({ ...BASE_VALID, marketing_image_asset_ids: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /marketing_image_asset_id/i.test(e))).toBe(true);
  });

  it("rejects missing business_name", () => {
    const result = validateDemandGenAd({ ...BASE_VALID, business_name: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /business_name/i.test(e))).toBe(true);
  });

  it("rejects missing call_to_action", () => {
    const result = validateDemandGenAd({ ...BASE_VALID, call_to_action: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /call_to_action/i.test(e))).toBe(true);
  });
});

describe("buildDemandGenAdPayload", () => {
  it("maps asset IDs to resource names prefixed customers/{cid}/assets/", () => {
    const payload = buildDemandGenAdPayload({
      customer_id_clean: "1234567890",
      ad_group_id: "777",
      input: BASE_VALID,
    });

    expect(payload.ad_group).toBe("customers/1234567890/adGroups/777");
    const dgAd = payload.ad.demand_gen_multi_asset_ad;
    expect(dgAd.business_name).toBe("Example Org");
    expect(dgAd.call_to_action_text).toBe("LEARN_MORE");
    expect(dgAd.marketing_images).toEqual([
      { asset: "customers/1234567890/assets/123" },
    ]);
    expect(dgAd.headlines).toEqual([
      { text: "Headline 1" },
      { text: "Headline 2" },
    ]);
    expect(dgAd.descriptions).toEqual([
      { text: "Description 1" },
      { text: "Description 2" },
    ]);
    expect(payload.ad.final_urls).toEqual(["https://example.com/"]);
  });

  it("includes square, portrait, and logo images when provided", () => {
    const payload = buildDemandGenAdPayload({
      customer_id_clean: "11",
      ad_group_id: "22",
      input: {
        ...BASE_VALID,
        square_marketing_image_asset_ids: ["9001"],
        portrait_marketing_image_asset_ids: ["9002"],
        logo_image_asset_ids: ["9003"],
      },
    });
    const dgAd = payload.ad.demand_gen_multi_asset_ad;
    expect(dgAd.square_marketing_images).toEqual([{ asset: "customers/11/assets/9001" }]);
    expect(dgAd.portrait_marketing_images).toEqual([{ asset: "customers/11/assets/9002" }]);
    expect(dgAd.logo_images).toEqual([{ asset: "customers/11/assets/9003" }]);
  });

  it("omits optional image arrays when not provided", () => {
    const payload = buildDemandGenAdPayload({
      customer_id_clean: "11",
      ad_group_id: "22",
      input: BASE_VALID,
    });
    const dgAd = payload.ad.demand_gen_multi_asset_ad;
    expect(dgAd.square_marketing_images).toBeUndefined();
    expect(dgAd.portrait_marketing_images).toBeUndefined();
    expect(dgAd.logo_images).toBeUndefined();
  });
});
