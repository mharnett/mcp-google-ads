/**
 * Keyword (ad_group_criterion) labelling: pause and apply_label.
 *
 * GAP (found 2026-10-28): 15 client keywords were paused through
 * `google_ads_pause_keywords` and none carried an audit label — pause never
 * labelled, and `google_ads_apply_label` had no keyword target, so there was
 * no MCP path to backfill one. `enableKeywords` already auto-labels; pause
 * now mirrors it, and apply_label gains `criterionResourceNames`.
 *
 * Drives the REAL manager methods against a fake customer that records every
 * criterion-label op (same pattern as createResponsiveSearchAd.labels.test.ts).
 */

import { describe, expect, it, beforeEach } from "vitest";

import { GoogleAdsManager } from "./index.js";

const CID = "1234567890";
const KW1 = `customers/${CID}/adGroupCriteria/111~222`;
const KW2 = `customers/${CID}/adGroupCriteria/333~444`;

function makeFakeCustomer(opts: { failLabels?: boolean } = {}) {
  const labelResourceByName: Record<string, string> = {};
  const criterionLabelOps: Array<{ ad_group_criterion: string; label: string }> = [];
  const statusUpdates: any[] = [];

  function labelRnFor(name: string): string {
    if (!labelResourceByName[name]) {
      labelResourceByName[name] = `customers/${CID}/labels/${Object.keys(labelResourceByName).length + 1}`;
    }
    return labelResourceByName[name];
  }

  const customer = {
    async query(gaql: string) {
      const m = gaql.match(/label\.name\s*=\s*'([^']*)'/);
      if (m) return [{ label: { resource_name: labelRnFor(m[1]), name: m[1] } }];
      return [];
    },
    adGroupCriteria: {
      async update(ops: any[]) {
        statusUpdates.push(...ops);
        return { results: ops.map((o) => ({ resource_name: o.resource_name })) };
      },
    },
    adGroupCriterionLabels: {
      async create(ops: Array<{ ad_group_criterion: string; label: string }>) {
        if (opts.failLabels) throw new Error("label create failed");
        criterionLabelOps.push(...ops);
        return { results: ops.map(() => ({ resource_name: "x" })) };
      },
    },
  };

  return { customer, criterionLabelOps, statusUpdates, labelRnFor };
}

function makeManager(fakeCustomer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: { label_prefix: "claude:" } };
  (mgr as any).getCustomer = () => fakeCustomer;
  return mgr;
}

function todayLabel(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `claude-${mm}-${dd}-${yy}`;
}

describe("pauseKeywords labelling", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("auto-applies today's claude-MM-DD-YY label to every paused keyword", async () => {
    await mgr.pauseKeywords(CID, [KW1, KW2]);

    const auto = fake.labelRnFor(todayLabel());
    const labelled = fake.criterionLabelOps.filter((o) => o.label === auto).map((o) => o.ad_group_criterion);
    expect(labelled.sort()).toEqual([KW1, KW2].sort());
  });

  it("also applies caller-supplied custom labels", async () => {
    await (mgr as any).pauseKeywords(CID, [KW1], ["negconflict-review"]);

    const custom = fake.labelRnFor("negconflict-review");
    expect(fake.criterionLabelOps.some((o) => o.label === custom && o.ad_group_criterion === KW1)).toBe(true);
  });

  it("still pauses when labelling fails (label is best-effort)", async () => {
    fake = makeFakeCustomer({ failLabels: true });
    mgr = makeManager(fake.customer);

    await expect(mgr.pauseKeywords(CID, [KW1])).resolves.toBeDefined();
    expect(fake.statusUpdates.map((u) => u.resource_name)).toEqual([KW1]);
  });
});

describe("applyLabel keyword targets", () => {
  let fake: ReturnType<typeof makeFakeCustomer>;
  let mgr: GoogleAdsManager;

  beforeEach(() => {
    fake = makeFakeCustomer();
    mgr = makeManager(fake.customer);
  });

  it("labels keywords passed as criterionResourceNames", async () => {
    const result = await (mgr as any).applyLabel(CID, "claude-10-28-26", {
      criterionResourceNames: [KW1, KW2],
    });

    const rn = fake.labelRnFor("claude-10-28-26");
    expect(fake.criterionLabelOps.filter((o) => o.label === rn).map((o) => o.ad_group_criterion).sort())
      .toEqual([KW1, KW2].sort());
    expect(result.keywords_labeled).toBe(2);
  });

  it("accepts a dashed customer id", async () => {
    await (mgr as any).applyLabel("123-456-7890", "x", { criterionResourceNames: [KW1] });
    expect(fake.criterionLabelOps).toHaveLength(1);
  });

  it("refuses a criterion resource name from another customer, labelling nothing", async () => {
    await expect(
      (mgr as any).applyLabel(CID, "x", {
        criterionResourceNames: [KW1, "customers/9999999999/adGroupCriteria/1~2"],
      }),
    ).rejects.toThrow(/9999999999/);
    expect(fake.criterionLabelOps).toHaveLength(0);
  });

  it("refuses a non-criterion resource name", async () => {
    await expect(
      (mgr as any).applyLabel(CID, "x", { criterionResourceNames: [`customers/${CID}/campaigns/5`] }),
    ).rejects.toThrow(/adGroupCriteria/);
  });
});
