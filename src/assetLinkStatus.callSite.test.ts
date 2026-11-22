/**
 * Asset links are staged PAUSED, and only google_ads_enable_asset_links turns
 * them on. Driven through the real CallTool dispatch in src/index.ts.
 *
 * Before this, google_ads_link_asset_to_campaign, _to_ad_group and
 * _to_customer created their CampaignAsset, AdGroupAsset and CustomerAsset
 * ENABLED, so a sitelink, callout or snippet served the moment it was
 * linked; the confirm dry run was the only staging. AssetLinkStatus has a
 * PAUSED value and `status` is settable on all three resources (it is
 * neither IMMUTABLE nor OUTPUT_ONLY in the v24 protos), so the links now
 * land PAUSED and the enable tool flips them, labelling the campaign or ad
 * group each link belongs to (an asset link has no label surface).
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
import { WRITE_DISABLED_MESSAGE, WRITE_TOOLS } from "./writeGate.js";

vi.mock("google-ads-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("google-ads-api")>()),
  GoogleAdsApi: (await import("../tests/helpers/recordingGoogleAds.js")).FakeGoogleAdsApi,
}));
vi.mock("./credentials.js", async (importOriginal) =>
  (await import("../tests/helpers/recordingGoogleAds.js")).fakeCredentialsModule(
    await importOriginal<typeof import("./credentials.js")>(),
  ),
);

const TOOL = "google_ads_enable_asset_links";
const CID = FAKE_CUSTOMER_ID;
/** 12:00 PST on 2026-11-21: today's audit label is claude-11-21-26. */
const FIXED_NOW = new Date("2026-11-21T20:00:00Z");
const AUDIT_LABEL = "claude-11-21-26";
const AUDIT_LABEL_RN = `customers/${CID}/labels/900`;

const PAUSED = enums.AssetLinkStatus.PAUSED;
const ENABLED = enums.AssetLinkStatus.ENABLED;
const REMOVED = enums.AssetLinkStatus.REMOVED;

