/**
 * Creates land PAUSED: pins the status in the mutate payload that the RSA,
 * keyword and Demand Gen ad create tools send, through the real CallTool
 * dispatch in src/index.ts with writes enabled.
 *
 * Flipping PAUSED to ENABLED in any of the three create paths left every test
 * green (review 2026-11-14): the label and policy tests drive the same
 * methods but never read the status. Each test here reads it off the exact
 * operations handed to the recording client.
 *
 * Containment: GoogleAdsApi and the credential chain are the recording fakes
 * in tests/helpers/recordingGoogleAds.ts and fetch is stubbed to throw, so
 * nothing here reaches Google Ads, the network, the credentials file or the
 * Keychain.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { enums } from "google-ads-api";

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
  client = new Client({ name: "create-paused-call-site-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  recorder.reset();
  vi.stubEnv("GOOGLE_ADS_MCP_WRITE", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result: any = await client.callTool({ name, arguments: { customer_id: FAKE_CUSTOMER_ID, ...args } });
  expect(result.isError, result.content?.[0]?.text).toBeFalsy();
  const body = JSON.parse(result.content[0].text);
  expect(body.success, result.content[0].text).toBe(true);
  return body;
}

describe("create tools send status PAUSED (GOOGLE_ADS_MCP_WRITE=true)", () => {
  it("google_ads_create_responsive_search_ad creates the ad group ad PAUSED", async () => {
    await call("google_ads_create_responsive_search_ad", {
      ad_group_id: "999",
      final_urls: ["https://example.com/lp"],
      headlines: ["Headline one", "Headline two", "Headline three"],
      descriptions: ["Description one here", "Description two here"],
      path1: "path1",
      path2: "path2",
      allow_partial_assets: true,
    });

    const creates = recorder.callsTo("adGroupAds.create");
    expect(creates).toHaveLength(1);
    expect(creates[0].args[0].map((op: any) => op.status)).toEqual([enums.AdGroupAdStatus.PAUSED]);
  });

  it("google_ads_create_keywords creates every keyword PAUSED", async () => {
    await call("google_ads_create_keywords", {
      ad_group_id: "999",
      keywords: [
        { text: "example widget", match_type: "PHRASE" },
        { text: "example gadget", match_type: "EXACT" },
      ],
    });

    const creates = recorder.callsTo("adGroupCriteria.create");
    expect(creates).toHaveLength(1);
    expect(creates[0].args[0].map((op: any) => op.status)).toEqual([
      enums.AdGroupCriterionStatus.PAUSED,
      enums.AdGroupCriterionStatus.PAUSED,
    ]);
  });

  it("google_ads_create_demand_gen_multi_asset_ad creates the ad group ad PAUSED", async () => {
    await call("google_ads_create_demand_gen_multi_asset_ad", {
      ad_group_id: "111",
      final_urls: ["https://example.com/"],
      business_name: "Example Org",
      call_to_action: "LEARN_MORE",
      marketing_image_asset_ids: ["123"],
      headlines: ["Headline 1", "Headline 2"],
      long_headlines: ["A longer headline that still fits within ninety characters for a DG ad."],
      descriptions: ["Description 1", "Description 2"],
    });

    const createOps = recorder
      .callsTo("mutateResources")
      .flatMap((c) => c.args[0])
      .filter((op: any) => op.operation === "create");
    expect(createOps).toHaveLength(1);
    expect(createOps[0].entity).toBe("ad_group_ad");
    expect(createOps[0].resource.status).toBe(enums.AdGroupAdStatus.PAUSED);
  });
});
