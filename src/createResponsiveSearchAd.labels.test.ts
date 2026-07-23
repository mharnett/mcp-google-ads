/**
 * Regression test for the "custom labels silently dropped" bug.
 *
 * BUG (backlog top item, found 2026-04-22): passing `labels: ["a","b"]` to
 * `google_ads_create_responsive_search_ad` was accepted and reported success,
 * but only the auto `claude-MM-DD-YY` label ever attached — the caller's custom
 * labels were never applied. Root cause: `createResponsiveSearchAd` called
 * `autoLabelCreated` (the auto-date label) but never `applyCustomLabels` with
 * `ad.labels`.
 *
 * This is a WIRING bug: each helper (`autoLabelCreated`, `applyCustomLabels`,
 * `labelAdGroupAds`) works in isolation; the defect is that the create method
 * never calls the custom-label path. A unit test of any single helper passes
 * while the system drops labels — so this test drives the REAL
 * `createResponsiveSearchAd` method and asserts on the aggregate set of labels
 * that get attached to the created ad's resource name.
 *
 * We bypass the credential-requiring constructor with Object.create() and stub
 * `getCustomer` with a fake Google Ads customer that records every label-create
 * operation. `withResilience` just executes the passed fn, so the fake's
 * methods run directly.
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const AD_RN = "customers/1234567890/adGroupAds/111~222";

/**
 * Build a fake Google Ads `customer` object plus a recorder that captures
 * which label resource names got attached to which ad_group_ad resource names.
 */
function makeFakeCustomer() {
  // labelName -> resource_name. ensureLabelExists queries this via .query().
  const labelResourceByName: Record<string, string> = {};
  // Records of { ad_group_ad, label } ops sent to adGroupAdLabels.create.
  const appliedLabelOps: Array<{ ad_group_ad: string; label: string }> = [];

  function labelRnFor(name: string): string {
    if (!labelResourceByName[name]) {
      labelResourceByName[name] = `customers/1234567890/labels/${Object.keys(labelResourceByName).length + 1}`;
    }
    return labelResourceByName[name];
  }

  const customer = {
    // ensureLabelExists issues: SELECT ... FROM label WHERE label.name = '<name>'
    // Return the label as already-existing so ensureLabelExists short-circuits
    // (avoids exercising createLabel, which we don't need here).
    async query(gaql: string) {
      const m = gaql.match(/label\.name\s*=\s*'([^']*)'/);
      if (m) {
        const name = m[1];
        return [{ label: { resource_name: labelRnFor(name), name } }];
      }
      return [];
    },
    adGroupAds: {
      async create(_ops: any[]) {
        return { results: [{ resource_name: AD_RN }] };
      },
    },
    adGroupAdLabels: {
      async create(ops: Array<{ ad_group_ad: string; label: string }>) {
        for (const op of ops) appliedLabelOps.push(op);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
  };

  return { customer, appliedLabelOps, labelRnFor };
}

/**
 * Construct a manager without running the credential-requiring constructor,
 * then stub getCustomer to return our fake.
 */
function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

const VALID_RSA = {
  ad_group_id: "999",
  final_urls: ["https://example.com/lp"],
  headlines: ["Headline one", "Headline two", "Headline three"],
  descriptions: ["Description one here", "Description two here"],
  path1: "path1",
  path2: "path2",
};

describe("createResponsiveSearchAd label wiring", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("attaches caller-supplied custom labels to the created ad (not just the auto label)", async () => {
    await mgr.createResponsiveSearchAd("1234567890", {
      ...VALID_RSA,
      labels: ["test-a", "test-b"],
    });

    // Every label op must target the created ad's resource name.
    for (const op of fake.appliedLabelOps) {
      expect(op.ad_group_ad).toBe(AD_RN);
    }

    // The label resource names that got attached, resolved back to names.
    const attachedLabelRns = new Set(fake.appliedLabelOps.map((o) => o.label));
    expect(attachedLabelRns.has(fake.labelRnFor("test-a"))).toBe(true);
    expect(attachedLabelRns.has(fake.labelRnFor("test-b"))).toBe(true);
  });

  it("still applies the auto claude-MM-DD-YY label alongside custom labels", async () => {
    await mgr.createResponsiveSearchAd("1234567890", {
      ...VALID_RSA,
      labels: ["test-a"],
    });

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    const autoLabel = `claude-${mm}-${dd}-${yy}`;

    const attachedLabelRns = new Set(fake.appliedLabelOps.map((o) => o.label));
    expect(attachedLabelRns.has(fake.labelRnFor(autoLabel))).toBe(true);
    expect(attachedLabelRns.has(fake.labelRnFor("test-a"))).toBe(true);
  });

  it("appends a slugged label_descriptor to the auto claude label", async () => {
    await mgr.createResponsiveSearchAd("1234567890", {
      ...VALID_RSA,
      label_descriptor: "Brand CPA Fix",
    });

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    const describedAutoLabel = `claude-${mm}-${dd}-${yy}-brand-cpa-fix`;

    const attachedLabelRns = new Set(fake.appliedLabelOps.map((o) => o.label));
    expect(attachedLabelRns.has(fake.labelRnFor(describedAutoLabel))).toBe(true);
    // and the bare (descriptor-less) auto label is NOT what got attached
    expect(attachedLabelRns.has(fake.labelRnFor(`claude-${mm}-${dd}-${yy}`))).toBe(false);
  });

  it("works (auto label only) when no custom labels are passed", async () => {
    await mgr.createResponsiveSearchAd("1234567890", { ...VALID_RSA });

    // Exactly the auto label should be attached, and it must target the ad.
    expect(fake.appliedLabelOps.length).toBe(1);
    expect(fake.appliedLabelOps[0].ad_group_ad).toBe(AD_RN);
  });
});
