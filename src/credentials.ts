// ============================================
// CREDENTIAL LOADING & PERSISTENCE
// ============================================
// Priority order for resolving credentials at runtime (12-factor style —
// explicit env overrides always win over implicit file storage):
//
//   1. config.json (existing multi-client deployments — unchanged for backwards compat)
//   2. GOOGLE_ADS_* env vars (explicit override — wins if set)
//   3. Per-user credentials file at env-paths config dir (written by mcp-google-ads-auth)
//   4. EMBEDDED_* constants (client_id, client_secret, developer_token only — from build-time injection)
//
// This ordering ensures:
//   - Existing dev machines with env vars keep working (no forced migration)
//   - New end users who run `npx mcp-google-ads-auth` get a zero-config Claude Desktop setup
//   - The published npm package ships with embedded OAuth client credentials so users
//     never need to create their own Google Cloud project
//
// File shape (v1):
// {
//   "version": 1,
//   "refresh_token": "1//0...",
//   "customer_id": "3741961572",
//   "customer_name": "Drak Marketing",
//   "mcc_customer_id": "6761396070" | null,
//   "obtained_at": "2026-04-12T...",
//   "scopes": ["https://www.googleapis.com/auth/adwords"]
// }

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import path from "path";
import {
  EMBEDDED_CLIENT_ID,
  EMBEDDED_CLIENT_SECRET,
  EMBEDDED_DEVELOPER_TOKEN,
} from "./embedded-secrets.js";
import { configDir, credentialsFilePath } from "./platform.js";
import { logger } from "./resilience.js";

export const CREDENTIALS_FILE_VERSION = 1;

export interface StoredCredentials {
  version: number;
  refresh_token: string;
  customer_id: string;
  customer_name?: string;
  mcc_customer_id?: string | null;
  obtained_at: string;
  scopes: string[];
}

export interface ResolvedCredentials {
  client_id: string;
  client_secret: string;
  developer_token: string;
  refresh_token: string;
  customer_id: string;
  mcc_customer_id: string;
  source: "env" | "file" | "mixed";
}

const envTrimmed = (key: string): string =>
  (process.env[key] || "").trim().replace(/^["']|["']$/g, "");

// ============================================
// FILE I/O
// ============================================

export function readStoredCredentials(filePath: string = credentialsFilePath): StoredCredentials | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version !== CREDENTIALS_FILE_VERSION) {
      logger.warn(
        { path: filePath, version: parsed.version, expected: CREDENTIALS_FILE_VERSION },
        "Credentials file version mismatch — ignoring",
      );
      return null;
    }
    return parsed as StoredCredentials;
  } catch (err) {
    logger.warn({ err, path: filePath }, "Failed to parse credentials file — ignoring");
    return null;
  }
}

export function writeStoredCredentials(
  creds: StoredCredentials,
  filePath: string = credentialsFilePath,
): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(creds, null, 2), { encoding: "utf-8" });
  // Tighten perms on POSIX. chmod is a no-op on Windows but doesn't error.
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best-effort; some filesystems (network drives) may reject.
  }
}

// ============================================
// RESOLVE (read-time priority chain)
// ============================================

/**
 * Resolve all credentials needed to make Google Ads API calls.
 *
 * Throws a descriptive Error if any required value is missing after
 * walking the entire priority chain. The error message points users to
 * the correct action (run the auth helper vs. set env vars).
 *
 * The optional `credsFilePath` parameter exists so tests can point at a
 * tmpdir instead of reading the real ~/Library credentials file, and so
 * the MCP server's multi-client mode can read a different location.
 */
export function resolveCredentials(
  credsFilePath: string = credentialsFilePath,
): ResolvedCredentials {
  // Client ID / Secret / Dev Token: env override > embedded
  const client_id = envTrimmed("GOOGLE_ADS_CLIENT_ID") || EMBEDDED_CLIENT_ID;
  const client_secret = envTrimmed("GOOGLE_ADS_CLIENT_SECRET") || EMBEDDED_CLIENT_SECRET;
  const developer_token = envTrimmed("GOOGLE_ADS_DEVELOPER_TOKEN") || EMBEDDED_DEVELOPER_TOKEN;

  // Refresh token / Customer ID: env override > file
  // Explicit env vars always win so a developer can point at a different
  // account without needing to re-run the auth CLI.
  const stored = readStoredCredentials(credsFilePath);
  const envRefresh = envTrimmed("GOOGLE_ADS_REFRESH_TOKEN");
  const envCustomer = envTrimmed("GOOGLE_ADS_CUSTOMER_ID");
  const envMcc = envTrimmed("GOOGLE_ADS_MCC_CUSTOMER_ID");

  const refresh_token = envRefresh || stored?.refresh_token || "";
  const customer_id = envCustomer || stored?.customer_id || "";
  const mcc_customer_id = envMcc || stored?.mcc_customer_id || "";

  const source: ResolvedCredentials["source"] =
    envRefresh && stored ? "mixed" : envRefresh ? "env" : stored ? "file" : "env";

  const missing: string[] = [];
  if (!client_id) missing.push("client_id");
  if (!client_secret) missing.push("client_secret");
  if (!developer_token) missing.push("developer_token");
  if (!refresh_token) missing.push("refresh_token");
  if (!customer_id) missing.push("customer_id");

  if (missing.length > 0) {
    throw new Error(buildMissingCredentialsMessage(missing, Boolean(stored)));
  }

  return {
    client_id,
    client_secret,
    developer_token,
    refresh_token,
    customer_id,
    mcc_customer_id,
    source,
  };
}

function buildMissingCredentialsMessage(missing: string[], hasFile: boolean): string {
  const runAuth = "npx mcp-google-ads-auth";
  const lines: string[] = [
    `Missing Google Ads credentials: ${missing.join(", ")}.`,
    ``,
    `To get started, run:`,
    `    ${runAuth}`,
    ``,
    `This will open your browser, walk you through Google sign-in, let you pick which`,
    `Google Ads account to use, and save the result to:`,
    `    ${credentialsFilePath}`,
  ];
  if (hasFile) {
    lines.push(
      ``,
      `A credentials file exists at ${credentialsFilePath} but is missing required fields.`,
      `Re-run the auth helper to refresh it.`,
    );
  }
  lines.push(
    ``,
    `Advanced: you can bypass the auth helper by setting these env vars in your`,
    `Claude Desktop config: GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID.`,
  );
  return lines.join("\n");
}

// ============================================
// VALIDATION (format sanity)
// ============================================

export function validateResolvedCredentials(creds: ResolvedCredentials): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const check = (name: string, val: string, minLen = 10) => {
    if (val.length < minLen) issues.push(`${name} too short (expected >=${minLen} chars, got ${val.length})`);
  };
  check("client_id", creds.client_id);
  check("client_secret", creds.client_secret);
  check("developer_token", creds.developer_token);
  check("refresh_token", creds.refresh_token);
  // customer_id is 10 digits with or without dashes
  const custDigits = creds.customer_id.replace(/-/g, "");
  if (!/^\d{10}$/.test(custDigits)) {
    issues.push(`customer_id must be 10 digits (got "${creds.customer_id}")`);
  }
  return { valid: issues.length === 0, issues };
}

// Re-export for convenience
export { configDir, credentialsFilePath } from "./platform.js";
