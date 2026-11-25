import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor, type DoctorCheck } from "./doctor-cli.js";

// Doctor runs a fixed sequence of checks against local state and reports
// pass/fail per check so the user knows exactly what's wrong without reading
// stack traces. Tests cover: result shape, each check's pass and fail paths,
// and that failures don't abort earlier passes (collect-all, not fail-fast).

describe("runDoctor — diagnostic check sequence", () => {
  let tmp: string;
  let cfgPath: string;
  let credsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mcp-ga-doctor-"));
    cfgPath = join(tmp, "claude_desktop_config.json");
    credsPath = join(tmp, "credentials.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function findCheck(checks: DoctorCheck[], name: string): DoctorCheck {
    const c = checks.find((x) => x.name === name);
    if (!c) throw new Error(`expected check named ${name}; got ${checks.map((x) => x.name).join(", ")}`);
    return c;
  }

  it("returns an array of checks with {name, status, detail}", async () => {
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    expect(Array.isArray(result)).toBe(true);
    for (const c of result) {
      expect(typeof c.name).toBe("string");
      expect(["pass", "fail", "warn"]).toContain(c.status);
      expect(typeof c.detail).toBe("string");
    }
  });

  it("flags missing Claude Desktop config as a fail", async () => {
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const check = findCheck(result, "claude_desktop_config exists");
    expect(check.status).toBe("fail");
    expect(check.detail).toContain(cfgPath);
  });

  it("flags unparseable config as a fail (distinct from missing)", async () => {
    writeFileSync(cfgPath, "{ nope");
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const check = findCheck(result, "claude_desktop_config is valid JSON");
    expect(check.status).toBe("fail");
  });

  it("flags missing google-ads entry under mcpServers as a fail", async () => {
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: { gsc: { command: "npx" } } }));
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const check = findCheck(result, "google-ads registered in claude_desktop_config");
    expect(check.status).toBe("fail");
  });

  it("passes google-ads registration check when entry is present", async () => {
    writeFileSync(
      cfgPath,
      JSON.stringify({ mcpServers: { "google-ads": { command: "npx", args: ["mcp-google-ads@latest"] } } }),
    );
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const check = findCheck(result, "google-ads registered in claude_desktop_config");
    expect(check.status).toBe("pass");
  });

  it("flags missing credentials file as a fail with actionable next step", async () => {
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const check = findCheck(result, "credentials file exists");
    expect(check.status).toBe("fail");
    expect(check.detail.toLowerCase()).toMatch(/mcp-google-ads-auth/);
  });

  it("warns when customer_id looks like a manager (MCC) account", async () => {
    // Our registry uses mcc_customer_id to mark MCCs. Here we simulate a
    // credentials file where customer_id is the MCC and no MCC parent is set.
    writeFileSync(
      credsPath,
      JSON.stringify({
        version: 1,
        refresh_token: "1//xxxx",
        customer_id: "5556667777",
        customer_name: "Drak Marketing MCC",
        mcc_customer_id: "5556667777",
      }),
    );
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const check = findCheck(result, "customer_id is a leaf account, not an MCC");
    expect(check.status).toBe("warn");
  });

  it("passes all credential checks when credentials look correct", async () => {
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: { "google-ads": { command: "npx" } } }));
    writeFileSync(
      credsPath,
      JSON.stringify({
        version: 1,
        refresh_token: "1//xxxx",
        customer_id: "1112223333",
        customer_name: "Acme Corp",
        mcc_customer_id: "1234567890",
      }),
    );
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    expect(findCheck(result, "credentials file exists").status).toBe("pass");
    expect(findCheck(result, "customer_id is a leaf account, not an MCC").status).toBe("pass");
  });

  it("does not short-circuit — all checks run even when earlier ones fail", async () => {
    const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath });
    const names = result.map((c) => c.name);
    expect(names).toContain("claude_desktop_config exists");
    expect(names).toContain("credentials file exists");
    expect(names).toContain("node version >= 18");
  });

  it("passes the installed-is-latest check when versions match", async () => {
    const result = await runDoctor({
      configPath: cfgPath,
      credentialsPath: credsPath,
      installedVersion: "1.4.2",
      fetchLatestVersion: async () => "1.4.2",
    });
    const check = findCheck(result, "installed version is up to date");
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("1.4.2");
  });

  it("warns with upgrade instructions when a newer version exists on npm", async () => {
    const result = await runDoctor({
      configPath: cfgPath,
      credentialsPath: credsPath,
      installedVersion: "1.3.0",
      fetchLatestVersion: async () => "1.4.2",
    });
    const check = findCheck(result, "installed version is up to date");
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("1.3.0");
    expect(check.detail).toContain("1.4.2");
    expect(check.detail.toLowerCase()).toContain("upgrade");
  });

  it("warns (not fails) when the npm registry is unreachable", async () => {
    const result = await runDoctor({
      configPath: cfgPath,
      credentialsPath: credsPath,
      installedVersion: "1.4.2",
      fetchLatestVersion: async () => {
        throw new Error("ENOTFOUND registry.npmjs.org");
      },
    });
    const check = findCheck(result, "installed version is up to date");
    expect(check.status).toBe("warn");
    expect(check.detail.toLowerCase()).toContain("npm registry");
    expect(check.detail).toContain("ENOTFOUND");
  });

  it("treats a local build ahead of npm latest as pass (dev scenario)", async () => {
    const result = await runDoctor({
      configPath: cfgPath,
      credentialsPath: credsPath,
      installedVersion: "1.5.0",
      fetchLatestVersion: async () => "1.4.2",
    });
    const check = findCheck(result, "installed version is up to date");
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("dev build");
  });

  // The server's developer token comes from its own env, which for Claude
  // Desktop is the entry's env block. The shell running doctor proves nothing
  // about it. Every value is made up, and none may be printed.
  describe("developer token check", () => {
    const NAME = "GOOGLE_ADS_DEVELOPER_TOKEN is set for the server";
    const TOKEN = "fake-developer-token";

    async function check(entry?: Record<string, unknown>): Promise<DoctorCheck> {
      writeFileSync(cfgPath, JSON.stringify({ mcpServers: entry ? { "google-ads": entry } : {} }));
      const result = await runDoctor({ configPath: cfgPath, credentialsPath: credsPath, installedVersion: "1.0.0", fetchLatestVersion: async () => "1.0.0" });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      return findCheck(result, NAME);
    }

    afterEach(() => vi.unstubAllEnvs());

    it("passes when the entry's env has it", async () => {
      expect((await check({ command: "npx", env: { GOOGLE_ADS_DEVELOPER_TOKEN: TOKEN } })).status).toBe("pass");
    });

    it.each([
      ["no env", { command: "npx" }],
      ["a blank value", { command: "npx", env: { GOOGLE_ADS_DEVELOPER_TOKEN: " " } }],
      ["other variables only", { command: "npx", env: { GOOGLE_ADS_CUSTOMER_ID: "1112223333" } }],
    ])("fails with %s, naming the variable and where to apply", async (_name, entry) => {
      const { status, detail } = await check(entry);
      expect(status).toBe("fail");
      expect(detail).toContain("mcpServers.google-ads.env");
      expect(detail).toContain("https://console.cloud.google.com/google/ads-apis/overview");
    });

    it("is not satisfied by the variable in doctor's own shell", async () => {
      vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", TOKEN);
      expect((await check({ command: "npx" })).status).toBe("fail");
    });

    it("only warns for a launcher script, which may set the variable itself", async () => {
      const { status, detail } = await check({ command: "/opt/example/run-mcp.sh" });
      expect(status).toBe("warn");
      expect(detail).toContain("/opt/example/run-mcp.sh");
    });

    it("warns that it cannot check when google-ads is not registered", async () => {
      const { status, detail } = await check();
      expect(status).toBe("warn");
      expect(detail).toMatch(/cannot check/);
    });
  });
});
