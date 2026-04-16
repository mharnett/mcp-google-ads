import { describe, it, expect } from "vitest";
import {
  parseAssetLinkResourceName,
  validateFinalUrls,
  normalizeUpdateAssetUrlsArgs,
  normalizePauseAssetLinksArgs,
  buildUpdateUrlsDryRun,
  buildPauseLinksDryRun,
} from "./assetHelpers.js";

describe("parseAssetLinkResourceName", () => {
  it("parses a customer_asset resource name", () => {
    const r = parseAssetLinkResourceName("customers/1234567890/customerAssets/310221732713~SITELINK");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.level).toBe("customer_asset");
    expect(r.customer_id).toBe("1234567890");
  });

  it("parses a campaign_asset resource name", () => {
    const r = parseAssetLinkResourceName("customers/1234567890/campaignAssets/22988718227~23328945762~SITELINK");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.level).toBe("campaign_asset");
  });

  it("parses an ad_group_asset resource name", () => {
    const r = parseAssetLinkResourceName("customers/1234567890/adGroupAssets/186197514938~200773811124~SITELINK");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.level).toBe("ad_group_asset");
  });

  it("rejects a bare asset resource name (not a link)", () => {
    const r = parseAssetLinkResourceName("customers/1234567890/assets/310221732713");
    expect("error" in r).toBe(true);
  });

  it("rejects garbage input", () => {
    expect("error" in parseAssetLinkResourceName("foo")).toBe(true);
    expect("error" in parseAssetLinkResourceName("")).toBe(true);
  });
});

describe("validateFinalUrls", () => {
  it("accepts a single https URL", () => {
    const r = validateFinalUrls(["https://example.com/schedule-a-demo"]);
    expect(r.ok).toBe(true);
  });

  it("trims whitespace", () => {
    const r = validateFinalUrls(["  https://example.com/a  "]);
    if (r.ok) expect(r.urls[0]).toBe("https://example.com/a");
  });

  it("rejects non-array input", () => {
    expect(validateFinalUrls("https://x" as any).ok).toBe(false);
  });

  it("rejects empty array", () => {
    expect(validateFinalUrls([]).ok).toBe(false);
  });

  it("rejects URL without scheme", () => {
    expect(validateFinalUrls(["example.com/x"]).ok).toBe(false);
  });

  it("rejects empty-string entry", () => {
    expect(validateFinalUrls([""]).ok).toBe(false);
  });
});

describe("normalizeUpdateAssetUrlsArgs", () => {
  it("normalizes a valid single-update call", () => {
    const r = normalizeUpdateAssetUrlsArgs({
      customer_id: "1234567890",
      updates: [{ asset_id: "23328945732", final_urls: ["https://example.com/fulfillment/"] }],
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].asset_id).toBe("23328945732");
    expect(r.confirm).toBe(false);
  });

  it("accepts confirm: true", () => {
    const r = normalizeUpdateAssetUrlsArgs({
      updates: [{ asset_id: "1", final_urls: ["https://x.com"] }],
      confirm: true,
    });
    if (!("error" in r)) expect(r.confirm).toBe(true);
  });

  it("rejects empty updates array", () => {
    expect("error" in normalizeUpdateAssetUrlsArgs({ updates: [] })).toBe(true);
  });

  it("rejects non-numeric asset_id", () => {
    const r = normalizeUpdateAssetUrlsArgs({
      updates: [{ asset_id: "not-a-number", final_urls: ["https://x.com"] }],
    });
    expect("error" in r).toBe(true);
  });

  it("rejects update with bad URL", () => {
    const r = normalizeUpdateAssetUrlsArgs({
      updates: [{ asset_id: "1", final_urls: ["not-a-url"] }],
    });
    expect("error" in r).toBe(true);
  });

  it("accepts updates passed as a JSON-encoded string (MCP wrapper forwarding)", () => {
    const r = normalizeUpdateAssetUrlsArgs({
      updates: JSON.stringify([{ asset_id: "1", final_urls: ["https://x.com"] }]) as any,
    });
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.updates).toHaveLength(1);
  });

  it("coerces numeric asset_id to string", () => {
    const r = normalizeUpdateAssetUrlsArgs({
      updates: [{ asset_id: 123456 as any, final_urls: ["https://x.com"] }],
    });
    if (!("error" in r)) expect(r.updates[0].asset_id).toBe("123456");
  });
});

describe("normalizePauseAssetLinksArgs", () => {
  it("normalizes valid resource names", () => {
    const r = normalizePauseAssetLinksArgs({
      resource_names: [
        "customers/1234567890/customerAssets/310221732713~SITELINK",
        "customers/1234567890/campaignAssets/22988718227~23328945762~SITELINK",
      ],
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.resource_names).toHaveLength(2);
  });

  it("rejects if any resource name is malformed", () => {
    const r = normalizePauseAssetLinksArgs({
      resource_names: [
        "customers/1234567890/customerAssets/310221732713~SITELINK",
        "bogus",
      ],
    });
    expect("error" in r).toBe(true);
  });

  it("rejects empty array", () => {
    expect("error" in normalizePauseAssetLinksArgs({ resource_names: [] })).toBe(true);
  });

  it("accepts resource_names passed as a JSON-encoded string", () => {
    const r = normalizePauseAssetLinksArgs({
      resource_names: JSON.stringify(["customers/1234567890/customerAssets/310221732713~SITELINK"]) as any,
    });
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.resource_names).toHaveLength(1);
  });
});

describe("buildUpdateUrlsDryRun", () => {
  it("returns dry_run: true with warning", () => {
    const dr = buildUpdateUrlsDryRun({
      customer_id: "1234567890",
      updates: [{ asset_id: "1", final_urls: ["https://x.com"] }],
    });
    expect(dr.dry_run).toBe(true);
    expect(dr.warning).toMatch(/affects EVERY/);
  });
});

describe("buildPauseLinksDryRun", () => {
  it("buckets by level", () => {
    const dr = buildPauseLinksDryRun({
      customer_id: "1234567890",
      resource_names: [
        "customers/1234567890/customerAssets/310221732713~SITELINK",
        "customers/1234567890/campaignAssets/22988718227~23328945762~SITELINK",
        "customers/1234567890/adGroupAssets/186197514938~200773811124~SITELINK",
      ],
    });
    expect(dr.would_pause.customer_asset).toHaveLength(1);
    expect(dr.would_pause.campaign_asset).toHaveLength(1);
    expect(dr.would_pause.ad_group_asset).toHaveLength(1);
  });
});
