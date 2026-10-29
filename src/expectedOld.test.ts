/**
 * `expected_old` on update tools: the caller states the value it believes it
 * is overwriting; if the live value differs, the tool refuses, reports
 * current vs expected, and makes no write. Optional for now (Mark,
 * 2026-10-23: optional now, required once callers send it).
 *
 * The manager tests drive the REAL GoogleAdsManager methods against a fake
 * customer whose query() returns canned live state and whose every mutate
 * entry point records into `writes`, so "no write was made" is checked
 * directly rather than inferred.
 */

import { describe, expect, it } from "vitest";

import { GoogleAdsManager } from "./index.js";
import {
  ExpectedOldMismatch,
  assertExpectedOld,
  findExpectedOldMismatches,
} from "./writeGuards.js";

const CID = "1234567890";

// ---------------------------------------------------------------------------
// Pure comparison helpers
// ---------------------------------------------------------------------------

describe("findExpectedOldMismatches", () => {
  it("skips fields whose expected value is undefined", () => {
    expect(
      findExpectedOldMismatches([{ field: "name", expected: undefined, current: "x", kind: "exact" }])
    ).toEqual([]);
  });

  it("exact: treats null/undefined/'' as the same empty value", () => {
    expect(
      findExpectedOldMismatches([{ field: "s", expected: "", current: null, kind: "exact" }])
    ).toEqual([]);
    expect(
      findExpectedOldMismatches([{ field: "s", expected: "a", current: "b", kind: "exact" }])
    ).toHaveLength(1);
  });

  it("money: compares at cent precision", () => {
    expect(
      findExpectedOldMismatches([{ field: "b", expected: 100, current: 100.004, kind: "money" }])
    ).toEqual([]);
    expect(
      findExpectedOldMismatches([{ field: "b", expected: 100, current: 100.01, kind: "money" }])
    ).toHaveLength(1);
  });

  it("number: null expected matches a missing current value only", () => {
    expect(
      findExpectedOldMismatches([{ field: "t", expected: null, current: undefined, kind: "number" }])
    ).toEqual([]);
    expect(
      findExpectedOldMismatches([{ field: "t", expected: null, current: 3, kind: "number" }])
    ).toHaveLength(1);
    expect(
      findExpectedOldMismatches([{ field: "t", expected: 3, current: 3.0000001, kind: "number" }])
    ).toEqual([]);
  });

  it("set: order-insensitive, duplicate-insensitive", () => {
    expect(
      findExpectedOldMismatches([{ field: "ids", expected: ["2", "1"], current: ["1", "2", "2"], kind: "set" }])
    ).toEqual([]);
    expect(
      findExpectedOldMismatches([{ field: "ids", expected: ["1"], current: ["1", "2"], kind: "set" }])
    ).toHaveLength(1);
  });
});

