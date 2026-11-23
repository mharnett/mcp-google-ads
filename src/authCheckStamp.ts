// Startup auth-check stamp.
//
// main() used to run `SELECT customer.id FROM customer LIMIT 1` on every
// launch. Each Claude session start launches the server twice (the session's
// own copy plus the SessionStart MCP healthcheck's), so the check alone cost
// about two SearchStream calls per session against the developer token's
// daily quota. Now a passing check writes a stamp, and a launch inside
// AUTH_CHECK_FRESH_MS of it skips the query. A failed check writes nothing, so
// the next launch checks again.
//
// The stamp holds only a timestamp. It is keyed by the customer id and the
// manager login id the check used, never by a credential.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cacheDir } from "./platform.js";

export const AUTH_CHECK_FRESH_MS = 30 * 60 * 1000;

export function authCheckStampPath(customerId: string, loginCustomerId?: string, dir: string = cacheDir): string {
  const id = String(customerId).replace(/\D/g, "");
  const login = String(loginCustomerId ?? "").replace(/\D/g, "");
  return path.join(dir, `auth-check-${id}${login ? `-via-${login}` : ""}.json`);
}

export function isAuthCheckFresh(stampPath: string, now: Date = new Date(), freshMs: number = AUTH_CHECK_FRESH_MS): boolean {
  try {
    const at = Date.parse(JSON.parse(readFileSync(stampPath, "utf-8"))?.checked_at);
    if (!Number.isFinite(at)) return false;
    const age = now.getTime() - at;
    return age >= 0 && age < freshMs;
  } catch {
    return false;
  }
}

/** Never throws: a stamp that cannot be written only costs the next launch a query. */
export function writeAuthCheckStamp(stampPath: string, now: Date = new Date()): void {
  try {
    mkdirSync(path.dirname(stampPath), { recursive: true });
    writeFileSync(stampPath, JSON.stringify({ checked_at: now.toISOString() }));
  } catch {
    // best effort
  }
}

/**
 * Run `check` unless a passing check is stamped inside the window. A throwing
 * check propagates and leaves the stamp as it was.
 */
export async function startupAuthCheck(opts: {
  stampPath: string;
  check: () => Promise<unknown>;
  now?: () => Date;
  freshMs?: number;
}): Promise<"skipped" | "checked"> {
  const now = opts.now ?? (() => new Date());
  if (isAuthCheckFresh(opts.stampPath, now(), opts.freshMs)) return "skipped";
  await opts.check();
  writeAuthCheckStamp(opts.stampPath, now());
  return "checked";
}
