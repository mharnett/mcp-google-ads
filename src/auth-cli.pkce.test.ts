// ============================================
// auth-cli (npx mcp-google-ads-auth) PKCE wiring.
// ============================================
// The primary onboarding path must send a PKCE S256 challenge on the auth URL
// and the matching code_verifier on the token exchange, using the canonical
// loopback redirect form.

import { describe, it, expect } from "vitest";
import {
  buildAuthUrl,
  buildTokenExchangeBody,
  OAUTH_SCOPE,
} from "./auth-cli.js";
import { buildLoopbackRedirectUri } from "./pkce.js";

const redirectUri = buildLoopbackRedirectUri(8123);

describe("auth-cli buildAuthUrl carries PKCE + canonical redirect", () => {
  const url = new URL(
    buildAuthUrl("cid.apps.googleusercontent.com", redirectUri, "state123", "CHAL"),
  );

  it("targets Google's auth endpoint", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("sends code_challenge + code_challenge_method=S256", () => {
    expect(url.searchParams.get("code_challenge")).toBe("CHAL");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("keeps access_type=offline + prompt=consent", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("uses the canonical loopback redirect form (http://localhost:<port>/callback)", () => {
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8123/callback");
  });

  it("requests the config-resolved scope", () => {
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPE);
  });
});

describe("auth-cli token exchange carries code_verifier (PKCE) + client_secret", () => {
  it("body has grant_type, code, code_verifier, client_secret, redirect_uri", () => {
    const body = buildTokenExchangeBody({
      code: "AUTH_CODE",
      clientId: "cid",
      clientSecret: "secret",
      redirectUri,
      codeVerifier: "VERIFIER",
    });
    const p = new URLSearchParams(body);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("AUTH_CODE");
    expect(p.get("code_verifier")).toBe("VERIFIER"); // PKCE proof
    expect(p.get("client_secret")).toBe("secret"); // confidential client — additive
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("redirect_uri")).toBe(redirectUri);
  });
});
