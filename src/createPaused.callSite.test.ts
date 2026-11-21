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

import { recorder, FAKE_CUSTOMER_ID, FakeGoogleAdsApi } from "../tests/helpers/recordingGoogleAds.js";
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

/**
 * Status set on the create operations recorded for one service method
 * ("campaigns.create") or, for mutateResources, one entity ("campaign").
 */
function createdStatuses(target: { method: string } | { entity: string }): number[] {
  if ("method" in target) {
    return recorder.callsTo(target.method).flatMap((c) => c.args[0]).map((op: any) => op.status);
  }
  return recorder
    .callsTo("mutateResources")
    .flatMap((c) => c.args[0])
    .filter((op: any) => op.operation === "create" && op.entity === target.entity)
    .map((op: any) => op.resource.status);
}

/** Recorded writes, minus the label attach that every create also makes. */
function nonLabelWrites(): string[] {
  return recorder
    .writes()
    .map((c) => c.method)
    .filter((m) => !/^(labels|campaignLabels|adGroupLabels|adGroupAdLabels|adGroupCriterionLabels)\./.test(m));
}

describe("campaign, ad group and experiment creates are staged (GOOGLE_ADS_MCP_WRITE=true)", () => {
  it("google_ads_create_campaign (SEARCH) creates the campaign PAUSED", async () => {
    await call("google_ads_create_campaign", { name: "Example Search", daily_budget: 10, channel_type: "SEARCH" });

    expect(createdStatuses({ method: "campaigns.create" })).toEqual([enums.CampaignStatus.PAUSED]);
    expect(nonLabelWrites()).toEqual(["campaignBudgets.create", "campaigns.create"]);
  });

  it("google_ads_create_campaign (DEMAND_GEN) creates the campaign PAUSED through mutateResources", async () => {
    await call("google_ads_create_campaign", {
      name: "Example DG",
      daily_budget: 10,
      channel_type: "DEMAND_GEN",
      geo_target_ids: ["2840"],
      language_id: "1000",
    });

    expect(createdStatuses({ entity: "campaign" })).toEqual([enums.CampaignStatus.PAUSED]);
    expect(recorder.callsTo("campaigns.create")).toEqual([]);
  });

  it("google_ads_create_ad_group (SEARCH_STANDARD) creates the ad group PAUSED", async () => {
    await call("google_ads_create_ad_group", { campaign_id: "1", name: "Example AG", cpc_bid: 1.5 });

    expect(createdStatuses({ method: "adGroups.create" })).toEqual([enums.AdGroupStatus.PAUSED]);
    expect(nonLabelWrites()).toEqual(["adGroups.create"]);
  });

  it("google_ads_create_ad_group (DEMAND_GEN) creates the ad group PAUSED through mutateResources", async () => {
    await call("google_ads_create_ad_group", {
      campaign_id: "1",
      name: "Example DG AG",
      type: "DEMAND_GEN_MULTI_ASSET_AD_GROUP",
    });

    expect(createdStatuses({ entity: "ad_group" })).toEqual([enums.AdGroupStatus.PAUSED]);
    expect(recorder.callsTo("adGroups.create")).toEqual([]);
  });

  it("google_ads_create_experiment creates the experiment in SETUP and does not schedule it", async () => {
    await call("google_ads_create_experiment", { base_campaign_id: "1", name: "Example experiment" });

    expect(createdStatuses({ method: "experiments.create" })).toEqual([enums.ExperimentStatus.SETUP]);
    expect(nonLabelWrites()).toEqual(["experiments.create", "experimentArms.create"]);
  });
});

/** A 24-byte PNG header the image validator reads as 1200x628. */
const PNG_1200x628 = (() => {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(628, 20);
  return b.toString("base64");
})();

