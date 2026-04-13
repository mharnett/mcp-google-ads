#!/usr/bin/env node
// ============================================
// mcp-google-ads-auth  —  one-time OAuth + account selection
// ============================================
// Flow:
//   1. Spin up a local loopback HTTP listener on a free port in 8085-8199.
//   2. Open the user's default browser to Google's OAuth consent screen
//      with that loopback URL as the redirect_uri.
//   3. User signs in + grants Google Ads scope; Google redirects to loopback
//      with ?code=... which this script captures.
//   4. Exchange the code for an access + refresh token (wrapped in
//      withResilience for network flake tolerance).
//   5. Call listAccessibleCustomers — returns the Google Ads customer IDs
//      the authenticated user can touch at the top level (usually MCCs +
//      any direct-access client accounts).
//   6. For each, fetch customer.descriptive_name. For each MCC, drill one
//      level to enumerate its non-manager children.
//   7. Present a picker. User selects the account they want to work in.
//   8. Write { refresh_token, customer_id, customer_name, mcc_customer_id }
//      to env-paths config file with mode 0600.
//   9. Tell the user to restart Claude Desktop.
//
// All auth errors fail fast (invalid_grant, 401, 403) per the repo-wide
// resilience contract — only network/5xx/rate-limit transients are retried.

import { GoogleAdsApi } from "google-ads-api";
import http from "http";
import promptsImport from "prompts";
import { URL } from "url";
import { writeStoredCredentials, credentialsFilePath, CREDENTIALS_FILE_VERSION, type StoredCredentials } from "./credentials.js";
import {
  EMBEDDED_CLIENT_ID,
  EMBEDDED_CLIENT_SECRET,
  EMBEDDED_DEVELOPER_TOKEN,
} from "./embedded-secrets.js";
import { classifyError, GoogleAdsAuthError } from "./errors.js";
import { findFreeLoopbackPort, openBrowser } from "./platform.js";
import { logger, withResilience } from "./resilience.js";

const prompts = (promptsImport as unknown as { default?: typeof promptsImport }).default ?? promptsImport;

const OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface CliArgs {
  customerId?: string; // Optional shortcut: skip the picker
  help: boolean;
}

interface AccessibleAccount {
  id: string;
  name: string;
  isManager: boolean;
  parentMccId?: string;
  parentMccName?: string;
}

// ============================================
// ARG PARSING
// ============================================

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--customer-id" && argv[i + 1]) {
      args.customerId = argv[++i].replace(/-/g, "");
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      "mcp-google-ads-auth  —  authorize Claude to access your Google Ads account",
      "",
      "Usage:",
      "  npx mcp-google-ads-auth",
      "  npx mcp-google-ads-auth --customer-id 374-196-1572",
      "",
      "Options:",
      "  --customer-id <id>   Skip the account picker and use this customer ID directly",
      "  -h, --help           Show this help",
      "",
      `Credentials are written to: ${credentialsFilePath}`,
      "",
    ].join("\n"),
  );
}

// ============================================
// OAUTH: LOOPBACK REDIRECT FLOW
// ============================================

function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

interface AuthorizationCode {
  code: string;
  state: string;
}

/**
 * Start a one-shot HTTP server, open the browser, resolve when Google
 * redirects back with a ?code=... query param. Rejects on user cancel,
 * state mismatch, or timeout.
 */
async function waitForAuthorizationCode(
  port: number,
  expectedState: string,
  authUrl: string,
): Promise<AuthorizationCode> {
  return new Promise<AuthorizationCode>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = http.createServer((req, res) => {
      // Ignore favicon/etc
      if (!req.url) {
        res.writeHead(404).end();
        return;
      }
      const parsed = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");
      const error = parsed.searchParams.get("error");

      if (error) {
        const body = renderAuthCompletePage(
          "Authorization was denied",
          `Google returned: ${escapeHtml(error)}. You can close this tab and re-run the command.`,
        );
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
        finish(() => {
          server.close();
          reject(new GoogleAdsAuthError(`OAuth denied: ${error}`));
        });
        return;
      }

      if (!code) {
        // Not the redirect we care about (favicon, preflight, etc.)
        res.writeHead(204).end();
        return;
      }

      if (state !== expectedState) {
        const body = renderAuthCompletePage(
          "Security check failed",
          "The state parameter did not match. This tab may have been tampered with. Please re-run the command.",
        );
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
        finish(() => {
          server.close();
          reject(new GoogleAdsAuthError("OAuth state mismatch — possible CSRF"));
        });
        return;
      }

      const body = renderAuthCompletePage(
        "Signed in successfully",
        "You can close this tab and return to the terminal.",
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      finish(() => {
        // Give the browser a beat to render the response before tearing down
        setTimeout(() => server.close(), 200);
        resolve({ code, state });
      });
    });

    server.on("error", (err) => {
      finish(() => reject(new Error(`Loopback server failed: ${err.message}`)));
    });

    server.listen(port, "127.0.0.1", () => {
      process.stderr.write(`\nOpening your browser to sign in with Google...\n`);
      process.stderr.write(`If it doesn't open automatically, visit:\n  ${authUrl}\n\n`);
      openBrowser(authUrl).catch((err) => {
        // Non-fatal: user can still paste the URL manually
        logger.warn({ err: err.message }, "openBrowser failed — user can paste URL manually");
      });
    });

    // 5 minute timeout
    setTimeout(() => {
      finish(() => {
        server.close();
        reject(new Error("Timed out waiting for OAuth callback (5 minutes). Re-run the command."));
      });
    }, 5 * 60 * 1000);
  });
}

