/**
 * google_ads_update_campaign_end_date: set the last serving day on existing
 * campaigns. v24 field is Campaign.end_date_time ("yyyy-MM-dd HH:mm:ss",
 * customer time zone); a whole day ends at 23:59:59.
 *
 * Manager tests drive the REAL GoogleAdsManager method against a fake customer
 * whose query() returns canned live state and whose mutate entry points record
 * into `writes`, so "no write was made" is checked directly.
 */

import { describe, expect, it } from "vitest";

import { GoogleAdsManager } from "./index.js";
import { buildCampaignEndDateUpdates, normalizeEndDate } from "./campaignEndDate.js";
import { ExpectedOldMismatch } from "./writeGuards.js";

const CID = "1234567890";
const rn = (id: string) => `customers/${CID}/campaigns/${id}`;

describe("buildCampaignEndDateUpdates", () => {
  it("ends every campaign at 23:59:59 on the given day", () => {
    expect(buildCampaignEndDateUpdates([rn("111"), rn("112")], "2026-11-30")).toEqual([
      { resource_name: rn("111"), end_date_time: "2026-11-30 23:59:59" },
      { resource_name: rn("112"), end_date_time: "2026-11-30 23:59:59" },
    ]);
  });

  it.each(["2026-11-31", "11/30/2026", "2026-11-30 23:59:59", ""])("refuses %j", (bad) => {
    expect(() => buildCampaignEndDateUpdates([rn("111")], bad)).toThrow(/end_date/);
  });
});

describe("normalizeEndDate", () => {
  it.each([
    ["", "NONE"],
    [null, "NONE"],
    [undefined, "NONE"],
    ["2037-12-30 23:59:59", "NONE"],
    ["2026-11-30 23:59:59", "2026-11-30"],
  ])("%j -> %s", (raw, want) => {
    expect(normalizeEndDate(raw as any)).toBe(want);
  });
});

// ---------------------------------------------------------------------------
// Manager wiring
// ---------------------------------------------------------------------------

type Row = { campaign: { id: string; name: string; status: number; end_date_time?: string } };

function makeFake(before: Row[], after: Row[] = before) {
  const writes: Array<{ via: string; ops: any }> = [];
  let reads = 0;
  const customer: any = {
    query: async () => (reads++ === 0 ? before : after),
    campaigns: {
      update: async (ops: any) => {
        writes.push({ via: "campaigns.update", ops });
        return { results: ops.map((o: any) => ({ resource_name: o.resource_name })) };
      },
    },
    mutateResources: async (ops: any) => {
      writes.push({ via: "mutateResources", ops });
      return {};
    },
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

const LIVE: Row[] = [
  { campaign: { id: "111", name: "NAM YouTube Reach", status: 2, end_date_time: "" } },
  { campaign: { id: "112", name: "EMEA YouTube Reach", status: 2, end_date_time: "2037-12-30 23:59:59" } },
];
const ENDED: Row[] = LIVE.map((r) => ({ campaign: { ...r.campaign, end_date_time: "2026-11-30 23:59:59" } }));

describe("updateCampaignEndDate", () => {
  it("dry run reads names and current end dates and writes nothing", async () => {
    const { customer, writes } = makeFake(LIVE);
    const out = await makeManager(customer).updateCampaignEndDate(CID, ["111", "112"], "2026-11-30", undefined, {
      dry_run: true,
    });
    expect(writes).toHaveLength(0);
    expect(out.dry_run).toBe(true);
    expect(out.campaigns).toEqual([
      { id: "111", name: "NAM YouTube Reach", status: "ENABLED", current_end: "NONE", new_end: "2026-11-30 23:59:59" },
      { id: "112", name: "EMEA YouTube Reach", status: "ENABLED", current_end: "NONE", new_end: "2026-11-30 23:59:59" },
    ]);
  });

  it("refuses an id the account does not have, naming it, with no write", async () => {
    const { customer, writes } = makeFake(LIVE);
    await expect(
      makeManager(customer).updateCampaignEndDate(CID, ["111", "999"], "2026-11-30")
    ).rejects.toThrow(/999/);
    expect(writes).toHaveLength(0);
  });

  it("refuses on expected_old mismatch, naming the campaign, with no write", async () => {
    const live: Row[] = [LIVE[0], { campaign: { ...LIVE[1].campaign, end_date_time: "2026-12-31 23:59:59" } }];
    const { customer, writes } = makeFake(live);
    const err = await makeManager(customer)
      .updateCampaignEndDate(CID, ["111", "112"], "2026-11-30", undefined, { expected_old: "NONE" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExpectedOldMismatch);
    expect(err.message).toContain("EMEA YouTube Reach");
    expect(writes).toHaveLength(0);
  });

  it("applies one update with the built operations and reports the read-back", async () => {
    const { customer, writes } = makeFake(LIVE, ENDED);
    const out = await makeManager(customer).updateCampaignEndDate(CID, ["111", "112"], "2026-11-30", "claude-11-20-26-q4-cut", {
      expected_old: "NONE",
    });
    expect(writes).toEqual([
      { via: "campaigns.update", ops: buildCampaignEndDateUpdates([rn("111"), rn("112")], "2026-11-30") },
    ]);
    expect(out.dry_run).toBe(false);
    expect(out.all_match).toBe(true);
    expect(out.campaigns.map((c: any) => [c.id, c.before, c.after])).toEqual([
      ["111", "NONE", "2026-11-30 23:59:59"],
      ["112", "NONE", "2026-11-30 23:59:59"],
    ]);
    expect(out.label_applied).toBe("claude-11-20-26-q4-cut");
  });

  it("flags a campaign whose read-back did not take the new end date", async () => {
    const partial: Row[] = [ENDED[0], LIVE[1]];
    const { customer } = makeFake(LIVE, partial);
    const out = await makeManager(customer).updateCampaignEndDate(CID, ["111", "112"], "2026-11-30");
    expect(out.all_match).toBe(false);
    expect(out.mismatched).toEqual(["112"]);
  });
});