describe("assertExpectedOld", () => {
  it("throws ExpectedOldMismatch carrying current and expected, naming the entity", () => {
    let err: any;
    try {
      assertExpectedOld("google_ads_rename_campaign", 'campaign "Brand" (id 1)', [
        { field: "name", expected: "Old", current: "Brand", kind: "exact" },
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExpectedOldMismatch);
    expect(err.current).toEqual({ name: "Brand" });
    expect(err.expected).toEqual({ name: "Old" });
    expect(err.message).toContain('campaign "Brand" (id 1)');
    expect(err.message).toContain("No write was made");
  });

  it("does nothing when every given field matches", () => {
    expect(() =>
      assertExpectedOld("t", "e", [{ field: "name", expected: "A", current: "A", kind: "exact" }])
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Manager wiring
// ---------------------------------------------------------------------------

type Router = (gaql: string) => any[];

function makeFake(router: Router) {
  const writes: Array<{ via: string; ops: any }> = [];
  const rec = (via: string) => async (ops: any) => {
    writes.push({ via, ops });
    const list = Array.isArray(ops) ? ops : [ops];
    return {
      results: list.map((o: any, i: number) => ({
        resource_name: o?.resource_name ?? `customers/${CID}/assets/${900 + i}`,
      })),
      mutate_operation_responses: [
        { ad_group_ad_result: { resource_name: `customers/${CID}/adGroupAds/1~2` } },
      ],
    };
  };
  const customer: any = {
    query: async (gaql: string) => router(gaql),
    campaigns: { update: rec("campaigns.update") },
    campaignBudgets: { update: rec("campaignBudgets.update") },
    adGroups: { update: rec("adGroups.update") },
    assets: { update: rec("assets.update"), create: rec("assets.create") },
    ads: { update: rec("ads.update") },
    adGroupAds: { update: rec("adGroupAds.update") },
    campaignAssets: { create: rec("campaignAssets.create"), remove: rec("campaignAssets.remove") },
    adGroupAssets: { create: rec("adGroupAssets.create"), remove: rec("adGroupAssets.remove") },
    customerAssets: { create: rec("customerAssets.create"), remove: rec("customerAssets.remove") },
    mutateResources: rec("mutateResources"),
  };
  return { customer, writes };
}

function makeManager(customer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => customer;
  (mgr as any).autoLabelCreated = async () => {};
  (mgr as any).applyCustomLabels = async () => {};
  return mgr;
}

async function expectMismatch(p: Promise<unknown>, writes: any[]) {
  let err: any;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "expected the call to refuse with ExpectedOldMismatch").toBeInstanceOf(ExpectedOldMismatch);
  expect(writes, "a mismatch must make no write").toHaveLength(0);
  return err as ExpectedOldMismatch;
}

describe("updateCampaignBudget expected_old", () => {
  const router: Router = () => [
    {
      campaign: { id: "111", name: "Brand Search" },
      campaign_budget: { id: "777", amount_micros: 100_000_000, name: "B" },
    },
  ];

  it("refuses when the live budget differs and reports current vs expected", async () => {
    const { customer, writes } = makeFake(router);
    const err = await expectMismatch(
      makeManager(customer).updateCampaignBudget(CID, "111", 105, false, { expected_old: 90 }),
      writes
    );
    expect(err.current).toEqual({ daily_budget: 100 });
    expect(err.expected).toEqual({ daily_budget: 90 });
  });

  it("writes when expected_old matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateCampaignBudget(CID, "111", 105, false, { expected_old: 100 });
    expect(writes).toHaveLength(1);
  });
});

describe("updateCampaignBidding expected_old", () => {
  const router: Router = () => [
    {
      campaign: {
        id: "111",
        name: "Brand Search",
        bidding_strategy_type: 6, // TARGET_CPA
        target_cpa: { target_cpa_micros: 50_000_000 },
      },
    },
  ];

  it("refuses when the live target CPA differs", async () => {
    const { customer, writes } = makeFake(router);
    const err = await expectMismatch(
      makeManager(customer).updateCampaignBidding(CID, "111", {
        target_cpa_dollars: 52,
        expected_old: { target_cpa_dollars: 40 },
      }),
      writes
    );
    expect(err.current).toEqual({ target_cpa_dollars: 50 });
  });

  it("refuses when the live strategy differs", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateCampaignBidding(CID, "111", {
        target_cpa_dollars: 52,
        expected_old: { strategy: "MAXIMIZE_CONVERSIONS" },
      }),
      writes
    );
  });

  it("writes when strategy and target match", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateCampaignBidding(CID, "111", {
      target_cpa_dollars: 52,
      expected_old: { strategy: "TARGET_CPA", target_cpa_dollars: 50 },
    });
    expect(writes).toHaveLength(1);
  });
});

describe("updateCampaignTracking expected_old", () => {
  const router: Router = () => [
    {
      campaign: {
        id: "111",
        name: "Brand Search",
        final_url_suffix: "utm_source=google",
        tracking_url_template: "",
      },
    },
  ];

  it("refuses when the live suffix differs", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateCampaignTracking(
        CID,
        "111",
        { final_url_suffix: "utm_source=g2" },
        { expected_old: { final_url_suffix: "utm_source=bing" } }
      ),
      writes
    );
  });

  it("writes when the live suffix matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateCampaignTracking(
      CID,
      "111",
      { final_url_suffix: "utm_source=g2" },
      { expected_old: { final_url_suffix: "utm_source=google", tracking_url_template: "" } }
    );
    expect(writes).toHaveLength(1);
  });
});

describe("renameCampaign / renameAdGroup expected_old", () => {
  const router: Router = (q) =>
    q.includes("FROM ad_group")
      ? [{ ad_group: { id: "222", name: "Core Terms" } }]
      : [{ campaign: { id: "111", name: "Brand Search" } }];

  it("renameCampaign refuses when the live name differs", async () => {
    const { customer, writes } = makeFake(router);
    const err = await expectMismatch(
      makeManager(customer).renameCampaign(CID, "111", "Brand Search US", { expected_old: "Brand" }),
      writes
    );
    expect(err.current).toEqual({ name: "Brand Search" });
  });

  it("renameCampaign writes when the live name matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).renameCampaign(CID, "111", "Brand Search US", {
      expected_old: "Brand Search",
    });
    expect(writes).toHaveLength(1);
  });

  it("renameAdGroup refuses when the live name differs", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).renameAdGroup(CID, "222", "Core", { expected_old: "Other" }),
      writes
    );
  });

  it("renameAdGroup writes when the live name matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).renameAdGroup(CID, "222", "Core", { expected_old: "Core Terms" });
    expect(writes).toHaveLength(1);
  });
});

