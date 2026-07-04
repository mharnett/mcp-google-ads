// ============================================
// Runtime PKCE (RFC 7636) + canonical loopback redirect form.
// ============================================
// The `npx mcp-google-ads-auth` onboarding path (src/auth-cli.ts) is the PRIMARY
// onboarding path and the template for four more Google MCPs, so it must use the
// SAME S256 PKCE as the standalone helper and the SAME loopback redirect form.

import { describe, it, expect } from "vitest";
import {
  generateCodeVerifier,
  computeCodeChallenge,
  buildLoopbackRedirectUri,
  LOOPBACK_HOST,
  LOOPBACK_PATH,
} from "./pkce.js";

describe("runtime PKCE (RFC 7636)", () => {
  it("code_verifier is 43–128 chars of the unreserved set", () => {
    for (let i = 0; i < 30; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("code_challenge matches the RFC 7636 Appendix B vector (S256)", () => {
    expect(computeCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("code_challenge is url-safe with no padding", () => {
    const c = computeCodeChallenge(generateCodeVerifier());
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(c).not.toContain("=");
  });
});

describe("canonical loopback redirect form (shared with the helper)", () => {
  it("uses host `localhost` and path `/callback`", () => {
    expect(LOOPBACK_HOST).toBe("localhost");
    expect(LOOPBACK_PATH).toBe("/callback");
  });

  it("builds http://localhost:<port>/callback", () => {
    expect(buildLoopbackRedirectUri(8123)).toBe("http://localhost:8123/callback");
    expect(buildLoopbackRedirectUri(8090)).toBe("http://localhost:8090/callback");
  });
});
