/**
 * Regression test for the 2026-08-11 Forcepoint sitelink-QA fix.
 *
 * BUG: `replaceSitelinkUrl` migrated every ENABLED campaign_asset/ad_group_asset
 * link of the old sitelink asset to the new one, without checking whether the
 * link's PARENT campaign/ad group was itself REMOVED. Google Ads rejects any
 * mutate (create AND remove) against a campaign_asset/ad_group_asset whose
 * parent is REMOVED -- OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE -- even
 * when the link's own status is still ENABLED (a real, observed account state:
 * a campaign removed years ago can leave old ENABLED sitelink links behind,
 * permanently frozen). One such link in the batch failed the WHOLE call, not
 * just that link -- confirmed live against Forcepoint assets 280051853776 and
 * 128386238593, both of which errored on the very first attempt.
 *
 * This is a WIRING bug: partitionAssetLinksByParentStatus (assetHelpers.ts) is
 * unit tested in isolation and correct; the defect is that replaceSitelinkUrl
 * needs to call it and route only the ACTIVE bucket into the mutate batches.
 * A pure-function unit test alone can't catch "does the real method use it" --
 * so this test drives the REAL `replaceSitelinkUrl` method with a fake Google
 * Ads customer that REJECTS any create/remove op against a link whose parent
 * is REMOVED (mirroring the real API's actual behavior), and asserts the
 * REMOVED-parent link never reaches those calls while the healthy link does.
 *
 * We bypass the credential-requiring constructor with Object.create() and stub
 * `getCustomer`, following the same pattern as
 * createResponsiveSearchAd.labels.test.ts.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CID = "1234567890";
const OLD_ASSET_ID = "280051853776";
const OLD_ASSET_RN = `customers/${CID}/assets/${OLD_ASSET_ID}`;
const NEW_ASSET_RN = `customers/${CID}/assets/999888777`;

// Campaign that's still alive -- its link should migrate normally.
const LIVE_CAMPAIGN_RN = `customers/${CID}/campaigns/111`;
const LIVE_CAMPAIGN_LINK_RN = `customers/${CID}/campaignAssets/111~${OLD_ASSET_ID}~SITELINK`;
// Campaign that's REMOVED but still has a stale ENABLED link to the old asset.
const DEAD_CAMPAIGN_RN = `customers/${CID}/campaigns/222`;
const DEAD_CAMPAIGN_LINK_RN = `customers/${CID}/campaignAssets/222~${OLD_ASSET_ID}~SITELINK`;

// Same story one level down: a live ad group and a REMOVED one.
const LIVE_AD_GROUP_RN = `customers/${CID}/adGroups/333`;
const LIVE_AD_GROUP_LINK_RN = `customers/${CID}/adGroupAssets/333~${OLD_ASSET_ID}~SITELINK`;
const DEAD_AD_GROUP_RN = `customers/${CID}/adGroups/444`;
const DEAD_AD_GROUP_LINK_RN = `customers/${CID}/adGroupAssets/444~${OLD_ASSET_ID}~SITELINK`;

const CUSTOMER_LINK_RN = `customers/${CID}/customerAssets/${OLD_ASSET_ID}~SITELINK`;

const CampaignStatus = { ENABLED: 2, PAUSED: 3, REMOVED: 4 };
const AdGroupStatus = { ENABLED: 2, PAUSED: 3, REMOVED: 4 };

function apiRejectRemoved(kind: string): never {
  const err: any = new Error(
    `The operation is not allowed for removed resources. (field: operations; ` +
    `code: {"context_error":"OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE"})`
  );
  err.kind = kind;
  throw err;
}

function makeFakeCustomer() {
  const campaignAssetCreateOps: any[] = [];
  const campaignAssetRemoveRns: string[] = [];
  const adGroupAssetCreateOps: any[] = [];
  const adGroupAssetRemoveRns: string[] = [];
  const customerAssetCreateOps: any[] = [];
  const customerAssetRemoveRns: string[] = [];

  const customer = {
    async query(gaql: string) {
      if (/FROM\s+asset\b/i.test(gaql) && /asset\.id\s*=/i.test(gaql)) {
        return [{
          asset: {
            id: Number(OLD_ASSET_ID),
            type: 13, // SITELINK
            final_urls: ["https://www.forcepoint.com/lp/forcepoint-data-risk-assessment"],
            sitelink_asset: {
              link_text: "Free Data Risk Assessment",
              description1: "Get a free risk assessment",
              description2: "Identify insider threats fast",
            },
          },
        }];
      }
      if (/FROM\s+campaign_asset\b/i.test(gaql)) {
        return [
          {
            campaign_asset: { resource_name: LIVE_CAMPAIGN_LINK_RN, campaign: LIVE_CAMPAIGN_RN, field_type: "SITELINK", status: 2 },
            campaign: { status: CampaignStatus.ENABLED },
          },
          {
            campaign_asset: { resource_name: DEAD_CAMPAIGN_LINK_RN, campaign: DEAD_CAMPAIGN_RN, field_type: "SITELINK", status: 2 },
            campaign: { status: CampaignStatus.REMOVED },
          },
        ];
      }
      if (/FROM\s+ad_group_asset\b/i.test(gaql)) {
        return [
          {
            ad_group_asset: { resource_name: LIVE_AD_GROUP_LINK_RN, ad_group: LIVE_AD_GROUP_RN, field_type: "SITELINK", status: 2 },
            ad_group: { status: AdGroupStatus.ENABLED },
          },
          {
            ad_group_asset: { resource_name: DEAD_AD_GROUP_LINK_RN, ad_group: DEAD_AD_GROUP_RN, field_type: "SITELINK", status: 2 },
            ad_group: { status: AdGroupStatus.REMOVED },
          },
        ];
      }
      if (/FROM\s+customer_asset\b/i.test(gaql)) {
        return [
          { customer_asset: { resource_name: CUSTOMER_LINK_RN, field_type: "SITELINK", status: 2 } },
        ];
      }
      if (/FROM\s+label\b/i.test(gaql)) {
        // Short-circuit ensureLabelExists so autoLabelCreated doesn't try to create one.
        return [{ label: { resource_name: `customers/${CID}/labels/1`, name: "x" } }];
      }
      return [];
    },
    assets: {
      async create(_ops: any[]) {
        return { results: [{ resource_name: NEW_ASSET_RN }] };
      },
    },
    campaignAssets: {
      async create(ops: any[]) {
        for (const op of ops) {
          if (op.campaign === DEAD_CAMPAIGN_RN) apiRejectRemoved("campaignAssets.create");
          campaignAssetCreateOps.push(op);
        }
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
      async remove(rns: string[]) {
        for (const rn of rns) {
          if (rn === DEAD_CAMPAIGN_LINK_RN) apiRejectRemoved("campaignAssets.remove");
          campaignAssetRemoveRns.push(rn);
        }
        return { results: rns.map(() => ({ resource_name: "x" })) };
      },
    },
    adGroupAssets: {
      async create(ops: any[]) {
        for (const op of ops) {
          if (op.ad_group === DEAD_AD_GROUP_RN) apiRejectRemoved("adGroupAssets.create");
          adGroupAssetCreateOps.push(op);
        }
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
      async remove(rns: string[]) {
        for (const rn of rns) {
          if (rn === DEAD_AD_GROUP_LINK_RN) apiRejectRemoved("adGroupAssets.remove");
          adGroupAssetRemoveRns.push(rn);
        }
        return { results: rns.map(() => ({ resource_name: "x" })) };
      },
    },
    customerAssets: {
      async create(ops: any[]) {
        customerAssetCreateOps.push(...ops);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
      async remove(rns: string[]) {
        customerAssetRemoveRns.push(...rns);
        return { results: rns.map(() => ({ resource_name: "x" })) };
      },
    },
  };

  return {
    customer,
    campaignAssetCreateOps,
    campaignAssetRemoveRns,
    adGroupAssetCreateOps,
    adGroupAssetRemoveRns,
    customerAssetCreateOps,
    customerAssetRemoveRns,
  };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("replaceSitelinkUrl -- REMOVED-parent link handling", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("migrates the live campaign/ad-group links without ever touching the REMOVED-parent ones", async () => {
    const result = await mgr.replaceSitelinkUrl(CID, {
      old_asset_id: OLD_ASSET_ID,
      new_final_urls: ["https://www.forcepoint.com/forcepoint-data-risk-assessment"],
    });

    // The REMOVED-parent links must never reach a mutate call -- if they did,
    // the fake would have thrown apiRejectRemoved and this test would fail.
    expect(fake.campaignAssetCreateOps.some(o => o.campaign === DEAD_CAMPAIGN_RN)).toBe(false);
    expect(fake.campaignAssetRemoveRns).not.toContain(DEAD_CAMPAIGN_LINK_RN);
    expect(fake.adGroupAssetCreateOps.some(o => o.ad_group === DEAD_AD_GROUP_RN)).toBe(false);
    expect(fake.adGroupAssetRemoveRns).not.toContain(DEAD_AD_GROUP_LINK_RN);

    // The live links DID migrate.
    expect(fake.campaignAssetCreateOps).toHaveLength(1);
    expect(fake.campaignAssetCreateOps[0].campaign).toBe(LIVE_CAMPAIGN_RN);
    expect(fake.campaignAssetCreateOps[0].asset).toBe(NEW_ASSET_RN);
    expect(fake.campaignAssetRemoveRns).toEqual([LIVE_CAMPAIGN_LINK_RN]);

    expect(fake.adGroupAssetCreateOps).toHaveLength(1);
    expect(fake.adGroupAssetCreateOps[0].ad_group).toBe(LIVE_AD_GROUP_RN);
    expect(fake.adGroupAssetRemoveRns).toEqual([LIVE_AD_GROUP_LINK_RN]);

    // Account-level link (no removable parent) always migrates.
    expect(fake.customerAssetCreateOps).toHaveLength(1);
    expect(fake.customerAssetRemoveRns).toEqual([CUSTOMER_LINK_RN]);

    // Result payload reflects the split accurately.
    expect(result.relinked).toEqual({ campaign_assets: 1, ad_group_assets: 1, customer_assets: 1 });
    expect(result.skipped_removed_parent.campaign_assets).toEqual([DEAD_CAMPAIGN_LINK_RN]);
    expect(result.skipped_removed_parent.ad_group_assets).toEqual([DEAD_AD_GROUP_LINK_RN]);
  });
});