const LEAD_FORM_ARGS = {
  explicit_lead_form_request: true,
  name: "Example lead form",
  business_name: "Example Org",
  call_to_action: "DOWNLOAD",
  call_to_action_description: "Get the free report",
  headline: "Example report",
  description: "Free benchmarks for the example report.",
  privacy_policy_url: "https://example.com/privacy/",
  final_urls: ["https://example.com/report/"],
  post_submit_headline: "Thanks",
  post_submit_description: "Your copy is on its way.",
  post_submit_call_to_action: "VISIT_SITE",
  desired_intent: "HIGH_INTENT",
  fields: ["FULL_NAME", "WORK_EMAIL"],
};

describe("asset and shared-set creates link nothing, so nothing new serves", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["google_ads_create_sitelink", { link_text: "Pricing", final_urls: ["https://example.com/pricing"], confirm: true }, "assets.create"],
    ["google_ads_create_callout", { callout_text: "Free trial", confirm: true }, "assets.create"],
    ["google_ads_create_structured_snippet", { header: "Types", values: ["One", "Two", "Three"], confirm: true }, "assets.create"],
    ["google_ads_create_image_asset", { name: "Example image", base64_data: PNG_1200x628 }, "assets.create"],
    ["google_ads_create_lead_form_asset", LEAD_FORM_ARGS, "assets.create"],
    ["google_ads_create_shared_set", { name: "Example negatives" }, "sharedSets.create"],
  ])("%s writes only %s", async (name, args, onlyWrite) => {
    await call(name, args);

    expect(nonLabelWrites()).toEqual([onlyWrite]);
  });
});

describe("confirm-gated creates and asset links write nothing until confirm: true", () => {
  it.each<[string, Record<string, unknown>]>([
    ["google_ads_create_sitelink", { link_text: "Pricing", final_urls: ["https://example.com/pricing"] }],
    ["google_ads_create_callout", { callout_text: "Free trial" }],
    ["google_ads_create_structured_snippet", { header: "Types", values: ["One", "Two", "Three"] }],
    ["google_ads_link_asset_to_campaign", { asset_id: "5", campaign_ids: ["1"], field_type: "SITELINK" }],
    ["google_ads_link_asset_to_ad_group", { asset_id: "5", ad_group_ids: ["1"], field_type: "SITELINK" }],
    ["google_ads_link_asset_to_customer", { asset_id: "5", field_type: "CALLOUT" }],
  ])("%s without confirm returns a dry run and makes no write", async (name, args) => {
    const result: any = await client.callTool({ name, arguments: { customer_id: FAKE_CUSTOMER_ID, ...args } });

    expect(result.isError, result.content?.[0]?.text).toBeFalsy();
    expect(JSON.parse(result.content[0].text).dry_run).toBe(true);
    expect(recorder.writes()).toEqual([]);
  });
});

describe("google_ads_create_page_feed", () => {
  it("builds the feed through the client's real asset-set services and attaches it to the campaign", async () => {
    await call("google_ads_create_page_feed", {
      customer_id: "123-456-7890",
      campaign_id: "77",
      name: "Example feed",
      urls: ["https://example.com/a", "https://example.com/b"],
    });

    expect(nonLabelWrites()).toEqual([
      "assets.create",
      "assetSets.create",
      "assetSetAssets.create",
      "campaignAssetSets.create",
    ]);
    expect(recorder.callsTo("assets.create")[0].args[0]).toHaveLength(2);
    expect(recorder.callsTo("campaignAssetSets.create")[0].args[0][0].campaign).toBe("customers/1234567890/campaigns/77");
  });

  it("the recording client, like the real one, has no snake_case asset-set services", () => {
    // Pins the fake's fidelity: the original handler called customer.asset_sets,
    // which is undefined on the real google-ads-api Customer.
    const customer = new FakeGoogleAdsApi({}).Customer({});
    expect(customer.assetSets).toBeDefined();
    expect(customer.asset_sets).toBeUndefined();
    expect(customer.customerAssetLabels).toBeUndefined();
  });
});