function renderAuthCompletePage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           max-width: 480px; margin: 80px auto; padding: 0 24px; color: #222; }
    h1 { font-size: 22px; margin-bottom: 12px; }
    p { line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ============================================
// TOKEN EXCHANGE
// ============================================

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  // Wrap the POST in withResilience so we tolerate network blips, but the
  // underlying isTransient() rejects invalid_grant / 401 / 403 so bad creds
  // fail fast.
  return withResilience(async () => {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok || json.error) {
      // Attach status so isTransient sees 401/403 and doesn't retry
      const err = new Error(
        `Token exchange failed: ${json.error_description || json.error || res.statusText}`,
      );
      (err as any).status = res.status;
      (err as any).code = res.status;
      throw err;
    }
    return json as unknown as TokenResponse;
  }, "oauth.exchangeCode");
}

// ============================================
// ACCOUNT ENUMERATION
// ============================================

async function enumerateAccounts(
  api: GoogleAdsApi,
  refreshToken: string,
): Promise<AccessibleAccount[]> {
  // listAccessibleCustomers returns { resource_names: ["customers/1234567890", ...] }
  // These are TOP-LEVEL: MCCs and any direct-access client accounts. Sub-accounts
  // under an MCC are not included — we fetch those via customer_client below.
  const listed = await withResilience(
    () => api.listAccessibleCustomers(refreshToken),
    "auth.listAccessibleCustomers",
  );

  const topLevelIds = (listed.resource_names || []).map((rn) =>
    rn.replace("customers/", ""),
  );

  if (topLevelIds.length === 0) {
    throw new GoogleAdsAuthError(
      "No Google Ads accounts accessible to this Google login. " +
        "Make sure you signed in with an account that has access to at least one Google Ads account.",
    );
  }

  const accounts: AccessibleAccount[] = [];

  for (const id of topLevelIds) {
    try {
      // Fetch name + manager flag for this top-level account
      const customer = api.Customer({ customer_id: id, refresh_token: refreshToken });
      const rows = await withResilience(
        () => customer.query("SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1"),
        `auth.fetchCustomer[${id}]`,
      );
      const row = (rows as any[])[0]?.customer;
      const name = row?.descriptive_name || `(unnamed ${id})`;
      const isManager = Boolean(row?.manager);

      accounts.push({ id, name, isManager });

      // If MCC, enumerate its non-manager children (single-level drill)
      if (isManager) {
        const mccCustomer = api.Customer({
          customer_id: id,
          refresh_token: refreshToken,
          login_customer_id: id,
        });
        try {
          const children = await withResilience(
            () =>
              mccCustomer.query(
                "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager " +
                  "FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED'",
              ),
            `auth.enumerateChildren[${id}]`,
          );
          for (const childRow of children as any[]) {
            const cc = childRow.customer_client;
            if (!cc?.id) continue;
            const childId = String(cc.id);
            // Skip the MCC itself if it appears (customer_client returns self in some cases)
            if (childId === id) continue;
            accounts.push({
              id: childId,
              name: cc.descriptive_name || `(unnamed ${childId})`,
              isManager: false,
              parentMccId: id,
              parentMccName: name,
            });
          }
        } catch (err) {
          logger.warn(
            { err: (err as Error).message, mccId: id },
            "Failed to enumerate MCC children — MCC will still appear in picker",
          );
        }
      }
    } catch (err) {
      const classified = classifyError(err);
      if (classified instanceof GoogleAdsAuthError) throw classified;
      logger.warn({ err: classified.message, customerId: id }, "Failed to fetch account info — skipping");
    }
  }

  return accounts;
}

// ============================================
// PICKER
// ============================================

