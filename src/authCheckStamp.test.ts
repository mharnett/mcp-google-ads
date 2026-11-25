/**
 * The startup auth query runs at most once per 30 minutes per account.
 *
 * Containment: the "check" is a test function or a recording fake customer;
 * nothing here builds a real Google Ads client or reads credentials. Stamps
 * go to a temp dir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AUTH_CHECK_FRESH_MS,
  authCheckStampPath,
  isAuthCheckFresh,
  startupAuthCheck,
  writeAuthCheckStamp,
} from "./authCheckStamp.js";
import { runStartupAuthCheck } from "./index.js";

let dir: string;
const T0 = new Date("2026-11-23T20:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gads-stamp-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("startupAuthCheck", () => {
  it("runs the check and stamps it when there is no stamp", async () => {
    const stampPath = authCheckStampPath("123-456-7890", undefined, dir);
    const check = vi.fn(async () => {});
    await expect(startupAuthCheck({ stampPath, check, now: () => T0 })).resolves.toBe("checked");
    expect(check).toHaveBeenCalledTimes(1);
    expect(isAuthCheckFresh(stampPath, minutes(1))).toBe(true);
  });

  it("skips the check while the stamp is under 30 minutes old", async () => {
    const stampPath = authCheckStampPath("1234567890", undefined, dir);
    writeAuthCheckStamp(stampPath, T0);
    const check = vi.fn(async () => {});
    await expect(startupAuthCheck({ stampPath, check, now: () => minutes(29) })).resolves.toBe("skipped");
    expect(check).not.toHaveBeenCalled();
  });

  it("runs it again once the stamp is 30 minutes old, and refreshes the stamp", async () => {
    const stampPath = authCheckStampPath("1234567890", undefined, dir);
    writeAuthCheckStamp(stampPath, T0);
    const check = vi.fn(async () => {});
    await expect(startupAuthCheck({ stampPath, check, now: () => minutes(30) })).resolves.toBe("checked");
    expect(check).toHaveBeenCalledTimes(1);
    expect(isAuthCheckFresh(stampPath, minutes(59))).toBe(true);
    expect(isAuthCheckFresh(stampPath, minutes(60))).toBe(false);
  });

  it("a failed check throws and leaves no fresh stamp, so the next launch checks again", async () => {
    const stampPath = authCheckStampPath("1234567890", undefined, dir);
    const err = new Error("invalid_grant");
    await expect(startupAuthCheck({ stampPath, check: async () => { throw err; }, now: () => T0 })).rejects.toBe(err);
    expect(existsSync(stampPath)).toBe(false);
    const check = vi.fn(async () => {});
    await startupAuthCheck({ stampPath, check, now: () => minutes(1) });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("a stamp dated in the future or unreadable does not count as fresh", () => {
    const stampPath = authCheckStampPath("1234567890", undefined, dir);
    writeAuthCheckStamp(stampPath, minutes(5));
    expect(isAuthCheckFresh(stampPath, T0)).toBe(false);
    writeFileSync(stampPath, "not json");
    expect(isAuthCheckFresh(stampPath, T0)).toBe(false);
  });

  it("an unwritable stamp location never fails a passing check", async () => {
    const blocker = path.join(dir, "file");
    writeFileSync(blocker, "");
    const stampPath = path.join(blocker, "stamp.json");
    await expect(startupAuthCheck({ stampPath, check: async () => {}, now: () => T0 })).resolves.toBe("checked");
  });

  it("stamps are per account and per manager login", () => {
    const a = authCheckStampPath("123-456-7890", undefined, dir);
    expect(authCheckStampPath("1234567890", undefined, dir)).toBe(a);
    expect(authCheckStampPath("1111111111", undefined, dir)).not.toBe(a);
    expect(authCheckStampPath("1234567890", "999-888-7777", dir)).not.toBe(a);
    expect(path.dirname(a)).toBe(dir);
  });

  it("the window is 30 minutes", () => {
    expect(AUTH_CHECK_FRESH_MS).toBe(30 * 60 * 1000);
  });
});

describe("runStartupAuthCheck (the main() startup path)", () => {
  function fakes() {
    const queries: string[] = [];
    const opened: string[] = [];
    const manager = {
      getCustomer(id: string) {
        opened.push(id);
        return { query: async (gaql: string) => { queries.push(gaql); return []; } };
      },
    };
    const config: any = {
      google_ads: { mcc_customer_id: "999-888-7777" },
      clients: { first: { name: "First", customer_id: "123-456-7890" } },
    };
    return { queries, opened, manager, config };
  }

  it("two launches inside 30 minutes make one auth query", async () => {
    const f = fakes();
    const first = await runStartupAuthCheck(f.config, () => f.manager as any, { stampDir: dir, now: () => T0 });
    const second = await runStartupAuthCheck(f.config, () => f.manager as any, { stampDir: dir, now: () => minutes(10) });
    expect([first, second]).toEqual(["checked", "skipped"]);
    expect(f.queries).toHaveLength(1);
    expect(f.opened).toEqual(["123-456-7890"]);
  });

  it("a launch after the window queries again", async () => {
    const f = fakes();
    await runStartupAuthCheck(f.config, () => f.manager as any, { stampDir: dir, now: () => T0 });
    await runStartupAuthCheck(f.config, () => f.manager as any, { stampDir: dir, now: () => minutes(31) });
    expect(f.queries).toHaveLength(2);
  });

  it("MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK=1 skips the query and writes no stamp", async () => {
    const f = fakes();
    const opts = { stampDir: dir, now: () => T0 };
    await expect(
      runStartupAuthCheck(f.config, () => f.manager as any, { ...opts, env: { MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK: "1" } }),
    ).resolves.toBe("skipped");
    expect(f.opened).toEqual([]);
    expect(existsSync(authCheckStampPath("123-456-7890", "999-888-7777", dir))).toBe(false);
  });

  it.each(["", "0", "false"])("MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK=%j does not skip it", async (value) => {
    const f = fakes();
    const opts = { stampDir: dir, now: () => T0 };
    await expect(
      runStartupAuthCheck(f.config, () => f.manager as any, { ...opts, env: { MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK: value } }),
    ).resolves.toBe("checked");
    expect(f.queries).toHaveLength(1);
  });

  it("no configured client means no query and no stamp", async () => {
    const f = fakes();
    f.config.clients = {};
    await expect(runStartupAuthCheck(f.config, () => f.manager as any, { stampDir: dir, now: () => T0 })).resolves.toBe("no-client");
    expect(f.queries).toHaveLength(0);
  });

  it("the stamp file holds a timestamp, never a credential", async () => {
    const f = fakes();
    await runStartupAuthCheck(f.config, () => f.manager as any, { stampDir: dir, now: () => T0 });
    const stamp = authCheckStampPath("123-456-7890", "999-888-7777", dir);
    expect(JSON.parse(readFileSync(stamp, "utf-8"))).toEqual({ checked_at: T0.toISOString() });
  });
});
