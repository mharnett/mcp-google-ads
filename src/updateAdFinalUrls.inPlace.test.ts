/**
 * updateAdFinalUrls must edit RSA final_urls IN PLACE via AdService
 * (customer.ads.update) -- same ad ID, no clone, no status changes.
 *
 * History: the tool shipped (ea6cfb0, 2026-05-16) as clone-and-swap on the
 * premise that "RSA final_urls is API-immutable". That premise was never
 * backed by a recorded error and is false: verified live 2026-10-07
 * (Forcepoint ad 798991480203) that `ads.update([{resource_name:
 * "customers/X/ads/Y", final_urls: [url]}])` succeeds and keeps the ad ID.
 * IMMUTABLE_FIELD is what you get going through AdGroupAdService with a
 * nested `ad` -- a different service. Clone-and-swap reset ad-level history
 * on every ad it touched (39 DLP ads on 2026-10-07), so this test pins the
 * in-place mechanism and forbids any create / pause on the apply path.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CID = "1234567890";
const AD_GROUP_ID = "999";
const AD_A_ID = "111"; // ENABLED RSA
const AD_B_ID = "222"; // PAUSED RSA
const VIDEO_ID = "333"; // non-RSA
const NEW_URL = "https://example.com/new-page";

function row(adId: string, type: number, status: number) {
  return {
    ad_group_ad: {
      resource_name: `customers/${CID}/adGroupAds/${AD_GROUP_ID}~${adId}`,
      ad: { id: Number(adId), type, final_urls: ["https://example.com/old-page"] },
      status,
    },
    ad_group: { id: Number(AD_GROUP_ID), name: "Test Ad Group" },
    campaign: { name: "test_campaign" },
  };
}

function makeFakeCustomer() {
  const adUpdates: any[] = [];
  const adGroupAdCreates: any[] = [];
  const adGroupAdUpdates: any[] = [];
  const rows = [row(AD_A_ID, 15, 2), row(AD_B_ID, 15, 3), row(VIDEO_ID, 30, 2)];

  const customer = {
    async query(gaql: string) {
      if (/FROM\s+ad_group_ad\b/i.test(gaql)) {
        const idMatch = gaql.match(/ad_group_ad\.ad\.id\s+IN\s+\(([^)]+)\)/i);
        const ids = new Set((idMatch?.[1] ?? "").split(",").map(s => s.trim()));
        return rows.filter(r => ids.has(String(r.ad_group_ad.ad.id)));
      }
      if (/FROM\s+label\b/i.test(gaql)) {
        return [{ label: { resource_name: `customers/${CID}/labels/1`, name: "x" } }];
      }
      return [];
    },
    ads: {
      async update(ops: any[]) {
        adUpdates.push(...ops);
        return { results: ops.map(o => ({ resource_name: o.resource_name })) };
      },
    },
    adGroupAds: {
      async create(ops: any[]) {
        adGroupAdCreates.push(...ops);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
      async update(ops: any[]) {
        adGroupAdUpdates.push(...ops);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
    adGroupAdLabels: {
      async create(ops: any[]) {
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
  };
  return { customer, adUpdates, adGroupAdCreates, adGroupAdUpdates };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("updateAdFinalUrls -- in-place via AdService", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("updates final_urls on the existing Ad resource, keeping the ad ID", async () => {
    const result: any = await mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_A_ID, AD_B_ID], NEW_URL, true);

    expect(fake.adUpdates).toEqual([
      { resource_name: `customers/${CID}/ads/${AD_A_ID}`, final_urls: [NEW_URL] },
      { resource_name: `customers/${CID}/ads/${AD_B_ID}`, final_urls: [NEW_URL] },
    ]);
    expect(result.mechanism).toMatch(/in-place/);
    expect(result.ads_updated).toBe(2);
    expect(result.updated_ad_ids).toEqual([AD_A_ID, AD_B_ID]);
  });

  it("never creates a new ad and never changes any ad's status", async () => {
    await mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_A_ID, AD_B_ID], NEW_URL, true);

    expect(fake.adGroupAdCreates).toEqual([]);
    expect(fake.adGroupAdUpdates.filter(u => "status" in u)).toEqual([]);
  });

  it("dry run reports the in-place mechanism and writes nothing", async () => {
    const result: any = await mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_A_ID], NEW_URL, false);

    expect(result.dry_run).toBe(true);
    expect(result.mechanism).toMatch(/in-place/);
    expect(result.preview[0]).toMatchObject({ ad_id: AD_A_ID, to: [NEW_URL] });
    expect(fake.adUpdates).toEqual([]);
  });

  it("refuses non-RSA ads (video final_urls really are immutable) and writes nothing", async () => {
    await expect(
      mgr.updateAdFinalUrls(CID, AD_GROUP_ID, [AD_A_ID, VIDEO_ID], NEW_URL, true)
    ).rejects.toThrow(/not RESPONSIVE_SEARCH_AD/);
    expect(fake.adUpdates).toEqual([]);
  });
});
