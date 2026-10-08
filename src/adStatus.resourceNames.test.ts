/**
 * enableAds / pauseAds target ad_group_ad LINKS, but an Ad can be linked into
 * several ad groups -- including ones in REMOVED campaigns (old [TRIAL]
 * experiment campaigns). Two failures seen live 2026-10-07:
 *   - enable_items rejected full ad_group_ad resource names (it SQL-inlined
 *     them as ad IDs -> GAQL "invalid number"), unlike pause_items.
 *   - enabling bare ad IDs resolved every link, including the REMOVED-campaign
 *     one, so the whole atomic batch failed with
 *     OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CID = "1234567890";
const LIVE_AG = "100";
const TRIAL_AG = "200";
const SHARED_AD = "111"; // linked in LIVE_AG and in a REMOVED campaign's TRIAL_AG
const SOLO_AD = "222";   // linked only in LIVE_AG

function makeFakeCustomer() {
  const statusUpdates: any[] = [];
  const queries: string[] = [];
  const links = [
    { ag: LIVE_AG, ad: SHARED_AD, campaignStatus: 2 },
    { ag: TRIAL_AG, ad: SHARED_AD, campaignStatus: 4 }, // REMOVED campaign
    { ag: LIVE_AG, ad: SOLO_AD, campaignStatus: 2 },
  ];
  const customer = {
    async query(gaql: string) {
      queries.push(gaql);
      if (/FROM\s+ad_group_ad\b/i.test(gaql)) {
        const idMatch = gaql.match(/ad_group_ad\.ad\.id\s+IN\s+\(([^)]+)\)/i);
        const ids = new Set((idMatch?.[1] ?? "").split(",").map(s => s.trim()));
        const excludeRemoved = /campaign\.status\s*!=\s*'REMOVED'/i.test(gaql);
        return links
          .filter(l => ids.has(l.ad))
          .filter(l => !excludeRemoved || l.campaignStatus !== 4)
          .map(l => ({
            ad_group: { id: Number(l.ag) },
            ad_group_ad: { ad: { id: Number(l.ad) } },
            campaign: { status: l.campaignStatus },
          }));
      }
      if (/FROM\s+label\b/i.test(gaql)) {
        return [{ label: { resource_name: `customers/${CID}/labels/1`, name: "x" } }];
      }
      return [];
    },
    adGroupAds: {
      async update(ops: any[]) {
        statusUpdates.push(...ops);
        return { results: ops.map(o => ({ resource_name: o.resource_name })) };
      },
    },
    adGroupAdLabels: {
      async create(ops: any[]) {
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
  };
  return { customer, statusUpdates, queries };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

const rn = (ag: string, ad: string) => `customers/${CID}/adGroupAds/${ag}~${ad}`;

describe("enableAds / pauseAds -- link targeting", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("enableAds accepts full ad_group_ad resource names and uses them as-is", async () => {
    await mgr.enableAds(CID, [rn(LIVE_AG, SHARED_AD)]);

    expect(fake.statusUpdates.map(u => u.resource_name)).toEqual([rn(LIVE_AG, SHARED_AD)]);
    expect(fake.queries.filter(q => /FROM\s+ad_group_ad\b/i.test(q))).toEqual([]);
  });

  it("enableAds on bare IDs skips links in REMOVED campaigns", async () => {
    await mgr.enableAds(CID, [SHARED_AD, SOLO_AD]);

    expect(fake.statusUpdates.map(u => u.resource_name).sort()).toEqual(
      [rn(LIVE_AG, SHARED_AD), rn(LIVE_AG, SOLO_AD)].sort()
    );
  });

  it("pauseAds on bare IDs skips links in REMOVED campaigns", async () => {
    await mgr.pauseAds(CID, [SHARED_AD]);

    expect(fake.statusUpdates.map(u => u.resource_name)).toEqual([rn(LIVE_AG, SHARED_AD)]);
  });
});
