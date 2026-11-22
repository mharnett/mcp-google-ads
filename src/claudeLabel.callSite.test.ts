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

const CID = FAKE_CUSTOMER_ID;
/** 12:00 PST on 2026-11-21: today's audit label is claude-11-21-26. */
const FIXED_NOW = new Date("2026-11-21T20:00:00Z");
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

/** Every label attach, through any label service, whatever the label. */
function anyLabelAttach(): string[] {
  return (Object.keys(TARGET_FIELD) as LabelService[]).flatMap((svc) =>
    recorder.callsTo(`${svc}.create`).map(() => svc),
  );
}

const CAMPAIGN_31 = { id: 31, name: "Example campaign" };

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

describe("campaign setting edits label the campaign they changed", () => {
  it("google_ads_update_campaign_tracking labels the campaign", async () => {
    recorder.answerQuery(/FROM campaign\s+WHERE campaign\.id = 31/, [{ campaign: { ...CAMPAIGN_31 } }]);

    const body = await call("google_ads_update_campaign_tracking", { campaign_id: "31", final_url_suffix: "utm_source=google" });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it.each([
    ["in place", false],
    ["with a new budget", true],
  ])("google_ads_update_campaign_budget (%s) labels the campaign and says the budget cannot be labeled", async (_how, createNew) => {
    recorder.answerQuery(/FROM campaign\s+WHERE campaign\.id = 31/, [
      { campaign: { ...CAMPAIGN_31, bidding_strategy_type: 10 }, campaign_budget: { id: 61, amount_micros: 10_000_000, name: "Example budget" } },
    ]);

    const body = await call("google_ads_update_campaign_budget", { campaign_id: "31", daily_budget: 11, create_new_budget: createNew });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
    expect(body.audit_label_note).toMatch(/budget/i);
  });

  it("google_ads_update_campaign_bidding labels the campaign", async () => {
    recorder.answerQuery(/FROM campaign\s+WHERE campaign\.id = 31/, [
      {
        campaign: {
          ...CAMPAIGN_31,
          bidding_strategy_type: enums.BiddingStrategyType.MAXIMIZE_CONVERSIONS,
          advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
          maximize_conversions: { target_cpa_micros: 50_000_000 },
        },
      },
    ]);

    const body = await call("google_ads_update_campaign_bidding", { campaign_id: "31", target_cpa_dollars: 52 });

    expect(recorder.callsTo("campaigns.update")).toHaveLength(1);
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("google_ads_update_campaign_selective_optimization labels the campaign", async () => {
    const body = await call("google_ads_update_campaign_selective_optimization", { campaign_id: "31", conversion_action_ids: ["71"] });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("google_ads_update_campaign_ad_rotation labels the campaign", async () => {
    recorder.answerQuery(/FROM campaign\s+WHERE campaign\.id = 31/, [{ campaign: { ...CAMPAIGN_31, ad_serving_optimization_status: 2 } }]);

    const body = await call("google_ads_update_campaign_ad_rotation", { campaign_id: "31", mode: "ROTATE", confirm: true });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("google_ads_detach_portfolio_bid_strategy labels the campaign", async () => {
    recorder.answerQuery(/FROM campaign\s+WHERE campaign\.id = 31/, [
      { campaign: { ...CAMPAIGN_31, bidding_strategy: `customers/${CID}/biddingStrategies/77`, bidding_strategy_type: 10 } },
    ]);

    const body = await call("google_ads_detach_portfolio_bid_strategy", { campaign_id: "31", confirm: true });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });
});

describe("negatives label the campaign or ad group, because the negative itself cannot carry a label", () => {
  const KEYWORDS = [{ text: "free example", match_type: "PHRASE" }];

  it("google_ads_add_campaign_negatives labels the campaign", async () => {
    const body = await call("google_ads_add_campaign_negatives", { campaign_id: "31", keywords: KEYWORDS });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
    expect(body.audit_label_note).toMatch(/campaign/i);
  });

  it("google_ads_remove_campaign_negatives labels each campaign a negative came off, once", async () => {
    const body = await call("google_ads_remove_campaign_negatives", {
      resource_names: [
        `customers/${CID}/campaignCriteria/31~1001`,
        `customers/${CID}/campaignCriteria/32~1002`,
        `customers/${CID}/campaignCriteria/31~1003`,
      ],
    });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`, `customers/${CID}/campaigns/32`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("google_ads_add_adgroup_negatives labels the ad group and never tries to label the negative", async () => {
    const body = await call("google_ads_add_adgroup_negatives", { ad_group_id: "41", keywords: KEYWORDS });

    expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/41`]);
    // Google refuses a label on a negative ad group criterion
    // (CANNOT_ADD_LABEL_TO_NEGATIVE_CRITERION).
    expect(recorder.callsTo("adGroupCriterionLabels.create")).toEqual([]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
    expect(body.audit_label_note).toMatch(/ad group/i);
  });

  it("google_ads_remove_adgroup_negatives labels each ad group a negative came off", async () => {
    const body = await call("google_ads_remove_adgroup_negatives", {
      resource_names: [`customers/${CID}/adGroupCriteria/41~2001`, `customers/${CID}/adGroupCriteria/42~2002`],
    });

    expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/41`, `customers/${CID}/adGroups/42`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it.each<[string, Record<string, unknown>]>([
    ["google_ads_add_shared_negatives", { shared_set_id: "91", keywords: KEYWORDS }],
    ["google_ads_remove_shared_negatives", { resource_names: [`customers/${CID}/sharedCriteria/91~3001`] }],
  ])("%s reports audit_label: null with the reason, and attaches nothing", async (name, args) => {
    const body = await call(name, args);

    expect(body.audit_label).toBeNull();
    expect(body.audit_label_note).toMatch(/cannot be labeled/);
    expect(anyLabelAttach()).toEqual([]);
  });
});

describe("location targeting labels what it changed", () => {
  it("google_ads_set_campaign_location_targeting labels the campaign", async () => {
    const body = await call("google_ads_set_campaign_location_targeting", { campaign_id: "31", geo_target_ids: ["2840", "2124"] });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
    expect(body.audit_label_note).toMatch(/campaign/i);
  });

  it("google_ads_set_ad_group_location_targeting labels each new location criterion", async () => {
    const body = await call("google_ads_set_ad_group_location_targeting", { ad_group_id: "41", geo_target_ids: ["2840", "2124"] });

    expect(auditLabelled("adGroupCriterionLabels")).toEqual([
      `customers/${CID}/adGroupCriteria/1`,
      `customers/${CID}/adGroupCriteria/2`,
    ]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });
});

describe("audience attaches label what they created", () => {
  it("google_ads_attach_user_list_audience (OBSERVATION) labels each new audience criterion", async () => {
    const body = await call("google_ads_attach_user_list_audience", { ad_group_ids: ["41", "42"], user_list_id: "81", confirm: true });

    expect(auditLabelled("adGroupCriterionLabels")).toEqual([
      `customers/${CID}/adGroupCriteria/1`,
      `customers/${CID}/adGroupCriteria/2`,
    ]);
    expect(auditLabelled("adGroupLabels")).toEqual([]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("google_ads_attach_user_list_audience (TARGETING) also labels the ad groups whose targeting it changed", async () => {
    await call("google_ads_attach_user_list_audience", { ad_group_ids: ["41", "42"], user_list_id: "81", mode: "TARGETING", confirm: true });

    expect(recorder.callsTo("adGroups.update")).toHaveLength(1);
    expect(auditLabelled("adGroupCriterionLabels")).toEqual([
      `customers/${CID}/adGroupCriteria/1`,
      `customers/${CID}/adGroupCriteria/2`,
    ]);
    expect(auditLabelled("adGroupLabels")).toEqual([`customers/${CID}/adGroups/41`, `customers/${CID}/adGroups/42`]);
  });

  it("google_ads_create_and_attach_audience_bundle labels each new audience criterion", async () => {
    const body = await call("google_ads_create_and_attach_audience_bundle", {
      name: "Example bundle",
      user_list_ids: ["81"],
      ad_group_ids: ["41"],
      confirm: true,
    });

    expect(recorder.callsTo("audiences.create")).toHaveLength(1);
    expect(auditLabelled("adGroupCriterionLabels")).toEqual([`customers/${CID}/adGroupCriteria/1`]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });
});

/** Rows the video-targeting tools read for campaign 31. */
function answerCampaign31(extra: Record<string, unknown> = {}): void {
  recorder.answerQuery(/FROM campaign WHERE campaign\.id IN \(31\)/, [{ campaign: { ...CAMPAIGN_31, status: 3, ...extra } }]);
}

describe("edits that already labeled, now pinned at the dispatch", () => {
  it("google_ads_set_campaign_languages labels the campaign it changed", async () => {
    answerCampaign31();

    await call("google_ads_set_campaign_languages", { campaign_ids: ["31"], languages: ["en"], confirm: true });

    expect(recorder.callsTo("campaignCriteria.create")).toHaveLength(1);
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
  });

  it("google_ads_add_youtube_channel_exclusions (campaign level) labels the campaign", async () => {
    answerCampaign31();

    await call("google_ads_add_youtube_channel_exclusions", {
      level: "campaign",
      campaign_ids: ["31"],
      channel_ids: ["UCabcdefghijklmnopqrstuv"],
      confirm: true,
    });

    expect(recorder.callsTo("campaignCriteria.create")).toHaveLength(1);
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
  });

  it("google_ads_add_ad_group_targeting labels each new criterion", async () => {
    recorder.answerQuery(/FROM ad_group WHERE ad_group\.id IN \(41\)/, [
      { ad_group: { id: 41, name: "Example AG" }, campaign: { name: "Example campaign", advertising_channel_type: 6 } },
    ]);

    await call("google_ads_add_ad_group_targeting", { ad_group_ids: ["41"], topic_ids: ["66"], confirm: true });

    expect(auditLabelled("adGroupCriterionLabels")).toEqual([`customers/${CID}/adGroupCriteria/1`]);
  });

  it("google_ads_update_video_inventory labels the campaign", async () => {
    answerCampaign31({ advertising_channel_type: 6 });

    await call("google_ads_update_video_inventory", { campaign_ids: ["31"], allow_shorts: false, confirm: true });

    expect(recorder.callsTo("campaigns.update")).toHaveLength(1);
    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
  });

  it("google_ads_update_campaign_ad_urls labels every ad it repointed", async () => {
    recorder.answerQuery(/FROM ad_group_ad\s+WHERE campaign\.id = 31/, [
      { ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/41~51`, ad: { id: 51, final_urls: ["https://example.com/old"] } }, ad_group: { name: "AG" } },
      { ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/42~52`, ad: { id: 52, final_urls: ["https://example.com/old"] } }, ad_group: { name: "AG2" } },
    ]);

    await call("google_ads_update_campaign_ad_urls", { campaign_id: "31", new_final_url: "https://example.com/new", execute: true });

    expect(recorder.callsTo("adGroupAds.update")).toHaveLength(1);
    expect(auditLabelled("adGroupAdLabels")).toEqual([`customers/${CID}/adGroupAds/41~51`, `customers/${CID}/adGroupAds/42~52`]);
  });

  it("google_ads_update_ad_asset_automation labels the ad", async () => {
    await call("google_ads_update_ad_asset_automation", { ad_ids: ["51"], automation_types: ["GENERATE_VIDEOS_FROM_OTHER_ASSETS"] });

    expect(recorder.callsTo("mutateResources")).toHaveLength(1);
    expect(auditLabelled("adGroupAdLabels")).toEqual([`customers/${CID}/adGroupAds/41~51`]);
  });

  it("google_ads_update_video_ad_videos labels the ad", async () => {
    recorder.answerQuery(/FROM ad_group_ad\s+WHERE ad_group_ad\.ad\.id = 52/, [
      {
        ad_group_ad: {
          resource_name: `customers/${CID}/adGroupAds/42~52`,
          ad: { type: enums.AdType.VIDEO_RESPONSIVE_AD, name: "Example video ad", video_responsive_ad: { videos: [{ asset: `customers/${CID}/assets/7` }] } },
        },
      },
    ]);

    await call("google_ads_update_video_ad_videos", { ad_id: "52", videos: ["dQw4w9WgXcQ"], skip_visibility_check: true });

    expect(recorder.callsTo("mutateResources")).toHaveLength(1);
    expect(auditLabelled("adGroupAdLabels")).toEqual([`customers/${CID}/adGroupAds/42~52`]);
  });

  it("google_ads_update_demand_gen_multi_asset_ad labels every ad group ad sharing the ad", async () => {
    const dg = {
      type: 40,
      demand_gen_multi_asset_ad: { headlines: [{ text: "Old headline" }], descriptions: [{ text: "Old description" }] },
    };
    recorder.answerQuery(/FROM ad_group_ad\s+WHERE ad_group_ad\.ad\.id = 53/, [
      { ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/43~53`, ad: { id: 53, ...dg } }, ad_group: { id: 43 } },
      { ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/44~53`, ad: { id: 53, ...dg } }, ad_group: { id: 44 } },
    ]);

    await call("google_ads_update_demand_gen_multi_asset_ad", { ad_resource_name: "53", headlines: ["New headline"] });

    expect(recorder.callsTo("ads.update")).toHaveLength(1);
    expect(auditLabelled("adGroupAdLabels")).toEqual([`customers/${CID}/adGroupAds/43~53`, `customers/${CID}/adGroupAds/44~53`]);
  });
});

describe("the dispatch stamps the Pacific date, not the server's", () => {
  let savedTz: string | undefined;
  beforeEach(() => {
    savedTz = process.env.TZ;
  });
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("a server in Tokyo, where it is already 11-22, still labels claude-11-21-26", async () => {
    process.env.TZ = "Asia/Tokyo";
    expect(new Date().getDate()).toBe(22); // the zone switch took effect

    await call("google_ads_rename_campaign", { campaign_id: "31", new_name: "Renamed campaign", confirm: true });

    expect(auditLabelled("campaignLabels")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(recorder.queries().some((q) => q.includes("claude-11-22-26"))).toBe(false);
  });
});
