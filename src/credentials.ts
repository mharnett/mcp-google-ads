// ============================================
// CREDENTIAL LOADING & PERSISTENCE
// ============================================
// Priority order for resolving credentials at runtime (12-factor style —
// explicit env overrides always win over implicit file storage):
//
//   1. GOOGLE_ADS_* env vars (explicit override — wins if set)
//   2. Per-user credentials file at env-paths config dir (written by mcp-google-ads-auth):
//      refresh_token, customer_id and mcc_customer_id only
//   3. EMBEDDED_* constants (client_id and client_secret only — from build-time injection)
//
// The developer token has one source, GOOGLE_ADS_DEVELOPER_TOKEN: it is neither
// stored nor embedded. config.json maps clients; the server reads no credential from it.
//
// This ordering ensures:
//   - Existing dev machines with env vars keep working (no forced migration)
//   - End users who run `npx mcp-google-ads-auth` only have to add a developer token
//   - The published npm package ships with embedded OAuth client credentials so users
//     never need to create their own Google Cloud project
//
// File shape (v1):
// {
//   "version": 1,
//   "refresh_token": "1//0...",
//   "customer_id": "1234567890",
//   "customer_name": "Drak Marketing",
//   "mcc_customer_id": "9998887777" | null,
//   "obtained_at": "2026-04-12T...",
//   "scopes": ["https://www.googleapis.com/auth/adwords"]
// }

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import path from "path";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET } from "./embedded-secrets.js";
import { MissingDeveloperTokenError } from "./errors.js";
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
// DEVELOPER TOKEN
// ============================================

/** Where Google grants API access since it sunset developer tokens (2026-09-09). */
export const API_ACCESS_URL = "https://console.cloud.google.com/google/ads-apis/overview";

/** The developer token, or "" when the environment has none. There is no other source. */
export function developerToken(): string {
  return envTrimmed("GOOGLE_ADS_DEVELOPER_TOKEN").trim();
}

/** What to tell someone whose environment has no developer token. */
export function missingDeveloperTokenMessage(): string {
  return [
    `GOOGLE_ADS_DEVELOPER_TOKEN is not set, so no Google Ads API call can be made.`,
    `Nothing is wrong with the installed package: it does not come with a developer token.`,
    ``,
    `Set GOOGLE_ADS_DEVELOPER_TOKEN in the server's environment (the "env" block of your`,
    `MCP client's config), then restart the server:`,
    `  - If you have a developer token, use it. It is in the API Center of your Google Ads`,
    `    manager account.`,
    `  - If you don't, Google no longer issues them for the Google Ads API. Since 9 September`,
    `    2026 it grants access to the Google Cloud project that owns your OAuth client, and`,
    `    says it ignores the token's value, so a placeholder of 10 or more characters should`,
    `    do. Apply for API access at`,
    `    ${API_ACCESS_URL}`,
    `Google's explanation:`,
    `    https://developers.google.com/google-ads/api/docs/api-policy/developer-token`,
  ].join("\n");
}

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
  // Client ID / Secret: env override > embedded. Developer token: env only.
  const client_id = envTrimmed("GOOGLE_ADS_CLIENT_ID") || EMBEDDED_CLIENT_ID;
  const client_secret = envTrimmed("GOOGLE_ADS_CLIENT_SECRET") || EMBEDDED_CLIENT_SECRET;
  const developer_token = developerToken();

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
  if (!refresh_token) missing.push("refresh_token");
  if (!customer_id) missing.push("customer_id");

  if (!developer_token) {
    const rest = missing.length > 0 ? `\n\n${buildMissingCredentialsMessage(missing, Boolean(stored), "Also missing")}` : "";
    throw new MissingDeveloperTokenError(missingDeveloperTokenMessage() + rest, missing);
  }
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

function buildMissingCredentialsMessage(
  missing: string[],
  hasFile: boolean,
  lead = "Missing Google Ads credentials",
): string {
  const runAuth = "npx mcp-google-ads-auth";
  const lines: string[] = [
    `${lead}: ${missing.join(", ")}.`,
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
