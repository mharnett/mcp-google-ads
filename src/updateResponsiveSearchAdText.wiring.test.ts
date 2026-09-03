/**
 * `updateResponsiveSearchAdText` — in-place RSA headline/description edit
 * via AdService (customer.ads.update), not the create-new+pause-old
 * clone-and-swap that `updateAdFinalUrls` uses for final_urls.
 *
 * Context: updateAdFinalUrls's "RSA final_urls is immutable" conclusion
 * (commit ea6cfb0) was reached by mutating through customer.adGroupAds.update
 * (AdGroupAdService) -- confirmed by reading commit 740cc57. Google's own
 * current sample (googleads/google-ads-python,
 * examples/basic_operations/update_responsive_search_ad.py) updates
 * responsive_search_ad.headlines/.descriptions in place via AdService
 * directly, same ad ID, no new ad. This tool uses that same correct path:
 * `customer.ads.update([{resource_name: "customers/X/ads/Y", ad: {...}}])`.
 *
 * One real wrinkle this test suite exists to pin down: an `Ad` resource can
 * be linked into MORE THAN ONE ad_group_ad (confirmed live on the Neon CRM
 * account -- ad 702144555328 has two ad_group_ad links, in two different
 * campaigns). AdService updates the Ad resource itself, so one mutation
 * changes every ad_group_ad that shares it. The tool must surface that
 * blast radius in its dry-run preview and label every affected
 * ad_group_ad, not just the first one found.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CID = "1234567890";
const AD_GROUP_A_ID = "111";
const AD_GROUP_B_ID = "222";
const AD_ID = "999888777";
const AD_GROUP_A_RN = `customers/${CID}/adGroupAds/${AD_GROUP_A_ID}~${AD_ID}`;
const AD_GROUP_B_RN = `customers/${CID}/adGroupAds/${AD_GROUP_B_ID}~${AD_ID}`;
const AD_RN = `customers/${CID}/ads/${AD_ID}`;

const SOLO_AD_ID = "555444333";
const SOLO_AD_GROUP_ID = "333";
const SOLO_AD_GROUP_RN = `customers/${CID}/adGroupAds/${SOLO_AD_GROUP_ID}~${SOLO_AD_ID}`;
const SOLO_AD_RN = `customers/${CID}/ads/${SOLO_AD_ID}`;

const NON_RSA_AD_ID = "111222333";

function baseRsaRow(resourceName: string, adId: string, adGroupId: string, adGroupName: string, campaignName: string) {
  return {
    ad_group_ad: {
      resource_name: resourceName,
      status: 2, // ENABLED
      ad: {
        id: Number(adId),
        type: 15, // RESPONSIVE_SEARCH_AD
        final_urls: ["https://neonone.com/l/nonprofit-software-demo/"],
        responsive_search_ad: {
          headlines: [
            { text: "Neon CRM" },
            { text: "Donor Engagement Platform" },
            { text: "Neon CRM, a Better Alternative", pinned_field: 4 }, // HEADLINE_3
          ],
          descriptions: [
            { text: "Description one" },
            { text: "Description two" },
          ],
          path1: "",
          path2: "",
        },
      },
    },
    ad_group: { id: Number(adGroupId), name: adGroupName },
    campaign: { id: 1, name: campaignName },
  };
}

function makeFakeCustomer() {
  const adUpdates: any[] = [];
  const labelOps: any[] = [];

  const customer = {
    async query(gaql: string) {
      if (/FROM\s+ad_group_ad\b/i.test(gaql) && /responsive_search_ad/i.test(gaql)) {
        const idMatch = gaql.match(/ad_group_ad\.ad\.id\s*=\s*(\d+)/i);
        const requestedId = idMatch?.[1];
        if (requestedId === AD_ID) {
          return [
            baseRsaRow(AD_GROUP_A_RN, AD_ID, AD_GROUP_A_ID, "EveryAction", "google_bofu_neon_crm_competitor"),
            baseRsaRow(AD_GROUP_B_RN, AD_ID, AD_GROUP_B_ID, "Neon CRM", "google_bofu_neon_crm_brand [EXP-PricePage]"),
          ];
        }
        if (requestedId === SOLO_AD_ID) {
          return [baseRsaRow(SOLO_AD_GROUP_RN, SOLO_AD_ID, SOLO_AD_GROUP_ID, "Solo Group", "solo_campaign")];
        }
        if (requestedId === NON_RSA_AD_ID) {
          const row = baseRsaRow(`customers/${CID}/adGroupAds/1~${NON_RSA_AD_ID}`, NON_RSA_AD_ID, "1", "DG Group", "dg_campaign");
          row.ad_group_ad.ad.type = 13; // DEMAND_GEN, not RSA
          return [row];
        }
        return [];
      }
      if (/FROM\s+label\b/i.test(gaql)) {
        return [{ label: { resource_name: `customers/${CID}/labels/1`, name: "x" } }];
      }
      return [];
    },
    ads: {
      async update(ops: any[]) {
        adUpdates.push(...ops);
        return { results: ops.map((o) => ({ resource_name: o.resource_name })) };
      },
    },
    adGroupAdLabels: {
      async create(ops: any[]) {
        labelOps.push(...ops);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
  };

  return { customer, adUpdates, labelOps };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

describe("updateResponsiveSearchAdText", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("dry-runs by default: no mutate call, previews old->new text", async () => {
    const result: any = await mgr.updateResponsiveSearchAdText(
      CID,
      SOLO_AD_ID,
      { headlines: ["Neon One", "Donor Engagement Platform", "Neon One May Be A Better Fit"] },
    );

    expect(result.dry_run).toBe(true);
    expect(fake.adUpdates).toHaveLength(0);
    expect(result.headline_changes).toEqual([
      { index: 0, from: "Neon CRM", to: "Neon One" },
      { index: 2, from: "Neon CRM, a Better Alternative", to: "Neon One May Be A Better Fit" },
    ]);
  });

  it("confirm=true calls customer.ads.update once on the Ad resource with only the changed field", async () => {
    const result: any = await mgr.updateResponsiveSearchAdText(
      CID,
      SOLO_AD_ID,
      { headlines: ["Neon One", "Donor Engagement Platform", "Neon One May Be A Better Fit"] },
      true,
    );

    expect(result.dry_run).toBe(false);
    expect(fake.adUpdates).toHaveLength(1);
    expect(fake.adUpdates[0].resource_name).toBe(SOLO_AD_RN);
    expect(fake.adUpdates[0].responsive_search_ad.headlines.map((h: any) => h.text)).toEqual([
      "Neon One",
      "Donor Engagement Platform",
      "Neon One May Be A Better Fit",
    ]);
    // Descriptions weren't passed in -- must NOT appear in the update payload,
    // so the field mask (auto-derived from present fields) leaves them alone.
    expect(fake.adUpdates[0].responsive_search_ad.descriptions).toBeUndefined();
  });

  it("preserves pinned_position round-trip (pinned_field 4 <-> pinned_position 3)", async () => {
    const result: any = await mgr.updateResponsiveSearchAdText(
      CID,
      SOLO_AD_ID,
      { headlines: ["Neon CRM", "Donor Engagement Platform", { text: "Neon One May Be A Better Fit", pinned_position: 3 }] },
      true,
    );
    expect(result.dry_run).toBe(false);
    expect(fake.adUpdates[0].responsive_search_ad.headlines[2]).toEqual({
      text: "Neon One May Be A Better Fit",
      pinned_field: 4,
    });
  });

  it("refuses ads that are not RESPONSIVE_SEARCH_AD", async () => {
    await expect(
      mgr.updateResponsiveSearchAdText(CID, NON_RSA_AD_ID, { headlines: ["a", "b", "c"] }, true)
    ).rejects.toThrow(/RESPONSIVE_SEARCH_AD/);
    expect(fake.adUpdates).toHaveLength(0);
  });

  it("throws when the ad is not found", async () => {
    await expect(
      mgr.updateResponsiveSearchAdText(CID, "000000", { headlines: ["a", "b", "c"] }, true)
    ).rejects.toThrow(/not found/i);
  });

  it("throws when neither headlines nor descriptions are provided", async () => {
    await expect(mgr.updateResponsiveSearchAdText(CID, SOLO_AD_ID, {}, true)).rejects.toThrow(
      /headlines and\/or descriptions/i
    );
  });

  it("runs RSA validation on the resulting full headline set and rejects an over-length headline", async () => {
    await expect(
      mgr.updateResponsiveSearchAdText(
        CID,
        SOLO_AD_ID,
        { headlines: ["This headline text is deliberately far too long to fit", "b", "c"] },
        true,
      )
    ).rejects.toThrow(/RSA validation failed/);
    expect(fake.adUpdates).toHaveLength(0);
  });

  describe("shared Ad resource (linked into more than one ad group)", () => {
    it("surfaces every linked ad_group_ad in the dry-run preview", async () => {
      const result: any = await mgr.updateResponsiveSearchAdText(CID, AD_ID, {
        headlines: ["Neon One", "Donor Engagement Platform", "Neon One May Be A Better Fit"],
      });

      expect(result.dry_run).toBe(true);
      expect(result.affected_ad_group_ad_links).toHaveLength(2);
      const rns = result.affected_ad_group_ad_links.map((l: any) => l.resource_name);
      expect(rns).toContain(AD_GROUP_A_RN);
      expect(rns).toContain(AD_GROUP_B_RN);
      expect(result.affected_ad_group_ad_links.find((l: any) => l.resource_name === AD_GROUP_B_RN).campaign)
        .toBe("google_bofu_neon_crm_brand [EXP-PricePage]");
    });

    it("on confirm, sends exactly one AdService mutation but labels every linked ad_group_ad", async () => {
      await mgr.updateResponsiveSearchAdText(
        CID,
        AD_ID,
        { headlines: ["Neon One", "Donor Engagement Platform", "Neon One May Be A Better Fit"] },
        true,
      );

      expect(fake.adUpdates).toHaveLength(1);
      expect(fake.adUpdates[0].resource_name).toBe(AD_RN);

      const labeledRns = fake.labelOps.map((op: any) => op.ad_group_ad);
      expect(labeledRns).toContain(AD_GROUP_A_RN);
      expect(labeledRns).toContain(AD_GROUP_B_RN);
    });
  });
});
