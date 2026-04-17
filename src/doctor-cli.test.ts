import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
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
        customer_id: "2326253482",
        customer_name: "Drak Marketing MCC",
        mcc_customer_id: "2326253482",
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
        customer_id: "7458517309",
        customer_name: "Flowspace",
        mcc_customer_id: "2326253482",
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
});
