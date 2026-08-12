/**
 * Regression test for the 2026-08-12 Neon One clone-and-swap failure.
 *
 * BUG: `updateAdFinalUrls`'s clone-and-swap calls `createResponsiveSearchAd`
 * to build the replacement ad, which runs `validateRsa` with its default
 * "path1/path2 always required" hygiene rule (added for callers who are
 * AUTHORING a new ad via google_ads_create_responsive_search_ad). That rule
 * has no business gating a CLONE of a pre-existing ad's exact content --
 * plenty of live RSAs never had path1/path2 set, or have path1 without
 * path2 (the real Google Ads constraint is path2-requires-path1, not both
 * required). Confirmed live: 6 of 7 Neon One RSA clones failed with
 * "path1/path2 is required (display URL path segment)" even though the
 * SOURCE ads were serving fine without them.
 *
 * This is a WIRING bug, not a validateRsa bug: validateRsa's default
 * behavior is intentional and correct for direct ad authoring; the defect
 * is that updateAdFinalUrls never told it "this is a clone, don't require
 * paths that weren't there to begin with." A pure unit test of validateRsa
 * in isolation can't catch that the real method fails to pass the flag --
 * so this test drives the REAL `updateAdFinalUrls` method against a fake
 * customer whose source ads have no path1/path2 (and path1-without-path2),
 * and asserts the clone succeeds instead of throwing.
 *
 * Same bypass-the-constructor pattern as replaceSitelinkUrl.wiring.test.ts /
 * createResponsiveSearchAd.labels.test.ts.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CID = "1234567890";
const AD_GROUP_ID = "999";
const AD_GROUP_RN = `customers/${CID}/adGroups/${AD_GROUP_ID}`;

// Ad A: never had path1/path2 set at all (the common case).
const AD_A_ID = "111";
const AD_A_RN = `customers/${CID}/adGroupAds/${AD_GROUP_ID}~${AD_A_ID}`;
// Ad B: has path1 but no path2 (a real, valid, live account state).
const AD_B_ID = "222";
const AD_B_RN = `customers/${CID}/adGroupAds/${AD_GROUP_ID}~${AD_B_ID}`;

const NEW_URL = "https://neonone.com/l/neon-one-nonprofit-crm/";

function makeFakeCustomer() {
  const createdAds: any[] = [];
  const statusUpdates: Array<{ resource_name: string; status: number }> = [];

  const customer = {
    async query(gaql: string) {
      if (/FROM\s+ad_group_ad\b/i.test(gaql) && /responsive_search_ad/i.test(gaql)) {
        const idMatch = gaql.match(/ad_group_ad\.ad\.id\s+IN\s+\(([^)]+)\)/i);
        const requestedIds = new Set((idMatch?.[1] ?? "").split(",").map(s => s.trim()));
        const rows = [
          {
            ad_group_ad: {
              resource_name: AD_A_RN,
              ad: {
                id: Number(AD_A_ID),
                type: 15, // RESPONSIVE_SEARCH_AD
                final_urls: ["https://neonone.com/l/neon-one-pricing-guide/"],
                responsive_search_ad: {
                  headlines: [{ text: "Headline one" }, { text: "Headline two" }, { text: "Headline three" }],
                  descriptions: [{ text: "Description one" }, { text: "Description two" }],
                  // no path1/path2 at all
                },
              },
              status: 3, // PAUSED
            },
            ad_group: { id: Number(AD_GROUP_ID), name: "Test Ad Group" },
            campaign: { name: "test_campaign" },
          },
          {
            ad_group_ad: {
              resource_name: AD_B_RN,
              ad: {
                id: Number(AD_B_ID),
                type: 15,
                final_urls: ["https://neonone.com/l/neon-one-pricing-guide/"],
                responsive_search_ad: {
                  headlines: [{ text: "Headline one" }, { text: "Headline two" }, { text: "Headline three" }],
                  descriptions: [{ text: "Description one" }, { text: "Description two" }],
                  path1: "pricing-guide", // path1 set, path2 absent -- valid live state
                },
              },
              status: 2, // ENABLED
            },
            ad_group: { id: Number(AD_GROUP_ID), name: "Test Ad Group" },
            campaign: { name: "test_campaign" },
          },
        ];
        return rows.filter(r => requestedIds.has(String(r.ad_group_ad.ad.id)));
      }
      if (/FROM\s+ad_group_ad_label\b/i.test(gaql)) {
        return []; // no pre-existing custom labels to reapply
      }
      if (/FROM\s+label\b/i.test(gaql)) {
        // Short-circuit ensureLabelExists so autoLabelCreated doesn't try to create one.
        return [{ label: { resource_name: `customers/${CID}/labels/1`, name: "x" } }];
      }
      return [];
    },
    adGroupAds: {
      async create(ops: any[]) {
        createdAds.push(...ops);
        return { results: ops.map((_, i) => ({ resource_name: `customers/${CID}/adGroupAds/${AD_GROUP_ID}~${900 + createdAds.length + i}` })) };
      },
      async update(ops: Array<{ resource_name: string; status: number }>) {
        statusUpdates.push(...ops);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
    adGroupAdLabels: {
      async create(ops: any[]) {
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
  };

  return { customer, createdAds, statusUpdates };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("updateAdFinalUrls -- clone-and-swap must not require path1/path2", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("clones an ad with neither path1 nor path2 set, without throwing", async () => {
    const result: any = await mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_A_ID], NEW_URL, true);

    expect(result.ads_failed).toBe(0);
    expect(result.ads_swapped).toBe(1);
    expect(result.swaps[0].error).toBeUndefined();
    expect(result.swaps[0].new_ad_id).not.toBeNull();

    // The clone must carry the empty path1/path2 through unchanged -- not
    // fabricate one just to satisfy the create-tool's hygiene rule.
    const created = fake.createdAds[0];
    expect(created.ad.responsive_search_ad.path1).toBe("");
    expect(created.ad.responsive_search_ad.path2).toBe("");
    expect(created.ad.final_urls).toEqual([NEW_URL]);
  });

  it("clones an ad with path1 set and path2 absent, without throwing", async () => {
    const result: any = await mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_B_ID], NEW_URL, true);

    expect(result.ads_failed).toBe(0);
    expect(result.ads_swapped).toBe(1);
    expect(result.swaps[0].error).toBeUndefined();

    const created = fake.createdAds[0];
    expect(created.ad.responsive_search_ad.path1).toBe("pricing-guide");
    expect(created.ad.responsive_search_ad.path2).toBe("");
  });

  it("still matches original enabled/paused status on the new ad (unrelated behavior, unaffected)", async () => {
    await mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_A_ID, AD_B_ID], NEW_URL, true);

    // Ad A was PAUSED (status 3) -- new clone should NOT be enabled.
    // Ad B was ENABLED (status 2) -- new clone SHOULD be enabled (status 2).
    const enabledUpdates = fake.statusUpdates.filter(u => u.status === 2);
    expect(enabledUpdates.length).toBe(1);
  });
});
