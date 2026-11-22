/**
 * Asset-link creates and pauses label what they changed, and the ad-group
 * link tool sees a link that already exists PAUSED. Driven through the real
 * CallTool dispatch in src/index.ts.
 *
 * After #104 the three link_asset_to_* creates and google_ads_pause_asset_links
 * applied no claude-MM-DD-YY label: only the enable did. An asset link has no
 * label surface, so, as the enable does, each create and pause now labels the
 * campaign or ad group the link belongs to; an account-level link has no
 * parent and says so (audit_label: null). A link created PAUSED and enabled
 * the same day labels the same parent twice, and Google refuses a label a
 * resource already has, so a parent that already carries today's label is
 * skipped instead of failing the whole attach.
 *
 * The ad-group tool's read asked for ENABLED links only, so a link that
 * already existed PAUSED looked absent and the create failed as a duplicate.
 * The query answers below apply the query's own status filter the way Google
 * does, so a read that still asks for ENABLED only cannot see the PAUSED row.
 *
 * Containment: GoogleAdsApi and the credential chain are the recording fakes
 * in tests/helpers/recordingGoogleAds.ts and fetch is stubbed to throw, so
 * nothing here reaches Google Ads, the network, the credentials file or the
 * Keychain. Every id is made up.
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
const AUDIT_LABEL_RN = `customers/${CID}/labels/900`;

const PAUSED = enums.AssetLinkStatus.PAUSED;
const ENABLED = enums.AssetLinkStatus.ENABLED;
const REMOVED = enums.AssetLinkStatus.REMOVED;

/** Made-up ids: campaigns 31-32, ad groups 41-43, assets 501-513. */
const campaignRN = (id: string) => `customers/${CID}/campaigns/${id}`;
const adGroupRN = (id: string) => `customers/${CID}/adGroups/${id}`;
const CAMPAIGN_LINK = `customers/${CID}/campaignAssets/31~501~SITELINK`;
const SECOND_CAMPAIGN_LINK = `customers/${CID}/campaignAssets/31~509~CALLOUT`;
const AD_GROUP_LINK = `customers/${CID}/adGroupAssets/41~502~CALLOUT`;
const CUSTOMER_LINK = `customers/${CID}/customerAssets/503~STRUCTURED_SNIPPET`;

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "asset-link-labels-call-site-test", version: "0.0.0" }, { capabilities: {} });
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

/** Every op handed to one service method ("adGroupAssets.create"). */
function ops(method: string): any[] {
  return recorder.callsTo(method).flatMap((c) => c.args[0]);
}

/** Resources that received `labelRN` through one label service. */
function labelled(service: "campaignLabels" | "adGroupLabels", field: "campaign" | "ad_group", labelRN = AUDIT_LABEL_RN): string[] {
  return ops(`${service}.create`).filter((op: any) => op.label === labelRN).map((op: any) => op[field]);
}

/** Every label attach of any kind (campaign, ad group, ad, criterion, customer). */
function labelWrites(): string[] {
  return recorder.writes().map((w) => w.method).filter((m) => /Labels\.create$/.test(m));
}

/** Does a GAQL WHERE on `field` admit `value`? Emulates =, !=, IN and NOT IN; no predicate admits all. */
function admits(gaql: string, field: string, value: string): boolean {
  const f = field.replace(/\./g, "\\.");
  const list = (s: string) => s.split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
  const notIn = gaql.match(new RegExp(`${f}\\s+NOT\\s+IN\\s*\\(([^)]*)\\)`, "i"));
  if (notIn) return !list(notIn[1]).includes(value);
  const inList = gaql.match(new RegExp(`${f}\\s+IN\\s*\\(([^)]*)\\)`, "i"));
  if (inList) return list(inList[1]).includes(value);
  const ne = gaql.match(new RegExp(`${f}\\s*!=\\s*'([^']*)'`));
  if (ne) return value !== ne[1];
  const eq = gaql.match(new RegExp(`${f}\\s*=\\s*'([^']*)'`));
  if (eq) return value === eq[1];
  return true;
}

