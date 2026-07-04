// ============================================
// Tests for the standalone OAuth refresh-token helper (PKCE, S256).
// ============================================
// These exercise ONLY the pure, offline pieces of get-refresh-token.cjs:
//   - PKCE code_verifier / code_challenge generation (RFC 7636)
//   - the authorization-URL builder
//   - the token-exchange param builder (must carry code_verifier)
//   - scope loading from config.json (oauth.scope) — shared with runtime
//   - env-var validation (missing CLIENT_ID/SECRET fails clearly)
//
// The live browser round-trip (loopback server + fetch to Google) is NOT
// tested here — it is manual, out of scope, and guarded behind a main check
// so importing the module does not start a server.

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = require("./get-refresh-token.cjs");

describe("PKCE (RFC 7636)", () => {
  it("code_verifier is 43–128 chars of the unreserved set", () => {
    for (let i = 0; i < 50; i++) {
      const v = helper.generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      // unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("code_challenge == base64url(sha256(verifier)), no padding — known RFC 7636 vector", () => {
    // RFC 7636 Appendix B test vector.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(helper.computeCodeChallenge(verifier)).toBe(expectedChallenge);
  });

  it("code_challenge has no '=' padding and uses url-safe alphabet", () => {
    const v = helper.generateCodeVerifier();
    const c = helper.computeCodeChallenge(v);
    expect(c).not.toContain("=");
    expect(c).not.toContain("+");
    expect(c).not.toContain("/");
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe("authorization-URL builder", () => {
  const opts = {
    clientId: "test-client-id.apps.googleusercontent.com",
    redirectUri: "http://localhost:8123/callback",
    scope: "https://www.googleapis.com/auth/adwords",
    state: "abc123state",
    codeChallenge: "CHALLENGE_VALUE",
  };

  it("targets Google's auth endpoint", () => {
    const url = new URL(helper.buildAuthUrl(opts));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("carries PKCE S256 params", () => {
    const url = new URL(helper.buildAuthUrl(opts));
    expect(url.searchParams.get("code_challenge")).toBe("CHALLENGE_VALUE");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("carries access_type=offline and prompt=consent (required for refresh token)", () => {
    const url = new URL(helper.buildAuthUrl(opts));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("carries the exact client_id, loopback redirect_uri, and state", () => {
    const url = new URL(helper.buildAuthUrl(opts));
    expect(url.searchParams.get("client_id")).toBe(opts.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(opts.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe(opts.state);
  });

  it("carries the scope it was given (not a hardcoded one)", () => {
    const url = new URL(helper.buildAuthUrl({ ...opts, scope: "SCOPE_FROM_CONFIG" }));
    expect(url.searchParams.get("scope")).toBe("SCOPE_FROM_CONFIG");
  });
});

describe("token-exchange param builder (PKCE)", () => {
  it("includes code_verifier on the token exchange", () => {
    const params = helper.buildTokenExchangeParams({
      code: "AUTH_CODE",
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "http://localhost:8123/callback",
      codeVerifier: "THE_VERIFIER",
    });
    const p = new URLSearchParams(params);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("AUTH_CODE");
    expect(p.get("code_verifier")).toBe("THE_VERIFIER");
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("client_secret")).toBe("secret");
    expect(p.get("redirect_uri")).toBe("http://localhost:8123/callback");
  });
});

describe("scope loading from config.json (oauth.scope)", () => {
  it("reads oauth.scope from a config object", () => {
    const cfg = { oauth: { scope: "https://www.googleapis.com/auth/adwords" } };
    expect(helper.resolveScopeFromConfig(cfg)).toBe(
      "https://www.googleapis.com/auth/adwords",
    );
  });

  it("normalizes comma- or space-separated scope lists to space-separated", () => {
    expect(helper.resolveScopeFromConfig({ oauth: { scope: "a,b,c" } })).toBe("a b c");
    expect(helper.resolveScopeFromConfig({ oauth: { scope: "a  b\nc" } })).toBe("a b c");
  });

  it("changing config.oauth.scope changes the resolved scope (helper + runtime share it)", () => {
    const before = helper.resolveScopeFromConfig({ oauth: { scope: "scope/one" } });
    const after = helper.resolveScopeFromConfig({ oauth: { scope: "scope/two" } });
    expect(before).toBe("scope/one");
    expect(after).toBe("scope/two");
    expect(before).not.toBe(after);
  });

  it("loadScopeFromConfigFile reads oauth.scope from config.example.json (committed template)", () => {
    // config.json is gitignored/per-user; config.example.json is the committed
    // template and MUST carry the same oauth.scope shape.
    const scope = helper.loadScopeFromConfigFile(
      path.join(__dirname, "config.example.json"),
    );
    expect(scope).toContain("googleapis.com/auth/adwords");
  });
});

describe("env-var validation", () => {
  it("requireClientCreds throws a clear error when CLIENT_ID missing", () => {
    expect(() =>
      helper.requireClientCreds({ GOOGLE_ADS_CLIENT_SECRET: "s" }),
    ).toThrow(/GOOGLE_ADS_CLIENT_ID/);
  });

  it("requireClientCreds throws a clear error when CLIENT_SECRET missing", () => {
    expect(() =>
      helper.requireClientCreds({ GOOGLE_ADS_CLIENT_ID: "c" }),
    ).toThrow(/GOOGLE_ADS_CLIENT_SECRET/);
  });

  it("requireClientCreds returns both when present", () => {
    const creds = helper.requireClientCreds({
      GOOGLE_ADS_CLIENT_ID: "c",
      GOOGLE_ADS_CLIENT_SECRET: "s",
    });
    expect(creds).toEqual({ clientId: "c", clientSecret: "s" });
  });
});
