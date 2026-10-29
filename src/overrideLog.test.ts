/**
 * Audit trail for confirm_large_change overrides: one JSONL line per
 * override, always; one webhook post when a webhook is configured. A missing
 * or failing webhook never fails the write.
 */

import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleAdsManager } from "./index.js";
import { recordOverride, resolveOverrideLogTarget, formatOverrideLine } from "./overrideLog.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gads-override-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ENTRY = {
  tool: "google_ads_update_campaign_budget",
  entity: 'campaign "Brand Search" (id 111)',
  old: "$100.00",
  new: "$300.00",
  change_pct: 200,
  reason: "launch week",
};

function readLines(p: string): any[] {
  return readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
}

describe("recordOverride", () => {
  it("appends one JSONL line with timestamp, tool, entity, old, new and reason", async () => {
    const logPath = join(dir, "nested", "overrides.jsonl");
    const res = await recordOverride(ENTRY, { logPath, webhookUrl: null }, new Date("2026-10-29T12:00:00Z"));
    expect(res.logged).toBe(true);
    const lines = readLines(logPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ timestamp: "2026-10-29T12:00:00.000Z", ...ENTRY });
  });

  it("appends, never overwrites", async () => {
    const logPath = join(dir, "overrides.jsonl");
    await recordOverride(ENTRY, { logPath, webhookUrl: null });
    await recordOverride({ ...ENTRY, reason: "second" }, { logPath, webhookUrl: null });
    const lines = readLines(logPath);
    expect(lines.map((l) => l.reason)).toEqual(["launch week", "second"]);
  });

  it("posts one line to the webhook when configured", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await recordOverride(ENTRY, {
      logPath: join(dir, "o.jsonl"),
      webhookUrl: "https://hooks.example.test/abc",
      fetchImpl: fetchImpl as any,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe("https://hooks.example.test/abc");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.text).toBe(formatOverrideLine(ENTRY));
    expect(body.text).not.toContain("\n");
    expect(body.text).toContain("Brand Search");
    expect(body.text).toContain("launch week");
    expect(res.posted).toBe(true);
  });

  it("does not post and does not fail when no webhook is configured", async () => {
    const fetchImpl = vi.fn();
    const res = await recordOverride(ENTRY, { logPath: join(dir, "o.jsonl"), webhookUrl: null, fetchImpl: fetchImpl as any });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.posted).toBe(false);
    expect(res.logged).toBe(true);
  });

  it("swallows a webhook network error and a non-2xx response", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r1 = await recordOverride(ENTRY, { logPath: join(dir, "o.jsonl"), webhookUrl: "https://hooks.example.test/x", fetchImpl: boom as any });
    expect(r1.posted).toBe(false);
    expect(r1.webhook_error).toContain("ECONNREFUSED");

    const bad = vi.fn(async () => new Response("no", { status: 500 }));
    const r2 = await recordOverride(ENTRY, { logPath: join(dir, "o.jsonl"), webhookUrl: "https://hooks.example.test/x", fetchImpl: bad as any });
    expect(r2.posted).toBe(false);
    expect(r2.webhook_error).toContain("500");
    expect(readLines(join(dir, "o.jsonl"))).toHaveLength(2);
  });

  it("logPath null disables the file log", async () => {
    const res = await recordOverride(ENTRY, { logPath: null, webhookUrl: null });
    expect(res.logged).toBe(false);
  });
});

describe("resolveOverrideLogTarget", () => {
  it("reads the log path and webhook from env, defaulting the path under the config dir", () => {
    const t = resolveOverrideLogTarget({
      GOOGLE_ADS_MCP_OVERRIDE_LOG: "/x/o.jsonl",
      GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL: "https://hooks.example.test/a",
    } as any);
    expect(t).toEqual({ logPath: "/x/o.jsonl", webhookUrl: "https://hooks.example.test/a" });

    const d = resolveOverrideLogTarget({} as any);
    expect(d.webhookUrl).toBeNull();
    expect(d.logPath).toMatch(/overrides\.jsonl$/);
  });

  it("explicit target fields win over env", () => {
    const t = resolveOverrideLogTarget({ GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL: "https://a.test" } as any, {
      logPath: null,
      webhookUrl: null,
    });
    expect(t).toEqual({ logPath: null, webhookUrl: null });
  });
});

