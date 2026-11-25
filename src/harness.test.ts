import { registerMcpTests } from "@drak-marketing/mcp-test-harness";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import { jailSpawnedServers } from "../tests/helpers/jailSpawnedServers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");

// Every process the harness starts below inherits this: no real credentials,
// and no network. The startup auth check used to reach Google's token endpoint
// with the fake credentials in startupEnv.
const jail = jailSpawnedServers(DIST);
afterAll(() => jail.restore());

// Fakes only. The flag keeps the startup auth check from making its call.
const startupEnv = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "fake-dev-token",
  GOOGLE_ADS_CLIENT_ID: "fake-client-id",
  GOOGLE_ADS_CLIENT_SECRET: "fake-client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "fake-refresh-token",
  GOOGLE_ADS_CUSTOMER_ID: "1234567890",
  MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK: "1",
};

registerMcpTests({
  name: "mcp-google-ads",
  repoRoot: path.resolve(__dirname, ".."),
  toolPrefix: "google_ads_",
  minTools: 30,
  requiredTools: [
    "google_ads_get_client_context",
    "google_ads_list_campaigns",
    "google_ads_gaql_query",
    "google_ads_keyword_performance",
    "google_ads_search_term_report",
  ],
  binEntries: {
    "mcp-google-ads": "dist/index.js",
    "mcp-google-ads-auth": "dist/auth-cli.js",
  },
  hasAuthCli: true,
  authCliBin: "dist/auth-cli.js",
  hasCredentials: true,
  hasResilience: true,
  hasPlatform: true,
  requiredEnvVars: [
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ],
  envPrefix: "GOOGLE_ADS_",
  startupEnv,
});

describe("the servers the harness started", () => {
  it("ran in the jail, and none tried to connect anywhere or look up a host", () => {
    const events = jail.events();
    const servers = events.filter((e) => e.event === "start" && e.script === "index.js" && !/--(help|version)/.test(e.args.join(" ")));
    expect(
      servers.length,
      "no server start was recorded, so this proves nothing. If the harness now builds its own env for the servers it starts (0.3.0 does, with a jail of its own), drop this block and jailSpawnedServers.",
    ).toBeGreaterThanOrEqual(4);
    expect(events.filter((e) => e.event === "attempt")).toEqual([]);
  });

  it("control: without the skip flag the startup check tries Google's token endpoint, and the jail refuses it", () => {
    const log = jail.newLog("control");
    const { MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK: _flag, ...checkOn } = startupEnv;
    // stdin closes at once, so the server ends when its check does.
    spawnSync(process.execPath, [path.join(DIST, "index.js")], {
      env: { ...process.env, ...checkOn, MCP_TEST_JAIL_LOG: log },
      input: "",
      timeout: 30_000,
    });
    const attempts = jail.events(log).filter((e) => e.event === "attempt");
    expect(attempts.length).toBeGreaterThan(0);
    expect([...new Set(attempts.map((e) => e.to))]).toEqual(["oauth2.googleapis.com:443"]);
  }, 45_000);
});
