import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installIntoConfig, run } from "./install-cli.js";

// Test the config mutation function directly (no spawn, no stdin).
// The CLI wrapper just calls this with resolved paths.
describe("installIntoConfig — Claude Desktop config merging", () => {
  let tmp: string;
  let cfg: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-ga-install-"));
    cfg = join(tmp, "claude_desktop_config.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a fresh config file when none exists", () => {
    installIntoConfig({ configPath: cfg });
    const parsed = JSON.parse(readFileSync(cfg, "utf8"));
    expect(parsed.mcpServers["google-ads"].command).toBe("npx");
    expect(parsed.mcpServers["google-ads"].args).toContain("mcp-google-ads@latest");
  });

  it("creates missing parent directory when the config path is nested", () => {
    const nested = join(tmp, "Application Support", "Claude", "claude_desktop_config.json");
    installIntoConfig({ configPath: nested });
    expect(existsSync(nested)).toBe(true);
  });

  it("preserves unrelated top-level keys", () => {
    writeFileSync(cfg, JSON.stringify({ theme: "dark", unrelated: { foo: 1 } }));
    installIntoConfig({ configPath: cfg });
    const parsed = JSON.parse(readFileSync(cfg, "utf8"));
    expect(parsed.theme).toBe("dark");
    expect(parsed.unrelated).toEqual({ foo: 1 });
    expect(parsed.mcpServers["google-ads"]).toBeDefined();
  });

  it("preserves sibling mcpServers entries (does not clobber other MCPs)", () => {
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          "gsc": { command: "npx", args: ["mcp-google-gsc"] },
          "ga4": { command: "npx", args: ["mcp-ga4"] },
        },
      }),
    );
    installIntoConfig({ configPath: cfg });
    const parsed = JSON.parse(readFileSync(cfg, "utf8"));
    expect(parsed.mcpServers["gsc"]).toBeDefined();
    expect(parsed.mcpServers["ga4"]).toBeDefined();
    expect(parsed.mcpServers["google-ads"]).toBeDefined();
    expect(Object.keys(parsed.mcpServers).sort()).toEqual(["ga4", "google-ads", "gsc"]);
  });

  it("is idempotent — running twice yields identical content", () => {
    installIntoConfig({ configPath: cfg });
    const first = readFileSync(cfg, "utf8");
    installIntoConfig({ configPath: cfg });
    const second = readFileSync(cfg, "utf8");
    expect(second).toBe(first);
  });

  it("updates an existing google-ads entry rather than duplicating", () => {
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          "google-ads": { command: "node", args: ["/old/path/index.js"] },
        },
      }),
    );
    installIntoConfig({ configPath: cfg });
    const parsed = JSON.parse(readFileSync(cfg, "utf8"));
    expect(parsed.mcpServers["google-ads"].command).toBe("npx");
    // Only one google-ads key (JSON guarantees object key uniqueness anyway,
    // but confirm we didn't corrupt the structure)
    expect(Object.keys(parsed.mcpServers).filter((k) => k === "google-ads")).toHaveLength(1);
  });

  it("refuses to clobber a file that is not valid JSON", () => {
    writeFileSync(cfg, "{ not: valid json,, }");
    expect(() => installIntoConfig({ configPath: cfg })).toThrow(/not valid JSON/i);
    // Original content preserved
    expect(readFileSync(cfg, "utf8")).toBe("{ not: valid json,, }");
  });

  it("writes pretty-printed output (2-space indent) so humans can read it", () => {
    installIntoConfig({ configPath: cfg });
    const raw = readFileSync(cfg, "utf8");
    expect(raw).toContain('\n  "mcpServers"');
    expect(raw).toContain('\n    "google-ads"');
  });

  it("accepts a --customer-id arg and bakes it into args", () => {
    installIntoConfig({ configPath: cfg, customerId: "111-222-3333" });
    const parsed = JSON.parse(readFileSync(cfg, "utf8"));
    const env = parsed.mcpServers["google-ads"].env || {};
    expect(env.GOOGLE_ADS_CUSTOMER_ID).toBe("1112223333");
  });

  // The entry's env is where a Claude Desktop user keeps the developer token,
  // so re-running the installer must not drop it.
  it("keeps the env of an existing google-ads entry", () => {
    const env = { GOOGLE_ADS_DEVELOPER_TOKEN: "fake-developer-token", GOOGLE_ADS_MCP_WRITE: "true" };
    writeFileSync(cfg, JSON.stringify({ mcpServers: { "google-ads": { command: "node", args: ["/old/index.js"], env } } }));
    installIntoConfig({ configPath: cfg });
    expect(JSON.parse(readFileSync(cfg, "utf8")).mcpServers["google-ads"]).toEqual({ command: "npx", args: ["-y", "mcp-google-ads@latest"], env });
    installIntoConfig({ configPath: cfg, customerId: "111-222-3333" });
    expect(JSON.parse(readFileSync(cfg, "utf8")).mcpServers["google-ads"].env).toEqual({ ...env, GOOGLE_ADS_CUSTOMER_ID: "1112223333" });
  });

  it.each([["a string", "oops"], ["a list", ["oops"]], ["null", null]])("an existing env that is %s is replaced, not spread", (_name, env) => {
    writeFileSync(cfg, JSON.stringify({ mcpServers: { "google-ads": { command: "npx", env } } }));
    installIntoConfig({ configPath: cfg });
    expect(JSON.parse(readFileSync(cfg, "utf8")).mcpServers["google-ads"].env).toBeUndefined();
  });

  describe("next steps", () => {
    async function printed(): Promise<string> {
      let out = "";
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        out += String(chunk);
        return true;
      });
      try {
        await run(["--config", cfg]);
      } finally {
        spy.mockRestore();
      }
      return out;
    }

    it("ask for the developer token when the entry has none", async () => {
      const out = await printed();
      expect(out).toMatch(/GOOGLE_ADS_DEVELOPER_TOKEN.*mcpServers\.google-ads\.env/s);
      expect(out).toContain(cfg);
    });

    it("do not, when it is already there, and never print it", async () => {
      writeFileSync(cfg, JSON.stringify({ mcpServers: { "google-ads": { env: { GOOGLE_ADS_DEVELOPER_TOKEN: "fake-developer-token" } } } }));
      const out = await printed();
      expect(out).not.toMatch(/GOOGLE_ADS_DEVELOPER_TOKEN|fake-developer-token/);
      expect(out).toMatch(/Reopen Claude Desktop/);
    });
  });
});
