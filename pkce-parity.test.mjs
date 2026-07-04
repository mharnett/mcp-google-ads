// ============================================
// PKCE parity: standalone helper <-> runtime must not drift.
// ============================================
// get-refresh-token.cjs ships self-contained (dependency-free) so it carries its
// OWN copy of the PKCE + redirect-form logic. src/pkce.ts is the runtime copy.
// This test asserts the two produce identical output, so a change to one that
// isn't mirrored in the other fails CI.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = require("./get-refresh-token.cjs");

let rt;
beforeAll(async () => {
  rt = await import("./dist/pkce.js");
});

describe("helper and runtime PKCE agree", () => {
  it("computeCodeChallenge is identical for shared inputs (incl. RFC vector)", () => {
    const inputs = [
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      "abc123",
      helper.generateCodeVerifier(),
    ];
    for (const v of inputs) {
      expect(helper.computeCodeChallenge(v)).toBe(rt.computeCodeChallenge(v));
    }
  });

  it("base64url encoding is identical", () => {
    const buf = Buffer.from([251, 239, 190, 0, 1, 2, 3, 255]);
    expect(helper.base64url(buf)).toBe(rt.base64url(buf));
  });

  it("loopback redirect form is identical", () => {
    for (const port of [8123, 8090, 65535]) {
      expect(helper.buildLoopbackRedirectUri(port)).toBe(rt.buildLoopbackRedirectUri(port));
    }
    expect(helper.LOOPBACK_HOST).toBe(rt.LOOPBACK_HOST);
    expect(helper.LOOPBACK_PATH).toBe(rt.LOOPBACK_PATH);
  });

  it("generated verifiers from both satisfy the RFC length/charset invariant", () => {
    for (const gen of [helper.generateCodeVerifier, rt.generateCodeVerifier]) {
      const v = gen();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });
});
