import { describe, it, expect } from "vitest";
import {
  buildRemovePreview,
  validateRemoveInput,
  orderRemovalsChildUp,
  coerceStringArray,
  normalizeRemoveArgs,
  type RemoveArgs,
} from "./removeHelpers.js";

describe("validateRemoveInput", () => {
  it("rejects when no IDs provided", () => {
    const result = validateRemoveInput({ customer_id: "7458517309" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/No item IDs/);
  });

  it("rejects when all ID arrays are empty", () => {
    const result = validateRemoveInput({
      customer_id: "7458517309",
      campaign_ids: [],
      ad_group_ids: [],
      ad_ids: [],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts when any one ID array has content", () => {
    const result = validateRemoveInput({
      customer_id: "7458517309",
      campaign_ids: ["123"],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts when only ad_ids is provided", () => {
    const result = validateRemoveInput({
      customer_id: "7458517309",
      ad_ids: ["456"],
    });
    expect(result.ok).toBe(true);
  });
});

describe("buildRemovePreview", () => {
  it("returns dry_run: true with provided IDs", () => {
    const args: RemoveArgs = {
      customer_id: "7458517309",
      campaign_ids: ["111"],
      ad_group_ids: ["222"],
      ad_ids: ["333"],
      labels: ["mcp-cleanup"],
    };
    const preview = buildRemovePreview(args);
    expect(preview.dry_run).toBe(true);
    expect(preview.would_remove.campaigns).toEqual(["111"]);
    expect(preview.would_remove.ad_groups).toEqual(["222"]);
    expect(preview.would_remove.ads).toEqual(["333"]);
    expect(preview.labels_to_apply).toContain("mcp-cleanup");
  });

  it("shows removal_order as child-up (ads → ad_groups → campaigns)", () => {
    const preview = buildRemovePreview({
      customer_id: "7458517309",
      campaign_ids: ["111"],
    });
    expect(preview.removal_order).toMatch(/ads.*ad_groups.*campaigns/);
  });

  it("defaults empty arrays when IDs omitted", () => {
    const preview = buildRemovePreview({
      customer_id: "7458517309",
      campaign_ids: ["111"],
    });
    expect(preview.would_remove.ad_groups).toEqual([]);
    expect(preview.would_remove.ads).toEqual([]);
  });

  it("mentions confirm:true in the message", () => {
    const preview = buildRemovePreview({
      customer_id: "7458517309",
      ad_ids: ["1"],
    });
    expect(preview.message).toMatch(/confirm.*true/);
  });
});

describe("coerceStringArray", () => {
  it("returns undefined for null/undefined", () => {
    expect(coerceStringArray(undefined)).toBeUndefined();
    expect(coerceStringArray(null)).toBeUndefined();
  });

  it("returns array as-is when already an array", () => {
    expect(coerceStringArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("parses JSON-stringified array", () => {
    expect(coerceStringArray('["a", "b", "c"]')).toEqual(["a", "b", "c"]);
  });

  it("wraps a bare single string as a one-element array", () => {
    expect(coerceStringArray("abc")).toEqual(["abc"]);
  });

  it("coerces numeric array elements to strings", () => {
    expect(coerceStringArray([1, 2])).toEqual(["1", "2"]);
  });

  it("handles malformed JSON string by wrapping", () => {
    expect(coerceStringArray("[not valid")).toEqual(["[not valid"]);
  });
});

describe("normalizeRemoveArgs", () => {
  it("coerces stringified array IDs into real arrays", () => {
    const result = normalizeRemoveArgs({
      customer_id: "7458517309",
      campaign_ids: '["850837339", "967142783"]',
      labels: '["mcp-cleanup"]',
    });
    expect(result.campaign_ids).toEqual(["850837339", "967142783"]);
    expect(result.labels).toEqual(["mcp-cleanup"]);
  });

  it("passes through real arrays unchanged", () => {
    const result = normalizeRemoveArgs({
      customer_id: "x",
      ad_ids: ["1", "2"],
    });
    expect(result.ad_ids).toEqual(["1", "2"]);
  });

  it("accepts confirm as boolean true or string 'true' (harness coercion)", () => {
    expect(normalizeRemoveArgs({ confirm: true }).confirm).toBe(true);
    expect(normalizeRemoveArgs({ confirm: "true" as any }).confirm).toBe(true);
  });

  it("rejects other truthy values as confirm", () => {
    expect(normalizeRemoveArgs({ confirm: 1 as any }).confirm).toBe(false);
    expect(normalizeRemoveArgs({ confirm: "yes" as any }).confirm).toBe(false);
    expect(normalizeRemoveArgs({ confirm: false }).confirm).toBe(false);
    expect(normalizeRemoveArgs({}).confirm).toBe(false);
  });
});

describe("orderRemovalsChildUp", () => {
  it("returns ads first, then ad_groups, then campaigns", () => {
    const order = orderRemovalsChildUp({
      customer_id: "x",
      campaign_ids: ["c1"],
      ad_group_ids: ["ag1"],
      ad_ids: ["a1"],
    });
    expect(order.map(step => step.type)).toEqual(["ads", "ad_groups", "campaigns"]);
  });

  it("skips empty categories", () => {
    const order = orderRemovalsChildUp({
      customer_id: "x",
      campaign_ids: ["c1"],
    });
    expect(order.map(step => step.type)).toEqual(["campaigns"]);
  });

  it("returns IDs alongside type", () => {
    const order = orderRemovalsChildUp({
      customer_id: "x",
      ad_ids: ["a1", "a2"],
    });
    expect(order[0]).toEqual({ type: "ads", ids: ["a1", "a2"] });
  });

  it("returns empty array when no IDs", () => {
    const order = orderRemovalsChildUp({ customer_id: "x" });
    expect(order).toEqual([]);
  });
});
