/**
 * google_ads_update_demand_gen_multi_asset_ad edits Demand Gen multi-asset
 * copy IN PLACE through AdService (customer.ads.update on customers/X/ads/Y),
 * the path the Google Ads UI takes: same ad id, status and history kept.
 *
 * AdGroupAdService (mutateResources entity "ad_group_ad" with a nested `ad`)
 * is the wrong service: it answers IMMUTABLE_FIELD for any nested ad field,
 * which is what an earlier "multi-asset copy is immutable, recreate the ad"
 * note measured.
 *
 * The manager is driven against a fake customer that records every mutate
 * entry point with its options. The recorded payload and options are then fed
 * through the real google-ads-api request builder offline, so the update mask
 * and validate_only are checked on the request the library would send.
 */

import { describe, expect, it } from "vitest";
import { GoogleAdsApi, resources } from "google-ads-api";

import { GoogleAdsManager } from "./index.js";
import { normalizeUpdateDemandGenMultiAssetAdArgs } from "./assetHelpers.js";
import { tools } from "./tools.js";

const CID = "1234567890";
const AD_ID = "11";
const DG_MULTI_ASSET = 40;

type Write = { via: string; ops: any; opts: any };

function liveRow(overrides: { adGroupId?: string; type?: number } = {}) {
  const ag = overrides.adGroupId ?? "7";
  return {
    ad_group_ad: {
      resource_name: `customers/${CID}/adGroupAds/${ag}~${AD_ID}`,
      status: 2,
      ad: {
        id: AD_ID,
        type: overrides.type ?? DG_MULTI_ASSET,
        demand_gen_multi_asset_ad: {
          headlines: [{ text: "Old headline one" }, { text: "Old headline two" }],
          descriptions: [{ text: "Old description" }],
        },
      },
    },
    ad_group: { id: ag, name: `Ad group ${ag}` },
    campaign: { name: "Campaign" },
  };
}

function makeFake(rows: any[]) {
  const writes: Write[] = [];
  const queries: string[] = [];
  const rec = (via: string) => async (ops: any, opts?: any) => {
    writes.push({ via, ops, opts });
    const list = Array.isArray(ops) ? ops : [ops];
    return { results: list.map((o: any) => ({ resource_name: o?.resource_name })) };
  };
  const customer: any = {
    query: async (gaql: string) => {
      queries.push(gaql);
      return rows;
    },
    ads: { update: rec("ads.update") },
    adGroupAds: { update: rec("adGroupAds.update") },
    mutateResources: rec("mutateResources"),
  };
  return { customer, writes, queries };
}

function makeManager(customer: any) {
  const labelled: string[][] = [];
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => customer;
  (mgr as any).autoLabelCreated = async (_cid: string, rns: string[]) => {
    labelled.push(rns);
  };
  return { mgr, labelled };
}

/** Build the request google-ads-api would send for a recorded ads.update call. */
function builtRequest(w: Write) {
  const c: any = new GoogleAdsApi({ client_id: "x", client_secret: "y", developer_token: "z" }).Customer({
    customer_id: CID,
    refresh_token: "r",
  });
  const ops = c.buildOperations("update", w.ops, resources.Ad);
  return c.buildRequest(ops, w.opts);
}

describe("updateDemandGenMultiAssetAd goes through AdService in place", () => {
  it("updates the Ad resource with the copy fields at top level, not a nested ad_group_ad.ad", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await mgr.updateDemandGenMultiAssetAd(CID, {
      ad_resource_name: AD_ID,
      headlines: ["New headline one", "New headline two"],
      descriptions: ["New description"],
    });
    expect(writes.map((w) => w.via)).toEqual(["ads.update"]);
    expect(writes[0].ops).toEqual([
      {
        resource_name: `customers/${CID}/ads/${AD_ID}`,
        demand_gen_multi_asset_ad: {
          headlines: [{ text: "New headline one" }, { text: "New headline two" }],
          descriptions: [{ text: "New description" }],
        },
      },
    ]);
  });

  it("the update mask names only the copy fields passed", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await mgr.updateDemandGenMultiAssetAd(CID, {
      ad_resource_name: AD_ID,
      headlines: ["New headline one"],
    });
    const mask = builtRequest(writes[0]).operations[0].update_mask.paths;
    expect(mask.filter((p: string) => p !== "resource_name")).toEqual(["demand_gen_multi_asset_ad.headlines"]);
  });

  it("validates a headlines-only edit against the ad's live descriptions", async () => {
    // The old path validated the passed fields alone, so a headlines-only
    // edit failed with "At least one description is required".
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await mgr.updateDemandGenMultiAssetAd(CID, { ad_resource_name: AD_ID, headlines: ["New headline one"] });
    expect(writes).toHaveLength(1);
  });

  it("accepts a full ad_group_ad resource name and edits that ad's Ad resource", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await mgr.updateDemandGenMultiAssetAd(CID, {
      ad_resource_name: `customers/${CID}/adGroupAds/7~${AD_ID}`,
      descriptions: ["New description"],
    });
    expect(writes[0].ops[0].resource_name).toBe(`customers/${CID}/ads/${AD_ID}`);
  });

  it("labels every ad_group_ad link of the shared Ad and reports them", async () => {
    const { customer } = makeFake([liveRow({ adGroupId: "7" }), liveRow({ adGroupId: "8" })]);
    const { mgr, labelled } = makeManager(customer);
    const result: any = await mgr.updateDemandGenMultiAssetAd(CID, {
      ad_resource_name: AD_ID,
      headlines: ["New headline one"],
    });
    expect(labelled).toEqual([[`customers/${CID}/adGroupAds/7~${AD_ID}`, `customers/${CID}/adGroupAds/8~${AD_ID}`]]);
    expect(result.success).toBe(true);
    expect(result.affected_ad_group_ad_links).toHaveLength(2);
    expect(result.shared_across_multiple_ad_groups).toBe(true);
  });

  it("sends a real update (validate_only false) by default", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await mgr.updateDemandGenMultiAssetAd(CID, { ad_resource_name: AD_ID, headlines: ["New headline one"] });
    expect(builtRequest(writes[0]).validate_only).toBeFalsy();
  });
});