/** The ad-group tool's read of the ad groups themselves. */
function answerAdGroups(ids: string[]): void {
  recorder.answerQuery(/FROM ad_group\s+WHERE\s+ad_group\.id IN/, ids.map((id) => ({
    ad_group: { id: Number(id), name: `Example ad group ${id}`, resource_name: adGroupRN(id) },
    campaign: { name: "Example campaign" },
  })));
}

/** Existing ad-group links, returned only where the query's own WHERE admits them, as Google would. */
function answerAdGroupLinks(links: Array<{ adGroup: string; asset: string; status: number; fieldType: string }>): void {
  recorder.answerQuery(/FROM ad_group_asset\b/, (gaql) =>
    links
      .filter((l) => admits(gaql, "ad_group_asset.status", enums.AssetLinkStatus[l.status] as string))
      .filter((l) => admits(gaql, "ad_group_asset.field_type", l.fieldType))
      .map((l) => ({
        ad_group_asset: {
          resource_name: `customers/${CID}/adGroupAssets/${l.adGroup}~${l.asset}~${l.fieldType}`,
          ad_group: adGroupRN(l.adGroup),
          asset: `customers/${CID}/assets/${l.asset}`,
          field_type: (enums.AssetFieldType as any)[l.fieldType],
          status: l.status,
        },
      })),
  );
}

/** Parents that already carry a label, answered only for the label and parents the query names. */
function answerExistingParentLabels(kind: "campaign" | "ad_group", parents: string[], labelRN = AUDIT_LABEL_RN): void {
  const table = kind === "campaign" ? "campaign_label" : "ad_group_label";
  recorder.answerQuery(new RegExp(`FROM ${table}\\b`), (gaql) =>
    parents
      .filter((p) => admits(gaql, `${table}.label`, labelRN) && admits(gaql, `${table}.${kind}`, p))
      .map((p) => ({ [table]: { [kind]: p, label: labelRN } })),
  );
}

function row(body: any, adGroupId: string): any {
  const r = (body.ad_groups ?? []).find((a: any) => a.ad_group_id === adGroupId);
  expect(r, `no ad_groups row for ${adGroupId} in ${JSON.stringify(body)}`).toBeDefined();
  return r;
}