// ---------------------------------------------------------------------------
// Manager wiring
// ---------------------------------------------------------------------------

function makeBudgetFake() {
  const writes: any[] = [];
  const customer: any = {
    query: async () => [
      { campaign: { id: "111", name: "Brand Search" }, campaign_budget: { id: "777", amount_micros: 100_000_000 } },
    ],
    campaignBudgets: { update: async (ops: any[]) => (writes.push(ops), { results: [] }) },
  };
  return { customer, writes };
}

function makeBiddingFake() {
  const writes: any[] = [];
  const customer: any = {
    query: async () => [
      { campaign: { id: "111", name: "Brand Search", bidding_strategy_type: 6, target_cpa: { target_cpa_micros: 50_000_000 } } },
    ],
    campaigns: { update: async (ops: any[]) => (writes.push(ops), { results: [] }) },
  };
  return { customer, writes };
}

function mgrFor(customer: any): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).config = { defaults: {} };
  (mgr as any).getCustomer = () => customer;
  return mgr;
}

describe("override log wiring", () => {
  it("budget override writes one JSONL line naming the campaign, old -> new and reason", async () => {
    const logPath = join(dir, "o.jsonl");
    const { customer, writes } = makeBudgetFake();
    await mgrFor(customer).updateCampaignBudget("1234567890", "111", 300, false, {
      confirm_large_change: true,
      reason: "launch week",
      overrideLog: { logPath, webhookUrl: null },
    });
    expect(writes).toHaveLength(1);
    const [line] = readLines(logPath);
    expect(line.tool).toBe("google_ads_update_campaign_budget");
    expect(line.entity).toContain("Brand Search");
    expect(line.old).toBe("$100.00");
    expect(line.new).toBe("$300.00");
    expect(line.reason).toBe("launch week");
  });

  it("a within-ceiling budget change writes no log line", async () => {
    const logPath = join(dir, "o.jsonl");
    const { customer } = makeBudgetFake();
    await mgrFor(customer).updateCampaignBudget("1234567890", "111", 110, false, {
      confirm_large_change: true,
      reason: "x",
      overrideLog: { logPath, webhookUrl: null },
    });
    expect(existsSync(logPath)).toBe(false);
  });

  it("a failing webhook does not fail the budget write", async () => {
    const logPath = join(dir, "o.jsonl");
    const { customer, writes } = makeBudgetFake();
    const result: any = await mgrFor(customer).updateCampaignBudget("1234567890", "111", 300, false, {
      confirm_large_change: true,
      reason: "launch week",
      overrideLog: {
        logPath,
        webhookUrl: "https://hooks.example.test/x",
        fetchImpl: (async () => {
          throw new Error("down");
        }) as any,
      },
    });
    expect(writes).toHaveLength(1);
    expect(result.override_log.posted).toBe(false);
    expect(readLines(logPath)).toHaveLength(1);
  });

  it("bidding override writes one JSONL line", async () => {
    const logPath = join(dir, "o.jsonl");
    const { customer, writes } = makeBiddingFake();
    await mgrFor(customer).updateCampaignBidding("1234567890", "111", {
      target_cpa_dollars: 100,
      confirm_large_change: true,
      reason: "new conversion action",
      overrideLog: { logPath, webhookUrl: null },
    });
    expect(writes).toHaveLength(1);
    const [line] = readLines(logPath);
    expect(line.tool).toBe("google_ads_update_campaign_bidding");
    expect(line.old).toBe("TARGET_CPA $50.00");
    expect(line.new).toBe("TARGET_CPA $100.00");
    expect(line.reason).toBe("new conversion action");
  });

  it("a within-ceiling bidding change with confirm_large_change writes no log line", async () => {
    const logPath = join(dir, "o.jsonl");
    const { customer } = makeBiddingFake();
    await mgrFor(customer).updateCampaignBidding("1234567890", "111", {
      target_cpa_dollars: 52,
      confirm_large_change: true,
      overrideLog: { logPath, webhookUrl: null },
    });
    expect(existsSync(logPath)).toBe(false);
  });
});