describe("updateDemandGenMultiAssetAd validate_only", () => {
  it("the request the library builds carries validate_only=true, and nothing is labelled", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr, labelled } = makeManager(customer);
    const result: any = await mgr.updateDemandGenMultiAssetAd(CID, {
      ad_resource_name: AD_ID,
      headlines: ["Old headline one", "Old headline two"],
      validate_only: true,
    });
    expect(writes.map((w) => w.via)).toEqual(["ads.update"]);
    expect(builtRequest(writes[0]).validate_only).toBe(true);
    expect(labelled).toEqual([]);
    expect(result.validate_only).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("the MCP args normalizer carries validate_only through to the manager", () => {
    const n = normalizeUpdateDemandGenMultiAssetAdArgs({
      customer_id: CID,
      ad_resource_name: AD_ID,
      headlines: ["h"],
      validate_only: true,
    });
    expect(n.customerId).toBe(CID);
    expect(n.input.validate_only).toBe(true);
    expect(n.input.headlines).toEqual(["h"]);
    expect(normalizeUpdateDemandGenMultiAssetAdArgs({ customer_id: CID, ad_resource_name: AD_ID }).input.validate_only).toBe(false);
  });
});

describe("updateDemandGenMultiAssetAd refusals (no write)", () => {
  it("refuses an ad that is not a Demand Gen multi-asset ad", async () => {
    const { customer, writes } = makeFake([liveRow({ type: 15 })]);
    const { mgr } = makeManager(customer);
    await expect(
      mgr.updateDemandGenMultiAssetAd(CID, { ad_resource_name: AD_ID, headlines: ["New headline one"] })
    ).rejects.toThrow(/not DEMAND_GEN_MULTI_ASSET_AD/);
    expect(writes).toHaveLength(0);
  });

  it("refuses long_headlines: multi-asset ads have no such API field, so it would be dropped silently", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await expect(
      mgr.updateDemandGenMultiAssetAd(CID, { ad_resource_name: AD_ID, long_headlines: ["A long headline"] })
    ).rejects.toThrow(/long_headlines/);
    expect(writes).toHaveLength(0);
  });

  it("refuses a pinned headline: Demand Gen does not pin, so the pin would be dropped silently", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await expect(
      mgr.updateDemandGenMultiAssetAd(CID, {
        ad_resource_name: AD_ID,
        headlines: [{ text: "New headline one", pinned_position: 1 }],
      })
    ).rejects.toThrow(/pin/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses when no copy field is passed", async () => {
    const { customer, writes } = makeFake([liveRow()]);
    const { mgr } = makeManager(customer);
    await expect(mgr.updateDemandGenMultiAssetAd(CID, { ad_resource_name: AD_ID })).rejects.toThrow(
      /headlines and\/or descriptions/
    );
    expect(writes).toHaveLength(0);
  });
});

describe("google_ads_update_demand_gen_multi_asset_ad tool contract", () => {
  const tool = tools.find((t) => t.name === "google_ads_update_demand_gen_multi_asset_ad")!;

  it("no longer tells callers multi-asset copy is immutable or to recreate the ad", () => {
    expect(tool.description).not.toMatch(/IMMUTABLE/);
    expect(tool.description).not.toMatch(/recreate/i);
    expect(tool.description).toMatch(/in place/i);
  });

  it("exposes validate_only", () => {
    expect((tool.inputSchema as any).properties.validate_only?.type).toBe("boolean");
  });
});