describe("google_ads_link_asset_to_ad_group sees a link that already exists PAUSED", () => {
  it("reports it as already linked, with its status, and does not create it again", async () => {
    answerAdGroups(["41", "42"]);
    answerAdGroupLinks([{ adGroup: "41", asset: "502", status: PAUSED, fieldType: "CALLOUT" }]);

    const body = await call("google_ads_link_asset_to_ad_group", {
      asset_id: "502", ad_group_ids: ["41", "42"], field_type: "CALLOUT", confirm: true,
    });

    expect(ops("adGroupAssets.create").map((op: any) => op.ad_group)).toEqual([adGroupRN("42")]);
    expect(body.linked).toBe(1);
    expect(body.skipped_already_linked).toEqual(["41"]);
    expect(row(body, "41")).toMatchObject({ already_linked: true, existing_link_status: "PAUSED", link_status: "PAUSED" });
    expect(row(body, "42")).toMatchObject({ already_linked: false, link_status: "PAUSED" });
    expect(row(body, "42").existing_link_status).toBeUndefined();
  });

  it("the dry run says so too, and writes nothing", async () => {
    answerAdGroups(["41"]);
    answerAdGroupLinks([{ adGroup: "41", asset: "502", status: PAUSED, fieldType: "CALLOUT" }]);

    const body = await call("google_ads_link_asset_to_ad_group", { asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT" });

    expect(body.dry_run).toBe(true);
    expect(row(body, "41")).toMatchObject({ already_linked: true, existing_link_status: "PAUSED" });
    expect(recorder.writes()).toEqual([]);
  });

  it("a PAUSED link does not serve: the counts and the under-4 warning describe the ad group once it is enabled", async () => {
    answerAdGroups(["41"]);
    answerAdGroupLinks([
      { adGroup: "41", asset: "511", status: ENABLED, fieldType: "SITELINK" },
      { adGroup: "41", asset: "512", status: ENABLED, fieldType: "SITELINK" },
      { adGroup: "41", asset: "513", status: PAUSED, fieldType: "SITELINK" },
      { adGroup: "41", asset: "501", status: PAUSED, fieldType: "SITELINK" },
    ]);

    const body = await call("google_ads_link_asset_to_ad_group", { asset_id: "501", ad_group_ids: ["41"], field_type: "SITELINK" });

    expect(row(body, "41")).toMatchObject({
      already_linked: true,
      existing_link_status: "PAUSED",
      current_enabled_count: 2,
      resulting_enabled_count: 3,
    });
    expect(body.warnings).toHaveLength(1);
  });

  it("an ENABLED link is still reported as ENABLED", async () => {
    answerAdGroups(["41"]);
    answerAdGroupLinks([{ adGroup: "41", asset: "502", status: ENABLED, fieldType: "CALLOUT" }]);

    const body = await call("google_ads_link_asset_to_ad_group", {
      asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT", confirm: true,
    });

    expect(recorder.callsTo("adGroupAssets.create")).toEqual([]);
    expect(row(body, "41")).toMatchObject({ already_linked: true, existing_link_status: "ENABLED", link_status: "ENABLED" });
  });

  it("a REMOVED link is not a link: the asset is linked again", async () => {
    answerAdGroups(["41"]);
    answerAdGroupLinks([{ adGroup: "41", asset: "502", status: REMOVED, fieldType: "CALLOUT" }]);

    const body = await call("google_ads_link_asset_to_ad_group", {
      asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT", confirm: true,
    });

    expect(ops("adGroupAssets.create").map((op: any) => op.ad_group)).toEqual([adGroupRN("41")]);
    expect(row(body, "41").already_linked).toBe(false);
  });
});

describe("the link_asset_to_* creates label the campaign or ad group they linked", () => {
  it("link_asset_to_campaign labels each campaign it linked, and returns the label and why it went on the campaign", async () => {
    const body = await call("google_ads_link_asset_to_campaign", {
      asset_id: "501", campaign_ids: ["31", "32"], field_type: "SITELINK", confirm: true,
    });

    expect(ops("campaignAssets.create")).toHaveLength(2);
    expect(labelled("campaignLabels", "campaign")).toEqual([campaignRN("31"), campaignRN("32")]);
    expect(body).toMatchObject({
      success: true,
      status: "PAUSED",
      audit_label: AUDIT_LABEL,
      audit_label_note: expect.stringMatching(/campaign or ad group/),
      resource_names: expect.any(Array),
      enable_path: expect.stringMatching(/google_ads_enable_asset_links/),
    });
  });

  it("link_asset_to_ad_group labels the ad groups it linked, not the ones it skipped", async () => {
    answerAdGroups(["41", "42", "43"]);
    answerAdGroupLinks([{ adGroup: "43", asset: "502", status: ENABLED, fieldType: "CALLOUT" }]);

    const body = await call("google_ads_link_asset_to_ad_group", {
      asset_id: "502", ad_group_ids: ["41", "42", "43"], field_type: "CALLOUT", confirm: true,
    });

    expect(labelled("adGroupLabels", "ad_group")).toEqual([adGroupRN("41"), adGroupRN("42")]);
    expect(body).toMatchObject({
      success: true,
      status: "PAUSED",
      audit_label: AUDIT_LABEL,
      audit_label_note: expect.stringMatching(/campaign or ad group/),
      resource_names: expect.any(Array),
    });
  });

  it("link_asset_to_ad_group applies the caller's audit_label when one is given", async () => {
    const custom = "claude-11-21-26-brand-callouts";
    const customRN = `customers/${CID}/labels/901`;
    recorder.answerQuery(new RegExp(`label\\.name = '${custom}'`), [{ label: { resource_name: customRN, name: custom } }]);
    answerAdGroups(["41"]);

    const body = await call("google_ads_link_asset_to_ad_group", {
      asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT", audit_label: custom, confirm: true,
    });

    expect(labelled("adGroupLabels", "ad_group", customRN)).toEqual([adGroupRN("41")]);
    expect(labelled("adGroupLabels", "ad_group")).toEqual([]);
    expect(body.audit_label).toBe(custom);
  });

  it("link_asset_to_ad_group with nothing to link labels nothing", async () => {
    answerAdGroups(["41"]);
    answerAdGroupLinks([{ adGroup: "41", asset: "502", status: PAUSED, fieldType: "CALLOUT" }]);

    const body = await call("google_ads_link_asset_to_ad_group", {
      asset_id: "502", ad_group_ids: ["41"], field_type: "CALLOUT", confirm: true,
    });

    expect(recorder.writes()).toEqual([]);
    expect(body.linked).toBe(0);
    expect(body.audit_label).toBeNull();
  });

  it("link_asset_to_customer has no parent to label: audit_label null, and the result says why", async () => {
    const body = await call("google_ads_link_asset_to_customer", { asset_id: "503", field_type: "STRUCTURED_SNIPPET", confirm: true });

    expect(ops("customerAssets.create")).toHaveLength(1);
    expect(labelWrites()).toEqual([]);
    expect(body).toMatchObject({ success: true, status: "PAUSED", audit_label: null });
    expect(body.audit_label_note).toMatch(/account-level/i);
  });

  it("stamps the Pacific date: 22:30 PST on 11-21 on a UTC server is still claude-11-21-26", async () => {
    const savedTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      vi.setSystemTime(new Date("2026-11-22T06:30:00Z"));
      expect(new Date().getDate()).toBe(22); // the zone switch took effect

      const body = await call("google_ads_link_asset_to_campaign", {
        asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK", confirm: true,
      });

      expect(labelled("campaignLabels", "campaign")).toEqual([campaignRN("31")]);
      expect(body.audit_label).toBe(AUDIT_LABEL);
      expect(recorder.queries().some((q) => q.includes("claude-11-22-26"))).toBe(false);
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });

  it("a label that fails does not undo the link; the result reports audit_label null", async () => {
    // A client error (code 400), so the resilience layer does not retry it.
    recorder.failMethod("campaignLabels.create", Object.assign(new Error("label refused"), { code: 400 }));

    const body = await call("google_ads_link_asset_to_campaign", {
      asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK", confirm: true,
    });

    expect(ops("campaignAssets.create")).toHaveLength(1);
    expect(body.success).toBe(true);
    expect(body.audit_label).toBeNull();
  });

  it("a create that fails labels nothing", async () => {
    recorder.failMethod("campaignAssets.create", Object.assign(new Error("RESOURCE_ALREADY_EXISTS"), { code: 400 }));

    const result: any = await raw("google_ads_link_asset_to_campaign", {
      asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK", confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/RESOURCE_ALREADY_EXISTS/);
    expect(labelWrites()).toEqual([]);
  });
});

describe("google_ads_pause_asset_links labels the campaign or ad group of each link it paused", () => {
  it("labels each parent once and says the account-level link has none", async () => {
    const body = await call("google_ads_pause_asset_links", {
      resource_names: [CAMPAIGN_LINK, SECOND_CAMPAIGN_LINK, AD_GROUP_LINK, CUSTOMER_LINK],
      confirm: true,
    });

    expect(ops("campaignAssets.update")).toEqual([
      { resource_name: CAMPAIGN_LINK, status: PAUSED },
      { resource_name: SECOND_CAMPAIGN_LINK, status: PAUSED },
    ]);
    expect(labelled("campaignLabels", "campaign")).toEqual([campaignRN("31")]);
    expect(labelled("adGroupLabels", "ad_group")).toEqual([adGroupRN("41")]);
    expect(body).toMatchObject({
      success: true,
      paused: { campaign_asset: 2, ad_group_asset: 1, customer_asset: 1 },
      audit_label: AUDIT_LABEL,
      audit_label_note: expect.stringMatching(/campaign or ad group/),
    });
    expect(body.audit_label_note).toMatch(/account-level/i);
  });

  it("account-level links only: nothing to label, audit_label null", async () => {
    const body = await call("google_ads_pause_asset_links", { resource_names: [CUSTOMER_LINK], confirm: true });

    expect(ops("customerAssets.update")).toEqual([{ resource_name: CUSTOMER_LINK, status: PAUSED }]);
    expect(labelWrites()).toEqual([]);
    expect(body.audit_label).toBeNull();
    expect(body.audit_label_note).toMatch(/account-level/i);
  });

  it("a level whose pause fails gets no label", async () => {
    recorder.failMethod("adGroupAssets.update", Object.assign(new Error("RESOURCE_NOT_FOUND"), { code: 400 }));

    const result: any = await raw("google_ads_pause_asset_links", { resource_names: [AD_GROUP_LINK], confirm: true });

    expect(result.isError).toBe(true);
    expect(recorder.callsTo("adGroupAssets.update")).toHaveLength(1);
    expect(labelWrites()).toEqual([]);
  });

  it("the dry run writes nothing", async () => {
    const body = await call("google_ads_pause_asset_links", { resource_names: [CAMPAIGN_LINK, AD_GROUP_LINK] });

    expect(body.dry_run).toBe(true);
    expect(recorder.writes()).toEqual([]);
  });
});

describe("a parent that already carries today's label is not labeled again", () => {
  it("enabling a link created the same day: the ad group already has the label, so no second attach", async () => {
    recorder.answerQuery(/FROM ad_group_asset\b/, [{
      ad_group_asset: { resource_name: AD_GROUP_LINK, status: PAUSED },
      ad_group: { name: "Example ad group", status: enums.AdGroupStatus.ENABLED },
      campaign: { name: "Example campaign" },
    }]);
    answerExistingParentLabels("ad_group", [adGroupRN("41")]);

    const body = await call("google_ads_enable_asset_links", { resource_names: [AD_GROUP_LINK], confirm: true });

    expect(ops("adGroupAssets.update")).toEqual([{ resource_name: AD_GROUP_LINK, status: ENABLED }]);
    expect(recorder.callsTo("adGroupLabels.create")).toEqual([]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
    expect(body.links[0]).toMatchObject({ outcome: "enabled", audit_label: AUDIT_LABEL });
  });

  it("a campaign create attaches the label only to the campaigns that lack it", async () => {
    answerExistingParentLabels("campaign", [campaignRN("31")]);

    const body = await call("google_ads_link_asset_to_campaign", {
      asset_id: "501", campaign_ids: ["31", "32"], field_type: "SITELINK", confirm: true,
    });

    expect(labelled("campaignLabels", "campaign")).toEqual([campaignRN("32")]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("only exact campaign names reach the label read: a malformed campaign id is not put into GAQL", async () => {
    // link_asset_to_campaign does not validate campaign_ids (Google refuses a bad one at the create;
    // the fake accepts it), so the label path is the last place it could reach a query.
    const bad = "31' OR '1'='1";

    const body = await call("google_ads_link_asset_to_campaign", {
      asset_id: "501", campaign_ids: [bad, "32"], field_type: "SITELINK", confirm: true,
    });

    expect(recorder.queries().some((q) => q.includes("OR '1'='1"))).toBe(false);
    expect(labelled("campaignLabels", "campaign")).toEqual([campaignRN("32")]);
    expect(body.audit_label).toBe(AUDIT_LABEL);
  });

  it("a label held by another label id does not count: the parent is still labeled", async () => {
    answerExistingParentLabels("campaign", [campaignRN("31")], `customers/${CID}/labels/777`);

    await call("google_ads_link_asset_to_campaign", { asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK", confirm: true });

    expect(labelled("campaignLabels", "campaign")).toEqual([campaignRN("31")]);
  });
});