/** Made-up ids: campaign 31 and 32, ad group 41, assets 501-509. */
const CAMPAIGN_LINK = `customers/${CID}/campaignAssets/31~501~SITELINK`;
const AD_GROUP_LINK = `customers/${CID}/adGroupAssets/41~502~CALLOUT`;
const CUSTOMER_LINK = `customers/${CID}/customerAssets/503~STRUCTURED_SNIPPET`;
const ENABLED_LINK = `customers/${CID}/campaignAssets/32~504~SITELINK`;
const REMOVED_LINK = `customers/${CID}/campaignAssets/31~505~CALLOUT`;
const MISSING_LINK = `customers/${CID}/campaignAssets/31~506~SITELINK`;
const LEAD_FORM_LINK = `customers/${CID}/campaignAssets/31~507~LEAD_FORM`;

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "asset-link-status-call-site-test", version: "0.0.0" }, { capabilities: {} });
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
  vi.stubEnv("GOOGLE_ADS_MCP_WRITE", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function raw(name: string, args: Record<string, unknown>): Promise<any> {
  return client.callTool({ name, arguments: { customer_id: CID, ...args } });
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result: any = await raw(name, args);
  expect(result.isError, result.content?.[0]?.text).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

/** Status on every create op handed to one service ("campaignAssets.create"). */
function createdStatuses(method: string): number[] {
  return recorder.callsTo(method).flatMap((c) => c.args[0]).map((op: any) => op.status);
}

/** Every update op handed to one service ("campaignAssets.update"). */
function updateOps(method: string): any[] {
  return recorder.callsTo(method).flatMap((c) => c.args[0]);
}

/** Resources that received today's audit label through one label service. */
function auditLabelled(service: "campaignLabels" | "adGroupLabels", field: "campaign" | "ad_group"): string[] {
  return recorder
    .callsTo(`${service}.create`)
    .flatMap((c) => c.args[0])
    .filter((op: any) => op.label === AUDIT_LABEL_RN)
    .map((op: any) => op[field]);
}

/** The GAQL read of current link state, per level, as the real API would answer it. */
function answerLinkState(opts: {
  campaign?: Array<{ rn: string; status: number; campaignStatus?: number }>;
  adGroup?: Array<{ rn: string; status: number; adGroupStatus?: number }>;
  customer?: Array<{ rn: string; status: number }>;
}): void {
  recorder.answerQuery(/FROM campaign_asset\b/, (opts.campaign ?? []).map((l) => ({
    campaign_asset: { resource_name: l.rn, status: l.status },
    campaign: { name: "Example campaign", status: l.campaignStatus ?? enums.CampaignStatus.ENABLED },
  })));
  recorder.answerQuery(/FROM ad_group_asset\b/, (opts.adGroup ?? []).map((l) => ({
    ad_group_asset: { resource_name: l.rn, status: l.status },
    ad_group: { name: "Example ad group", status: l.adGroupStatus ?? enums.AdGroupStatus.ENABLED },
    campaign: { name: "Example campaign" },
  })));
  recorder.answerQuery(/FROM customer_asset\b/, (opts.customer ?? []).map((l) => ({
    customer_asset: { resource_name: l.rn, status: l.status },
  })));
}

function linkOf(body: any, rn: string): any {
  const row = (body.links ?? []).find((l: any) => l.resource_name === rn);
  expect(row, `no per-link result for ${rn} in ${JSON.stringify(body)}`).toBeDefined();
  return row;
}

describe("the link_asset_to_* tools create the link PAUSED and say so", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["google_ads_link_asset_to_campaign", { asset_id: "501", campaign_ids: ["31", "32"], field_type: "SITELINK" }, "campaignAssets.create"],
    [
      "google_ads_link_asset_to_campaign",
      { asset_id: "507", campaign_ids: ["31"], field_type: "LEAD_FORM", explicit_lead_form_request: true },
      "campaignAssets.create",
    ],
    ["google_ads_link_asset_to_ad_group", { asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT" }, "adGroupAssets.create"],
    ["google_ads_link_asset_to_customer", { asset_id: "503", field_type: "STRUCTURED_SNIPPET" }, "customerAssets.create"],
  ])("%s (%j) sends status PAUSED on every link", async (name, args, method) => {
    // The ad group and campaign reads the ad-group and campaign tools make before linking.
    recorder.answerQuery(/FROM ad_group\s+WHERE\s+ad_group\.id IN \(41\)/, [
      { ad_group: { id: 41, name: "Example ad group", resource_name: `customers/${CID}/adGroups/41` }, campaign: { name: "Example campaign" } },
    ]);
    recorder.answerQuery(/FROM campaign\s+WHERE\s+campaign\.id IN/, [
      { campaign: { id: 31, name: "Example campaign" } },
      { campaign: { id: 32, name: "Second example campaign" } },
    ]);

    const body = await call(name, { ...args, confirm: true });

    const statuses = createdStatuses(method);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).toEqual(statuses.map(() => PAUSED));
    expect(body.success).toBe(true);
    expect(body.status).toBe("PAUSED");
    expect(body.enable_path).toMatch(/google_ads_enable_asset_links/);
  });

  it.each<[string, Record<string, unknown>]>([
    ["google_ads_link_asset_to_campaign", { asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK" }],
    ["google_ads_link_asset_to_ad_group", { asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT" }],
    ["google_ads_link_asset_to_customer", { asset_id: "503", field_type: "CALLOUT" }],
  ])("%s dry run says the links will be created PAUSED", async (name, args) => {
    recorder.answerQuery(/FROM ad_group\s+WHERE\s+ad_group\.id IN \(41\)/, [
      { ad_group: { id: 41, name: "Example ad group" }, campaign: { name: "Example campaign" } },
    ]);

    const body = await call(name, args);

    expect(body.dry_run).toBe(true);
    expect(body.message).toMatch(/PAUSED/);
    expect(body.enable_path).toMatch(/google_ads_enable_asset_links/);
    expect(recorder.writes()).toEqual([]);
  });
});

describe(`${TOOL} goes through the write gate`, () => {
  it("is a write tool", () => {
    expect(WRITE_TOOLS.has(TOOL)).toBe(true);
  });

  it("with writes off it is hidden from tools/list and refused before any read", async () => {
    vi.stubEnv("GOOGLE_ADS_MCP_WRITE", undefined);

    const listed = (await client.listTools()).tools.map((t) => t.name);
    const result: any = await raw(TOOL, { resource_names: [CAMPAIGN_LINK], confirm: true });

    expect(listed).not.toContain(TOOL);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).message).toBe(`Tool "${TOOL}" is a write operation. ${WRITE_DISABLED_MESSAGE}`);
    expect(recorder.calls).toEqual([]);
  });

  it("with writes on it is listed", async () => {
    const listed = (await client.listTools()).tools.map((t) => t.name);
    expect(listed).toContain(TOOL);
  });
});

describe(`${TOOL} dry run`, () => {
  it("reads each link and reports what confirm would do, writing nothing", async () => {
    answerLinkState({
      campaign: [{ rn: CAMPAIGN_LINK, status: PAUSED }, { rn: ENABLED_LINK, status: ENABLED }],
    });

    const body = await call(TOOL, { resource_names: [CAMPAIGN_LINK, ENABLED_LINK] });

    expect(body.dry_run).toBe(true);
    expect(linkOf(body, CAMPAIGN_LINK).outcome).toBe("would_enable");
    expect(linkOf(body, ENABLED_LINK).outcome).toBe("already_enabled");
    expect(recorder.queries().some((q) => q.includes(CAMPAIGN_LINK))).toBe(true);
    expect(recorder.writes()).toEqual([]);
  });
});

describe(`${TOOL} with confirm: true`, () => {
  it("enables only the PAUSED links, through each level's own service, with status ENABLED", async () => {
    answerLinkState({
      campaign: [
        { rn: CAMPAIGN_LINK, status: PAUSED },
        { rn: ENABLED_LINK, status: ENABLED },
        { rn: REMOVED_LINK, status: REMOVED },
      ],
      adGroup: [{ rn: AD_GROUP_LINK, status: PAUSED }],
      customer: [{ rn: CUSTOMER_LINK, status: PAUSED }],
    });

    const body = await call(TOOL, {
      resource_names: [CAMPAIGN_LINK, AD_GROUP_LINK, CUSTOMER_LINK, ENABLED_LINK, REMOVED_LINK, MISSING_LINK],
      confirm: true,
    });

    expect(updateOps("campaignAssets.update")).toEqual([{ resource_name: CAMPAIGN_LINK, status: ENABLED }]);
    expect(updateOps("adGroupAssets.update")).toEqual([{ resource_name: AD_GROUP_LINK, status: ENABLED }]);
    expect(updateOps("customerAssets.update")).toEqual([{ resource_name: CUSTOMER_LINK, status: ENABLED }]);
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(3);
    expect(body.links).toHaveLength(6);
    expect(linkOf(body, CAMPAIGN_LINK)).toMatchObject({ outcome: "enabled", previous_status: "PAUSED", level: "campaign_asset", campaign_id: "31", asset_id: "501", field_type: "SITELINK", campaign_name: "Example campaign" });
    expect(linkOf(body, AD_GROUP_LINK)).toMatchObject({ outcome: "enabled", previous_status: "PAUSED", level: "ad_group_asset", ad_group_id: "41", ad_group_name: "Example ad group" });
    expect(linkOf(body, CUSTOMER_LINK)).toMatchObject({ outcome: "enabled", previous_status: "PAUSED", level: "customer_asset" });
    expect(linkOf(body, ENABLED_LINK)).toMatchObject({ outcome: "already_enabled", previous_status: "ENABLED" });
    expect(linkOf(body, REMOVED_LINK)).toMatchObject({ outcome: "removed", previous_status: "REMOVED" });
    expect(linkOf(body, MISSING_LINK)).toMatchObject({ outcome: "not_found", previous_status: null });
  });

  it("skips a link whose campaign or ad group is REMOVED, which would fail the whole batch", async () => {
    answerLinkState({
      campaign: [
        { rn: CAMPAIGN_LINK, status: PAUSED },
        { rn: ENABLED_LINK.replace("504", "508"), status: PAUSED, campaignStatus: enums.CampaignStatus.REMOVED },
      ],
      adGroup: [{ rn: AD_GROUP_LINK, status: PAUSED, adGroupStatus: enums.AdGroupStatus.REMOVED }],
    });
    const frozen = ENABLED_LINK.replace("504", "508");

    const body = await call(TOOL, { resource_names: [CAMPAIGN_LINK, frozen, AD_GROUP_LINK], confirm: true });

    expect(updateOps("campaignAssets.update")).toEqual([{ resource_name: CAMPAIGN_LINK, status: ENABLED }]);
    expect(recorder.callsTo("adGroupAssets.update")).toEqual([]);
    expect(linkOf(body, frozen).outcome).toBe("parent_removed");
    expect(linkOf(body, AD_GROUP_LINK).outcome).toBe("parent_removed");
  });

  it("labels the campaign and ad group of each link it enabled, and says the account-level link has no parent to label", async () => {
    answerLinkState({
      campaign: [{ rn: CAMPAIGN_LINK, status: PAUSED }, { rn: ENABLED_LINK, status: ENABLED }],
      adGroup: [{ rn: AD_GROUP_LINK, status: PAUSED }],
      customer: [{ rn: CUSTOMER_LINK, status: PAUSED }],
    });

    const body = await call(TOOL, { resource_names: [CAMPAIGN_LINK, AD_GROUP_LINK, CUSTOMER_LINK, ENABLED_LINK], confirm: true });

    // Campaign 32's link was already enabled: nothing changed there, no label.
    expect(auditLabelled("campaignLabels", "campaign")).toEqual([`customers/${CID}/campaigns/31`]);
    expect(auditLabelled("adGroupLabels", "ad_group")).toEqual([`customers/${CID}/adGroups/41`]);
    expect(linkOf(body, CAMPAIGN_LINK).audit_label).toBe(AUDIT_LABEL);
    expect(linkOf(body, AD_GROUP_LINK).audit_label).toBe(AUDIT_LABEL);
    expect(linkOf(body, CUSTOMER_LINK).audit_label).toBeNull();
    expect(body.audit_label).toBe(AUDIT_LABEL);
    expect(body.audit_label_note).toMatch(/campaign or ad group/);
    expect(body.audit_label_note).toMatch(/account-level/i);
  });

  it("labels each parent once, however many of its links it enabled", async () => {
    const second = `customers/${CID}/campaignAssets/31~509~CALLOUT`;
    answerLinkState({ campaign: [{ rn: CAMPAIGN_LINK, status: PAUSED }, { rn: second, status: PAUSED }] });

    await call(TOOL, { resource_names: [CAMPAIGN_LINK, second], confirm: true });

    expect(auditLabelled("campaignLabels", "campaign")).toEqual([`customers/${CID}/campaigns/31`]);
  });

  it("stamps the Pacific date: 22:30 PST on 11-21 on a UTC server is still claude-11-21-26", async () => {
    const savedTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      vi.setSystemTime(new Date("2026-11-22T06:30:00Z"));
      expect(new Date().getDate()).toBe(22); // the zone switch took effect
      answerLinkState({ campaign: [{ rn: CAMPAIGN_LINK, status: PAUSED }] });

      const body = await call(TOOL, { resource_names: [CAMPAIGN_LINK], confirm: true });

      expect(auditLabelled("campaignLabels", "campaign")).toEqual([`customers/${CID}/campaigns/31`]);
      expect(body.audit_label).toBe(AUDIT_LABEL);
      expect(recorder.queries().some((q) => q.includes("claude-11-22-26"))).toBe(false);
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });

  it("a label that fails does not undo the enable; that link reports audit_label null", async () => {
    answerLinkState({ campaign: [{ rn: CAMPAIGN_LINK, status: PAUSED }] });
    // A client error (code 400), so the resilience layer does not retry it.
    recorder.failMethod("campaignLabels.create", Object.assign(new Error("label refused"), { code: 400 }));

    const body = await call(TOOL, { resource_names: [CAMPAIGN_LINK], confirm: true });

    expect(updateOps("campaignAssets.update")).toEqual([{ resource_name: CAMPAIGN_LINK, status: ENABLED }]);
    expect(linkOf(body, CAMPAIGN_LINK)).toMatchObject({ outcome: "enabled", audit_label: null });
    expect(body.audit_label).toBeNull();
  });

  it("a failed update is reported on its links, the other levels still enable, and the call is an error", async () => {
    answerLinkState({
      campaign: [{ rn: CAMPAIGN_LINK, status: PAUSED }],
      adGroup: [{ rn: AD_GROUP_LINK, status: PAUSED }],
    });
    recorder.failMethod("adGroupAssets.update", Object.assign(new Error("RESOURCE_NOT_FOUND"), { code: 400 }));

    const result: any = await raw(TOOL, { resource_names: [CAMPAIGN_LINK, AD_GROUP_LINK], confirm: true });
    const body = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(body.success).toBe(false);
    expect(body.enabled).toBe(1);
    expect(body.failed).toBe(1);
    expect(linkOf(body, CAMPAIGN_LINK).outcome).toBe("enabled");
    expect(linkOf(body, AD_GROUP_LINK)).toMatchObject({ outcome: "failed", error: expect.stringMatching(/RESOURCE_NOT_FOUND/) });
    // Only the link that went live gets its parent labelled.
    expect(auditLabelled("adGroupLabels", "ad_group")).toEqual([]);
    expect(auditLabelled("campaignLabels", "campaign")).toEqual([`customers/${CID}/campaigns/31`]);
  });
});

describe(`${TOOL} refuses anything that is not an asset-link resource name, before any read`, () => {
  it.each<[string, Record<string, unknown>]>([
    ["a campaign", { resource_names: [`customers/${CID}/campaigns/31`] }],
    ["an asset", { resource_names: [`customers/${CID}/assets/501`] }],
    ["a campaign criterion", { resource_names: [`customers/${CID}/campaignCriteria/31~1001`] }],
    ["an asset-set link", { resource_names: [`customers/${CID}/campaignAssetSets/31~77`] }],
    ["a loose campaignAssets name", { resource_names: [`customers/${CID}/campaignAssets/abc`] }],
    ["a campaign link missing its field type", { resource_names: [`customers/${CID}/campaignAssets/31~501`] }],
    ["a campaign link missing its campaign id", { resource_names: [`customers/${CID}/campaignAssets/~501~SITELINK`] }],
    ["an unknown field type", { resource_names: [`customers/${CID}/campaignAssets/31~501~NOT_A_FIELD`] }],
    ["a trailing segment", { resource_names: [`customers/${CID}/adGroupAssets/41~502~CALLOUT/extra`] }],
    ["a GAQL-breaking quote", { resource_names: [`customers/${CID}/campaignAssets/31~501~SITELINK' OR '1'='1`] }],
    ["another account's link", { resource_names: [`customers/9999999999/campaignAssets/31~501~SITELINK`] }],
    ["an empty list", { resource_names: [] }],
    ["a non-string entry", { resource_names: [42] }],
    ["no resource_names", {}],
  ])("%s", async (_what, args) => {
    const result: any = await raw(TOOL, { ...args, confirm: true });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/resource_names|asset-link resource name|customer/);
    expect(recorder.calls).toEqual([]);
  });

  it("links from two accounts in one call", async () => {
    const result: any = await client.callTool({
      name: TOOL,
      arguments: { resource_names: [CAMPAIGN_LINK, `customers/9999999999/customerAssets/503~CALLOUT`], confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/one account|customer/);
    expect(recorder.calls).toEqual([]);
  });
});

describe(`${TOOL} never turns on a lead form unless it was explicitly asked for`, () => {
  it("refuses a LEAD_FORM link without explicit_lead_form_request, before any read", async () => {
    const result: any = await raw(TOOL, { resource_names: [CAMPAIGN_LINK, LEAD_FORM_LINK], confirm: true });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/explicitly asked/);
    expect(recorder.calls).toEqual([]);
  });

  it("enables a LEAD_FORM link when explicit_lead_form_request is true", async () => {
    answerLinkState({ campaign: [{ rn: LEAD_FORM_LINK, status: PAUSED }] });

    const body = await call(TOOL, { resource_names: [LEAD_FORM_LINK], explicit_lead_form_request: true, confirm: true });

    expect(updateOps("campaignAssets.update")).toEqual([{ resource_name: LEAD_FORM_LINK, status: ENABLED }]);
    expect(linkOf(body, LEAD_FORM_LINK).outcome).toBe("enabled");
  });
});