async function pickAccount(
  accounts: AccessibleAccount[],
  presetCustomerId?: string,
): Promise<AccessibleAccount> {
  if (presetCustomerId) {
    const match = accounts.find((a) => a.id === presetCustomerId);
    if (!match) {
      throw new Error(
        `--customer-id ${presetCustomerId} was not found among ${accounts.length} accessible account(s). ` +
          `Remove the flag to pick interactively.`,
      );
    }
    return match;
  }

  if (accounts.length === 1) {
    process.stderr.write(
      `\nOnly one account accessible: ${accounts[0].name} (${accounts[0].id}). Auto-selecting.\n`,
    );
    return accounts[0];
  }

  // Sort: non-manager accounts grouped under their MCC parent, MCCs first
  const sorted = [...accounts].sort((a, b) => {
    const aKey = a.parentMccId ? `${a.parentMccId}:1:${a.name}` : `${a.id}:0:${a.name}`;
    const bKey = b.parentMccId ? `${b.parentMccId}:1:${b.name}` : `${b.id}:0:${b.name}`;
    return aKey.localeCompare(bKey);
  });

  const choices = sorted.map((acct) => {
    const prefix = acct.parentMccId ? "    ↳ " : acct.isManager ? "📁 " : "• ";
    const mccSuffix = acct.parentMccId ? "" : acct.isManager ? " (MCC)" : "";
    return {
      title: `${prefix}${acct.name} — ${acct.id}${mccSuffix}`,
      value: acct,
      disabled: acct.isManager && accounts.some((a) => a.parentMccId === acct.id)
        ? false // MCC is still selectable in case user actually wants it
        : false,
    };
  });

  const response = await prompts(
    {
      type: "select",
      name: "account",
      message: "Which Google Ads account should Claude use?",
      choices,
      initial: 0,
    },
    {
      onCancel: () => {
        throw new Error("Cancelled by user");
      },
    },
  );

  if (!response.account) {
    throw new Error("No account selected");
  }
  return response.account as AccessibleAccount;
}

// ============================================
// MAIN
// ============================================

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  // Resolve OAuth client creds (env override > embedded)
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim() || EMBEDDED_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() || EMBEDDED_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || EMBEDDED_DEVELOPER_TOKEN;

  if (!clientId || !clientSecret || !developerToken) {
    process.stderr.write(
      "This build of mcp-google-ads was published without embedded OAuth credentials.\n" +
        "Set GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_DEVELOPER_TOKEN\n" +
        "in your environment before running this command.\n",
    );
    process.exit(2);
  }

  const port = await findFreeLoopbackPort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const state = randomState();
  const authUrl = buildAuthUrl(clientId, redirectUri, state);

  process.stderr.write("\n=== mcp-google-ads authentication ===\n");

  const { code } = await waitForAuthorizationCode(port, state, authUrl);
  process.stderr.write("Authorization code received. Exchanging for tokens...\n");

  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
  if (!tokens.refresh_token) {
    throw new GoogleAdsAuthError(
      "Google did not return a refresh token. This can happen if you previously granted consent " +
        "to this app — revoke access at https://myaccount.google.com/permissions and try again.",
    );
  }
  process.stderr.write("Tokens received. Fetching accessible Google Ads accounts...\n");

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const accounts = await enumerateAccounts(api, tokens.refresh_token);
  const chosen = await pickAccount(accounts, args.customerId);

  const stored: StoredCredentials = {
    version: CREDENTIALS_FILE_VERSION,
    refresh_token: tokens.refresh_token,
    customer_id: chosen.id,
    customer_name: chosen.name,
    mcc_customer_id: chosen.parentMccId ?? null,
    obtained_at: new Date().toISOString(),
    scopes: [OAUTH_SCOPE],
  };
  writeStoredCredentials(stored);

  process.stderr.write(
    [
      "",
      "✅ Done.",
      "",
      `  Account:    ${chosen.name} (${chosen.id})`,
      chosen.parentMccId ? `  Via MCC:    ${chosen.parentMccName} (${chosen.parentMccId})` : `  (Direct access — no MCC)`,
      `  Saved to:   ${credentialsFilePath}`,
      "",
      "Next step: fully quit Claude Desktop (Cmd+Q / File > Exit) and reopen it.",
      "Then try: \"List campaigns in Google Ads\"",
      "",
    ].join("\n"),
  );
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  // globalThis.crypto is available on Node 18+ without import
  (globalThis.crypto as Crypto).getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================
// ENTRY
// ============================================

// Only run when invoked as a script (not imported as a module from tests)
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/auth-cli.js") ||
  process.argv[1]?.endsWith("\\auth-cli.js");

if (isMain) {
  run().catch((err) => {
    const classified = classifyError(err);
    process.stderr.write(`\n❌ ${classified.message}\n`);
    process.exit(1);
  });
}
