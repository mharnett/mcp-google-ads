/**
 * "Label every change claude-MM-DD-YY": the audit label at each create, status
 * change and edit call site, driven through the real CallTool dispatch in
 * src/index.ts with writes enabled.
 *
 * Only RSA, keyword pause/enable, replaceSitelinkUrl and network settings had
 * a failing test for a dropped label (review 2026-11-14, gap 5);
 * createCampaign.dates.test.ts stubs autoLabelCreated away. Each case here
 * reads the label attach off the recording client and checks it names the
 * entity the tool just created or changed. Entities the Google Ads client
 * cannot label (assets, shared sets) must say so in the result instead of
 * skipping silently.
 *
 * Containment: GoogleAdsApi and the credential chain are the recording fakes
 * in tests/helpers/recordingGoogleAds.ts and fetch is stubbed to throw, so
 * nothing here reaches Google Ads, the network, the credentials file or the
 * Keychain.
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

const CID = FAKE_CUSTOMER_ID;
/** 2026-11-21 12:00 local: today's audit label is claude-11-21-26. */
const FIXED_NOW = new Date(2026, 10, 21, 12, 0, 0);
const AUDIT_LABEL = "claude-11-21-26";
/** The resource name the fake returns for the audit label, and only for it. */
const AUDIT_LABEL_RN = `customers/${CID}/labels/900`;

type LabelService = "campaignLabels" | "adGroupLabels" | "adGroupAdLabels" | "adGroupCriterionLabels";
const TARGET_FIELD: Record<LabelService, string> = {
  campaignLabels: "campaign",
  adGroupLabels: "ad_group",
  adGroupAdLabels: "ad_group_ad",
  adGroupCriterionLabels: "ad_group_criterion",
};

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "claude-label-call-site-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  recorder.reset();
  recorder.answerQuery(new RegExp(`label\\.name = '${AUDIT_LABEL}'`), [
    { label: { resource_name: AUDIT_LABEL_RN, name: AUDIT_LABEL } },
  ]);
  // Ad 51 lives in ad group 41.
  recorder.answerQuery(/FROM ad_group_ad WHERE ad_group_ad\.ad\.id IN \(51\)/, [
    { ad_group: { id: 41 }, ad_group_ad: { ad: { id: 51 } } },
  ]);
  vi.stubEnv("GOOGLE_ADS_MCP_WRITE", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result: any = await client.callTool({ name, arguments: { customer_id: CID, ...args } });
  expect(result.isError, result.content?.[0]?.text).toBeFalsy();
  const body = JSON.parse(result.content[0].text);
  expect(body.success, result.content[0].text).toBe(true);
  return body;
}

/** Resources that received today's audit label through one label service. */
function auditLabelled(service: LabelService): string[] {
  return recorder
    .callsTo(`${service}.create`)
    .flatMap((c) => c.args[0])
    .filter((op: any) => op.label === AUDIT_LABEL_RN)
    .map((op: any) => op[TARGET_FIELD[service]]);
}

describe("creates attach today's audit label to what they created", () => {
  it("google_ads_create_campaign labels the new campaign", async () => {
    await call("google_ads_create_campaign", { name: "Example Search", daily_budget: 10 });
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/1`]);
  });

  it("google_ads_create_campaign (DEMAND_GEN) labels the new campaign", async () => {
    await call("google_ads_create_campaign", {
      name: "Example DG",
      daily_budget: 10,
      channel_type: "DEMAND_GEN",
      geo_target_ids: ["2840"],
      language_id: "1000",
    });
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/1`]);
  });

  it("google_ads_create_ad_group labels the new ad group", async () => {
    await call("google_ads_create_ad_group", { campaign_id: "1", name: "Example AG" });
    expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/1`]);
  });

  it("google_ads_create_ad_group (DEMAND_GEN) labels the new ad group", async () => {
    await call("google_ads_create_ad_group", { campaign_id: "1", name: "Example DG AG", type: "DEMAND_GEN_MULTI_ASSET_AD_GROUP" });
    expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/1`]);
  });

  it("google_ads_create_demand_gen_multi_asset_ad labels the new ad", async () => {
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
    expect(auditLabelled("adGroupAdLabels")).toEqual([`customers/${CID}/adGroupAds/111~222`]);
  });

  it("google_ads_create_keywords labels every new keyword", async () => {
    await call("google_ads_create_keywords", {
      ad_group_id: "41",
      keywords: [
        { text: "example widget", match_type: "PHRASE" },
        { text: "example gadget", match_type: "EXACT" },
      ],
    });
    expect(auditLabelled("adGroupCriterionLabels")).toEqual([
      `customers/${CID}/adGroupCriteria/1`,
      `customers/${CID}/adGroupCriteria/2`,
    ]);
  });

  it("google_ads_create_experiment labels the treatment campaign it created", async () => {
    recorder.answerQuery(/FROM experiment_arm/, [
      { experiment_arm: { in_design_campaigns: [`customers/${CID}/campaigns/88`] } },
    ]);

    const body = await call("google_ads_create_experiment", { base_campaign_id: "31", name: "Example experiment" });

    expect(body.treatment_campaign_id).toBe("88");
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/88`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
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

describe("assets and shared sets cannot carry a label, and the result says so", () => {
  it.each<[string, Record<string, unknown>]>([
    ["google_ads_create_sitelink", { link_text: "Pricing", final_urls: ["https://example.com/pricing"], confirm: true }],
    ["google_ads_create_callout", { callout_text: "Free trial", confirm: true }],
    ["google_ads_create_structured_snippet", { header: "Types", values: ["One", "Two", "Three"], confirm: true }],
    ["google_ads_create_shared_set", { name: "Example negatives" }],
    ["google_ads_create_image_asset", { name: "Example image", base64_data: PNG_1200x628 }],
    [
      "google_ads_create_lead_form_asset",
      {
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
      },
    ],
  ])("%s reports audit_label: null with the reason", async (name, args) => {
    const body = await call(name, args);
    const result = body.result ?? body;

    expect(result.audit_label).toBeNull();
    expect(result.audit_label_note).toMatch(/cannot be labeled/);
  });
});

describe("status changes label every target", () => {
  it.each(["google_ads_pause_items", "google_ads_enable_items"])(
    "%s labels each campaign, ad group and ad it changed",
    async (name) => {
      await call(name, { campaign_ids: ["31"], ad_group_ids: ["41"], ad_ids: ["51"] });

      expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
      expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/41`]);
      expect(auditLabelled("adGroupAdLabels")).toEqual([`customers/${CID}/adGroupAds/41~51`]);
    },
  );
});

describe("edits label what they changed", () => {
  it("google_ads_rename_ad_group labels the ad group", async () => {
    await call("google_ads_rename_ad_group", { ad_group_id: "41", new_name: "Renamed AG", confirm: true });
    expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/41`]);
  });

  it("google_ads_rename_campaign labels the campaign", async () => {
    await call("google_ads_rename_campaign", { campaign_id: "31", new_name: "Renamed campaign", confirm: true });
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
  });

  it("google_ads_update_campaign_geo_target_type labels each campaign, as well as any caller label", async () => {
    const body = await call("google_ads_update_campaign_geo_target_type", {
      campaign_ids: ["31", "32"],
      mode: "PRESENCE",
      confirm: true,
    });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`, `customers/${CID}/campaigns/32`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });
});
