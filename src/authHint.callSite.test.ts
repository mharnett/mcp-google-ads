/**
 * A GoogleAdsAuthError response carries the hint built from the launcher's
 * Keychain item, through the real CallTool dispatch in src/index.ts.
 *
 * Containment: GoogleAdsApi and the credential chain are the recording fakes
 * in tests/helpers/recordingGoogleAds.ts and fetch is stubbed to throw, so
 * nothing here reaches Google Ads, the network, the credentials file or the
 * Keychain. The "auth failure" is a fake query rejecting with status 401.
 * Every value is made up.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { recorder, FAKE_CUSTOMER_ID } from "../tests/helpers/recordingGoogleAds.js";
import { server } from "./index.js";

vi.mock("google-ads-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("google-ads-api")>()),
  GoogleAdsApi: (await import("../tests/helpers/recordingGoogleAds.js")).FakeGoogleAdsApi,
}));
vi.mock("./credentials.js", async (importOriginal) =>
  (await import("../tests/helpers/recordingGoogleAds.js")).fakeCredentialsModule(
    await importOriginal<typeof import("./credentials.js")>(),
  ),
);

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "auth-hint-call-site-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  recorder.reset();
  // Every read is rejected the way an expired or revoked token is.
  recorder.answerQuery(/./, () => {
    throw Object.assign(new Error("invalid_grant: Token has been expired or revoked."), { status: 401 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function authFailure(): Promise<any> {
  const result: any = await client.callTool({ name: "google_ads_list_campaigns", arguments: { customer_id: FAKE_CUSTOMER_ID } });
  expect(result.isError).toBe(true);
  const body = JSON.parse(result.content[0].text);
  expect(body.error_type).toBe("GoogleAdsAuthError");
  return body;
}

describe("the auth-error response names the Keychain item the server read", () => {
  it("with the launcher's service and account set", async () => {
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN_SERVICE", "EXAMPLE_REFRESH_TOKEN");
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT", "example-read-account");

    const body = await authFailure();

    expect(body.hint).toContain("-s EXAMPLE_REFRESH_TOKEN");
    expect(body.hint).toContain("-a example-read-account");
    expect(body.hint).not.toMatch(/google-ads-drak|\s-w\b/);
  });

  it("without them: the generic hint", async () => {
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN_SERVICE", "");
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT", "");

    const body = await authFailure();

    expect(body.hint).not.toMatch(/security|google-ads-drak/);
    expect(body.hint).toMatch(/mcp-google-ads-auth/);
  });
});
