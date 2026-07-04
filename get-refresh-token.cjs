#!/usr/bin/env node
/**
 * Standalone OAuth2 refresh-token helper for mcp-google-ads.
 *
 * Publishable: reads everything from env + this repo's config.json. It never
 * reads any file under a user's home directory and never touches a shared
 * OAuth-client keyfile. A user brings THEIR OWN Google OAuth client
 * (client_id + client_secret) created in their own GCP project.
 *
 * Security hardening: uses PKCE (RFC 7636, S256) on top of Google's
 * installed-app loopback flow.
 *
 * === Prerequisites ===
 *   1. Google Cloud Console → APIs & Services → Credentials → create an
 *      OAuth 2.0 Client ID of type "Desktop app". Enable the Google Ads API.
 *   2. export GOOGLE_ADS_CLIENT_ID=...  GOOGLE_ADS_CLIENT_SECRET=...
 *   3. node get-refresh-token.cjs
 *   4. Approve in the browser (as the Google account that owns the Ads data).
 *   5. Copy the printed GOOGLE_ADS_REFRESH_TOKEN=... into your environment.
 *
 * The OAuth scope requested is read from this repo's config.json (oauth.scope),
 * falling back to config.example.json / the adwords default — the SAME source
 * the MCP runtime uses (src/oauthScope.ts), so helper and runtime never drift.
 *
 * Note: GOOGLE_ADS_DEVELOPER_TOKEN is a separate Google Ads API credential, NOT
 * an OAuth scope. It is not requested here.
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const { readFileSync, existsSync } = require("fs");
const { join } = require("path");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────────

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 43–128 chars of the unreserved set (RFC 7636 §4.1). 32 random bytes → 43 chars base64url. */
function generateCodeVerifier() {
  return base64url(crypto.randomBytes(32));
}

/** code_challenge = base64url(SHA256(code_verifier)), no padding (S256). */
function computeCodeChallenge(verifier) {
  return base64url(crypto.createHash("sha256").update(verifier, "ascii").digest());
}

// ── Scope resolution (shared contract with src/oauthScope.ts) ────────────────

function normalizeScope(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

/** Resolve oauth.scope from a parsed config object; falls back to the adwords default. */
function resolveScopeFromConfig(config) {
  const scope =
    config && typeof config === "object" && config.oauth && typeof config.oauth.scope === "string"
      ? config.oauth.scope
      : "";
  return normalizeScope(scope) || DEFAULT_ADWORDS_SCOPE;
}

/** Read oauth.scope from a config file on disk; falls back to the adwords default. */
function loadScopeFromConfigFile(filePath) {
  if (!existsSync(filePath)) return DEFAULT_ADWORDS_SCOPE;
  try {
    return resolveScopeFromConfig(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return DEFAULT_ADWORDS_SCOPE;
  }
}

/**
 * Resolve the scope from config.json (per-user, gitignored) if present,
 * otherwise config.example.json (committed template), otherwise the default.
 */
function loadScope() {
  const local = join(__dirname, "config.json");
  if (existsSync(local)) return loadScopeFromConfigFile(local);
  return loadScopeFromConfigFile(join(__dirname, "config.example.json"));
}

// ── Env validation ───────────────────────────────────────────────────────────

/** Require both client creds from an env-like object; throw a clear error otherwise. */
function requireClientCreds(env) {
  const clientId = (env.GOOGLE_ADS_CLIENT_ID || "").trim();
  const clientSecret = (env.GOOGLE_ADS_CLIENT_SECRET || "").trim();
  const missing = [];
  if (!clientId) missing.push("GOOGLE_ADS_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_ADS_CLIENT_SECRET");
  if (missing.length) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}.\n` +
        `Create a "Desktop app" OAuth client at https://console.cloud.google.com/apis/credentials, ` +
        `then export GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET.`,
    );
  }
  return { clientId, clientSecret };
}

// ── URL / param builders (pure) ──────────────────────────────────────────────

function buildAuthUrl({ clientId, redirectUri, scope, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline", // REQUIRED for Google to return a refresh_token
    prompt: "consent", // force a refresh_token even on re-consent
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function buildTokenExchangeParams({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier, // PKCE proof — sent on exchange
  }).toString();
}

// ── Live flow (guarded behind main; not exercised by unit tests) ─────────────

async function run() {
  const { clientId, clientSecret } = requireClientCreds(process.env);
  const scope = loadScope();
  const port = Number(process.env.OAUTH_CALLBACK_PORT || 8123);
  const redirectUri = `http://localhost:${port}/callback`;

  const state = crypto.randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const authUrl = buildAuthUrl({ clientId, redirectUri, scope, state, codeChallenge });

  const code = await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, redirectUri);
      const err = url.searchParams.get("error");
      const returnedCode = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Authorization denied</h1><p>You can close this tab.</p>");
        done(() => {
          server.close();
          reject(new Error(`OAuth denied: ${err}`));
        });
        return;
      }
      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>State mismatch</h1><p>Possible CSRF. Re-run the command.</p>");
        done(() => {
          server.close();
          reject(new Error("OAuth state mismatch -- possible CSRF"));
        });
        return;
      }
      if (!returnedCode) {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Signed in</h1><p>You can close this tab and return to the terminal.</p>");
      done(() => {
        setTimeout(() => server.close(), 200);
        resolve(returnedCode);
      });
    });
    server.on("error", (e) => done(() => reject(new Error(`Loopback server failed: ${e.message}`))));
    server.listen(port, "127.0.0.1", async () => {
      process.stderr.write(`\nCallback server listening on ${redirectUri}\n`);
      process.stderr.write("Opening your browser to sign in with Google...\n");
      process.stderr.write(`If it doesn't open, visit:\n  ${authUrl}\n\n`);
      try {
        const openMod = await import("open");
        await (openMod.default || openMod)(authUrl);
      } catch {
        process.stderr.write("Could not open a browser automatically; paste the URL above.\n");
      }
    });
    setTimeout(
      () =>
        done(() => {
          server.close();
          reject(new Error("Timed out waiting for OAuth callback (5 minutes)."));
        }),
      5 * 60 * 1000,
    );
  });

  process.stderr.write("Authorization code received. Exchanging for tokens...\n");
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildTokenExchangeParams({ code, clientId, clientSecret, redirectUri, codeVerifier }),
  });
  const data = await resp.json();

  if (!data.refresh_token) {
    process.stderr.write(
      "No refresh_token returned. If you previously granted consent, revoke it at " +
        "https://myaccount.google.com/permissions and re-run.\n",
    );
    // Do not print the raw token response (may contain an access_token).
    process.exit(1);
  }

  // The refresh token is the intended output. It goes to STDOUT so it can be
  // captured; nothing else sensitive is printed. Do NOT run this with stdout
  // redirected to a shared log.
  process.stdout.write(`GOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}\n`);
  process.stderr.write("\nDone. Set the line above in your environment.\n");
  process.exit(0);
}

module.exports = {
  base64url,
  generateCodeVerifier,
  computeCodeChallenge,
  normalizeScope,
  resolveScopeFromConfig,
  loadScopeFromConfigFile,
  loadScope,
  requireClientCreds,
  buildAuthUrl,
  buildTokenExchangeParams,
  AUTH_URL,
  TOKEN_URL,
  DEFAULT_ADWORDS_SCOPE,
};

if (require.main === module) {
  run().catch((err) => {
    process.stderr.write(`\nError: ${err.message}\n`);
    process.exit(1);
  });
}
