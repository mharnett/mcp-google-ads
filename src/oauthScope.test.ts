// ============================================
// Runtime OAuth-scope resolution tests.
// ============================================
// The scope requested at auth time must come from config.json's oauth.scope
// (mirrors mcp-linkedin-ads) so the standalone get-refresh-token.cjs helper and
// the runtime auth-cli never drift. config.json is gitignored/per-user, so a
// committed default is the fallback when no config file / oauth.scope is present.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DEFAULT_ADWORDS_SCOPE,
  resolveOAuthScope,
  loadOAuthScopeFromFile,
} from "./oauthScope.js";

describe("resolveOAuthScope", () => {
  it("returns oauth.scope from the config object when present", () => {
    expect(resolveOAuthScope({ oauth: { scope: "scope/from/config" } })).toBe(
      "scope/from/config",
    );
  });

  it("normalizes comma/space/newline-separated lists to space-separated", () => {
    expect(resolveOAuthScope({ oauth: { scope: "a, b ,c" } })).toBe("a b c");
  });

  it("falls back to the committed default when oauth.scope is absent", () => {
    expect(resolveOAuthScope({})).toBe(DEFAULT_ADWORDS_SCOPE);
    expect(resolveOAuthScope(null)).toBe(DEFAULT_ADWORDS_SCOPE);
  });

  it("the committed default is the minimum adwords scope (nothing extra)", () => {
    expect(DEFAULT_ADWORDS_SCOPE).toBe("https://www.googleapis.com/auth/adwords");
  });

  it("config value wins over the default (helper + runtime share config.json)", () => {
    const fromConfig = resolveOAuthScope({ oauth: { scope: "override/scope" } });
    expect(fromConfig).toBe("override/scope");
    expect(fromConfig).not.toBe(DEFAULT_ADWORDS_SCOPE);
  });
});

describe("loadOAuthScopeFromFile", () => {
  it("reads oauth.scope from a config file on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "ga-scope-"));
    try {
      const p = join(dir, "config.json");
      writeFileSync(p, JSON.stringify({ oauth: { scope: "disk/scope" } }));
      expect(loadOAuthScopeFromFile(p)).toBe("disk/scope");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the default when the file is missing (gitignored config.json)", () => {
    expect(loadOAuthScopeFromFile(join(tmpdir(), "does-not-exist-xyz.json"))).toBe(
      DEFAULT_ADWORDS_SCOPE,
    );
  });
});