describe("updateCampaignAdRotation expected_old", () => {
  const router: Router = () => [
    { campaign: { id: "111", name: "Brand Search", ad_serving_optimization_status: 2 } },
  ];

  it("refuses when the live mode differs", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateCampaignAdRotation(CID, "111", "ROTATE", { expected_old: "ROTATE_INDEFINITELY" }),
      writes
    );
  });

  it("writes when the live mode matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateCampaignAdRotation(CID, "111", "ROTATE", { expected_old: "OPTIMIZE" });
    expect(writes).toHaveLength(1);
  });
});

describe("updateCampaignSelectiveOptimization expected_old", () => {
  const router: Router = () => [
    {
      campaign: {
        id: "111",
        name: "Brand Search",
        selective_optimization: {
          conversion_actions: [`customers/${CID}/conversionActions/10`, `customers/${CID}/conversionActions/20`],
        },
      },
    },
  ];

  it("refuses when the live conversion-action set differs", async () => {
    const { customer, writes } = makeFake(router);
    const err = await expectMismatch(
      makeManager(customer).updateCampaignSelectiveOptimization(CID, "111", ["30"], { expected_old: ["10"] }),
      writes
    );
    expect(err.current).toEqual({ conversion_action_ids: ["10", "20"] });
  });

  it("writes when the set matches, in any order", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateCampaignSelectiveOptimization(CID, "111", ["30"], {
      expected_old: ["20", "10"],
    });
    expect(writes).toHaveLength(1);
  });
});

describe("updateCampaignGeoTargetType expected_old", () => {
  const router: Router = () => [
    { campaign: { id: "111", name: "Brand Search", geo_target_type_setting: { positive_geo_target_type: 5 } } },
    { campaign: { id: "112", name: "Brand Search CA", geo_target_type_setting: { positive_geo_target_type: 7 } } },
  ];

  it("refuses when any campaign's live mode differs, naming it", async () => {
    const { customer, writes } = makeFake(router);
    const err = await expectMismatch(
      makeManager(customer).updateCampaignGeoTargetType(CID, ["111", "112"], "PRESENCE", undefined, {
        expected_old: "PRESENCE_OR_INTEREST",
      }),
      writes
    );
    expect(err.message).toContain("Brand Search CA");
  });

  it("writes when every campaign matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateCampaignGeoTargetType(CID, ["111"], "PRESENCE", undefined, {
      expected_old: "PRESENCE_OR_INTEREST",
    });
    expect(writes).toHaveLength(1);
  });
});

describe("updateAssetUrls expected_old", () => {
  const router: Router = () => [
    { asset: { id: "501", name: "SL", final_urls: ["https://a.example/old"], sitelink_asset: { link_text: "Pricing" } } },
  ];

  it("refuses when an asset's live URLs differ", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateAssetUrls(CID, [
        { asset_id: "501", final_urls: ["https://a.example/new"], expected_old: ["https://a.example/other"] },
      ]),
      writes
    );
  });

  it("writes when the live URLs match", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateAssetUrls(CID, [
      { asset_id: "501", final_urls: ["https://a.example/new"], expected_old: ["https://a.example/old"] },
    ]);
    expect(writes).toHaveLength(1);
  });
});

describe("replaceSitelinkUrl expected_old", () => {
  const router: Router = (q) =>
    q.includes("FROM asset")
      ? [
          {
            asset: {
              id: "501",
              type: 13,
              final_urls: ["https://a.example/old"],
              sitelink_asset: { link_text: "Pricing", description1: "d1", description2: "d2" },
            },
          },
        ]
      : [];

  it("refuses before creating anything when the old asset's URLs differ", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).replaceSitelinkUrl(CID, {
        old_asset_id: "501",
        new_final_urls: ["https://a.example/new"],
        expected_old: ["https://a.example/other"],
      }),
      writes
    );
  });
});

describe("updateCampaignAdUrls expected_old", () => {
  const router: Router = () => [
    { ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/1~11`, ad: { id: "11", final_urls: ["https://a.example/old"] } }, ad_group: { name: "AG" } },
    { ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/1~12`, ad: { id: "12", final_urls: ["https://a.example/drift"] } }, ad_group: { name: "AG" } },
  ];

  it("refuses when any ad's live URL differs from expected_old", async () => {
    const { customer, writes } = makeFake(router);
    const err = await expectMismatch(
      makeManager(customer).updateCampaignAdUrls(CID, "111", "https://a.example/new", true, {
        expected_old: "https://a.example/old",
      }),
      writes
    );
    expect(err.message).toContain("12");
  });
});

