// ============================================
// PKCE (RFC 7636, S256) + canonical loopback redirect form.
// ============================================
// Shared by the runtime onboarding path (src/auth-cli.ts). The standalone
// get-refresh-token.cjs helper carries a byte-identical copy of this logic
// (it must ship self-contained, dependency-free), and a cross-drift test
// (src/pkce.parity.test.mjs) asserts the two agree.

import { createHash, randomBytes } from "crypto";

/** base64url with no padding (RFC 4648 §5). */
export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 43–128 chars of the unreserved set. 32 random bytes -> 43 base64url chars. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** code_challenge = base64url(SHA256(code_verifier)), S256. */
export function computeCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

// Canonical loopback redirect form shared by BOTH onboarding paths. Google
// matches loopback redirect URIs on scheme + host + path and IGNORES the port,
// so onboarders register ONE pattern: http://localhost/callback
export const LOOPBACK_HOST = "localhost";
export const LOOPBACK_PATH = "/callback";
export function buildLoopbackRedirectUri(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}${LOOPBACK_PATH}`;
}
