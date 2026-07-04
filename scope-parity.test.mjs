// ============================================
// Helper <-> runtime scope-resolution PARITY (no fallback asymmetry).
// ============================================
// The standalone helper (get-refresh-token.cjs) and the runtime
// (src/oauthScope.ts via dist) MUST resolve the OAuth scope identically for
// every filesystem state, or a token can be minted against one scope while the
// server requests another. In particular NEITHER may fall back to
// config.example.json — a committed, editable file. Both resolve:
//     config.json present  -> its oauth.scope
//     config.json absent    -> the committed default (example IGNORED)
//
// The helper exposes resolveScopeFromDir(dir): resolve exactly as the live
// onboarding does, but against an arbitrary directory so we can stage configs.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = require("./get-refresh-token.cjs");

let runtimeLoad; // loadOAuthScopeFromFile
let DEFAULT;
beforeAll(async () => {
  const mod = await import("./dist/oauthScope.js");
  runtimeLoad = mod.loadOAuthScopeFromFile;
  DEFAULT = mod.DEFAULT_ADWORDS_SCOPE;
});

function stage(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "scope-parity-"));
  for (const [name, obj] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), JSON.stringify(obj));
  }
  return dir;
}

// The runtime only ever reads config.json (never example). Mirror that exactly.
function runtimeResolve(dir) {
  return runtimeLoad(path.join(dir, "config.json"));
}
function helperResolve(dir) {
  return helper.resolveScopeFromDir(dir);
}

describe("helper and runtime resolve scope IDENTICALLY", () => {
  it("config.json present -> both use its oauth.scope", () => {
    const dir = stage({ "config.json": { oauth: { scope: "https://scope/present" } } });
    try {
      expect(helperResolve(dir)).toBe("https://scope/present");
      expect(runtimeResolve(dir)).toBe("https://scope/present");
      expect(helperResolve(dir)).toBe(runtimeResolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config.json absent -> BOTH fall back to the default (example never read)", () => {
    const dir = stage({}); // no config.json, no config.example.json
    try {
      expect(helperResolve(dir)).toBe(DEFAULT);
      expect(runtimeResolve(dir)).toBe(DEFAULT);
      expect(helperResolve(dir)).toBe(runtimeResolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("customized config.example.json present but NO config.json -> BOTH ignore example, use default", () => {
    // This is the asymmetry that must be fixed: the helper must NOT read the
    // example scope here, because the runtime never does.
    const dir = stage({
      "config.example.json": { oauth: { scope: "https://EXAMPLE/edited-by-mistake" } },
    });
    try {
      expect(helperResolve(dir)).toBe(DEFAULT);
      expect(runtimeResolve(dir)).toBe(DEFAULT);
      expect(helperResolve(dir)).toBe(runtimeResolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("config.json wins even when a different example is also present", () => {
    const dir = stage({
      "config.json": { oauth: { scope: "https://real/config" } },
      "config.example.json": { oauth: { scope: "https://EXAMPLE/other" } },
    });
    try {
      expect(helperResolve(dir)).toBe("https://real/config");
      expect(runtimeResolve(dir)).toBe("https://real/config");
      expect(helperResolve(dir)).toBe(runtimeResolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
