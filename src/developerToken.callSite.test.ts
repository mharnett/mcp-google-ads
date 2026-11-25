/**
 * A tool call with no developer token set answers with the one message, and
 * does not blame the refresh token, through the real CallTool dispatch in
 * src/index.ts and the real resolveCredentials.
 *
 * Containment: the credentials file is in a temp dir, GoogleAdsApi is the
 * recording fake, fetch throws. Every value is made up.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const fake = vi.hoisted(() => ({ dir: "" }));

vi.mock("./platform.js", async (importOriginal) => {
  fake.dir = mkdtempSync(path.join(tmpdir(), "gads-no-token-"));
  return { ...(await importOriginal<typeof import("./platform.js")>()), configDir: fake.dir, credentialsFilePath: path.join(fake.dir, "credentials.json") };
});
vi.mock("google-ads-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("google-ads-api")>()),
  GoogleAdsApi: (await import("../tests/helpers/recordingGoogleAds.js")).FakeGoogleAdsApi,
}));

import { recorder } from "../tests/helpers/recordingGoogleAds.js";
import { MissingDeveloperTokenError } from "./errors.js";
import { GoogleAdsManager, server } from "./index.js";

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "no-developer-token-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(fake.dir, { recursive: true, force: true });
});

function setEnv(env: Record<string, string>): void {
  for (const key of ["CLIENT_ID", "CLIENT_SECRET", "DEVELOPER_TOKEN", "REFRESH_TOKEN", "CUSTOMER_ID", "MCC_CUSTOMER_ID"]) {
    vi.stubEnv(`GOOGLE_ADS_${key}`, env[key] ?? "");
  }
  recorder.reset();
}

async function call(env: Record<string, string>): Promise<any> {
  setEnv(env);
  const result: any = await client.callTool({ name: "google_ads_list_campaigns", arguments: { customer_id: "1234567890" } });
  return { isError: result.isError, ...JSON.parse(result.content[0].text) };
}

const SIGNED_IN = { CLIENT_ID: "fake-client-id", CLIENT_SECRET: "fake-client-secret", REFRESH_TOKEN: "fake-refresh-token", CUSTOMER_ID: "1234567890" };

describe("a tool call with no developer token", () => {
  it("says the token is not set and what to do, and not that the refresh token was rejected", async () => {
    const body = await call(SIGNED_IN);
    expect(body.isError).toBe(true);
    expect(body.message).toMatch(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    expect(body.message).toContain("https://console.cloud.google.com/google/ads-apis/overview");
    expect(body.action_required).toMatch(/GOOGLE_ADS_DEVELOPER_TOKEN.*restart/);
    expect(JSON.stringify(body)).not.toMatch(/refresh token|re-?authenticate|mcp-google-ads-auth|stack/i);
    expect(recorder.apiConstructed).toBe(0);
  });

  it("when the sign-in is missing too, the action covers both", async () => {
    const body = await call({ CLIENT_ID: "fake-client-id", CLIENT_SECRET: "fake-client-secret" });
    expect(body.message).toMatch(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    expect(body.message).toContain("refresh_token, customer_id");
    expect(body.action_required).toMatch(/GOOGLE_ADS_DEVELOPER_TOKEN.*npx mcp-google-ads-auth/);
  });

  // With a config.json the manager is the first to look for credentials.
  it("the manager throws the same error, not a generic auth error", () => {
    setEnv(SIGNED_IN);
    const config = { google_ads: { mcc_customer_id: "" }, clients: {}, defaults: { create_paused: true, label_prefix: "claude-", require_approval_for_enable: true } };
    expect(() => new GoogleAdsManager(config)).toThrow(MissingDeveloperTokenError);
  });

  it("recovers in the same process once the token is there", async () => {
    const body = await call({ ...SIGNED_IN, DEVELOPER_TOKEN: "fake-developer-token" });
    expect(recorder.apiConstructed).toBe(1);
    expect(body.message ?? "").not.toMatch(/GOOGLE_ADS_DEVELOPER_TOKEN/);
  });
});
