import { describe, it, expect } from "vitest";
import {
  buildRemovePreview,
  validateRemoveInput,
  orderRemovalsChildUp,
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