describe("updateAdFinalUrls expected_old", () => {
  const router: Router = () => [
    {
      ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/7~11`, ad: { id: "11", type: 15, final_urls: ["https://a.example/drift"] }, status: 2 },
      ad_group: { id: "7", name: "AG" },
      campaign: { name: "C" },
    },
  ];

  it("refuses when the ad's live URL differs from expected_old", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateAdFinalUrls(CID, "7", ["11"], "https://a.example/new", true, {
        expected_old: "https://a.example/old",
      }),
      writes
    );
  });

  it("writes when the live URL matches", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateAdFinalUrls(CID, "7", ["11"], "https://a.example/new", true, {
      expected_old: "https://a.example/drift",
    });
    expect(writes).toHaveLength(1);
  });
});

describe("updateResponsiveSearchAdText expected_old", () => {
  const H = Array.from({ length: 3 }, (_, i) => ({ text: `Headline ${i + 1}` }));
  const D = [{ text: "Description one is here." }, { text: "Description two is here." }];
  const router: Router = () => [
    {
      ad_group_ad: {
        resource_name: `customers/${CID}/adGroupAds/7~11`,
        ad: { id: "11", type: 15, final_urls: ["https://a.example/"], responsive_search_ad: { headlines: H, descriptions: D } },
        status: 2,
      },
      ad_group: { id: "7", name: "AG" },
      campaign: { id: "1", name: "C" },
    },
  ];

  it("refuses when the live headlines differ", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateResponsiveSearchAdText(
        CID,
        "11",
        { headlines: ["New 1", "New 2", "New 3"] },
        true,
        { expected_old: { headlines: ["Headline 1", "Headline 2", "Something else"] } }
      ),
      writes
    );
  });

  it("writes when the live headlines match", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateResponsiveSearchAdText(
      CID,
      "11",
      { headlines: ["New 1", "New 2", "New 3"] },
      true,
      { expected_old: { headlines: ["Headline 3", "Headline 2", "Headline 1"] } }
    );
    expect(writes).toHaveLength(1);
  });
});

describe("updateVideoAdVideos expected_old", () => {
  const router: Router = () => [
    {
      ad_group_ad: {
        resource_name: `customers/${CID}/adGroupAds/7~11`,
        ad: { type: "VIDEO_RESPONSIVE_AD", name: "V", video_responsive_ad: { videos: [{ asset: `customers/${CID}/assets/601` }] } },
      },
    },
  ];

  it("refuses when the live video set differs", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateVideoAdVideos(CID, {
        ad_id: "11",
        videos: ["dQw4w9WgXcQ"],
        mode: "replace",
        skip_visibility_check: true,
        expected_old: ["602"],
      }),
      writes
    );
  });
});

describe("updateDemandGenMultiAssetAd expected_old", () => {
  const router: Router = () => [
    {
      ad_group_ad: {
        resource_name: `customers/${CID}/adGroupAds/7~11`,
        ad: {
          demand_gen_multi_asset_ad: {
            headlines: [{ text: "Old headline" }],
            descriptions: [{ text: "Old description" }],
          },
        },
      },
    },
  ];

  it("refuses when the live headlines differ", async () => {
    const { customer, writes } = makeFake(router);
    await expectMismatch(
      makeManager(customer).updateDemandGenMultiAssetAd(CID, {
        ad_resource_name: "11",
        headlines: ["New headline"],
        descriptions: ["New description text"],
        expected_old: { descriptions: ["Something else"] },
      }),
      writes
    );
  });

  it("writes when the live descriptions match", async () => {
    const { customer, writes } = makeFake(router);
    await makeManager(customer).updateDemandGenMultiAssetAd(CID, {
      ad_resource_name: "11",
      headlines: ["New headline"],
      descriptions: ["New description text"],
      expected_old: { descriptions: ["Old description"] },
    });
    expect(writes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Arg normalizers carry expected_old through to the manager
// ---------------------------------------------------------------------------

import { normalizeUpdateAssetUrlsArgs, normalizeReplaceSitelinkArgs } from "./assetHelpers.js";

describe("normalizers forward expected_old", () => {
  it("normalizeUpdateAssetUrlsArgs keeps a per-update expected_old", () => {
    const n: any = normalizeUpdateAssetUrlsArgs({
      updates: [{ asset_id: "501", final_urls: ["https://a.example/new"], expected_old: ["https://a.example/old"] }],
    });
    expect(n.updates[0].expected_old).toEqual(["https://a.example/old"]);
  });

  it("normalizeUpdateAssetUrlsArgs rejects a non-array expected_old", () => {
    const n: any = normalizeUpdateAssetUrlsArgs({
      updates: [{ asset_id: "501", final_urls: ["https://a.example/new"], expected_old: 5 }],
    });
    expect(n.error).toMatch(/expected_old/);
  });

  it("normalizeReplaceSitelinkArgs keeps expected_old", () => {
    const n: any = normalizeReplaceSitelinkArgs({
      old_asset_id: "501",
      new_final_urls: ["https://a.example/new"],
      expected_old: ["https://a.example/old"],
    });
    expect(n.expected_old).toEqual(["https://a.example/old"]);
  });
});
