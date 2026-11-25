/**
 * google_ads_list_pending_changes lists paused, claude-labelled keywords.
 *
 * google_ads_create_keywords says its PAUSED keywords can be found there, but
 * only campaigns, ad groups and ads were queried. Those three queries could
 * not run either: they selected label.name FROM campaign, ad_group and
 * ad_group_ad, and the Google Ads API joins `label` only to the *_label
 * resources ("Cannot select fields from the following resource: 'LABEL',
 * since the resource is incompatible with the resource in FROM clause").
 *
 * The fake answers below apply that rule, from the attributed-resource lists
 * in Google's field reference, so a query Google would refuse fails here.
 *
 * Containment: GoogleAdsApi and the credential chain are the recording fakes
 * in tests/helpers/recordingGoogleAds.ts and fetch is stubbed to throw.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/** https://developers.google.com/google-ads/api/fields/v24/overview, "Attributed resources". */
const SELECTABLE_FROM: Record<string, string[]> = {
  campaign: ["accessible_bidding_strategy", "bidding_strategy", "campaign_budget", "campaign_group", "customer"],
  ad_group: ["campaign", "customer"],
  ad_group_ad: ["ad_group", "campaign", "customer"],
  ad_group_criterion: ["ad_group", "campaign", "customer"],
  campaign_label: ["campaign", "customer", "label"],
  ad_group_label: ["ad_group", "campaign", "customer", "label"],
  ad_group_ad_label: ["ad_group", "ad_group_ad", "campaign", "customer", "label"],
  ad_group_criterion_label: ["ad_group", "ad_group_criterion", "campaign", "customer", "label"],
};

function fromOf(gaql: string): string {
  return gaql.match(/\bFROM\s+([a-z_]+)/)![1];
}

/** Refuse a query that uses a resource its FROM resource cannot be joined to, as Google does. */
function checkSelectable(gaql: string): void {
  const from = fromOf(gaql);
  const allowed = new Set([from, ...(SELECTABLE_FROM[from] ?? [])]);
  const withoutStrings = gaql.replace(/'[^']*'/g, "''");
  for (const [, resource] of withoutStrings.matchAll(/\b([a-z_]+)\.[a-z_]/g)) {
    if (!allowed.has(resource)) {
      throw Object.assign(
        new Error(`Cannot select fields from the following resource: '${resource.toUpperCase()}', since the resource is incompatible with the resource in FROM clause.`),
        { code: 3 },
      );
    }
  }
}

const RN = `customers/${FAKE_CUSTOMER_ID}`;
const LABEL = { name: "claude-11-24-26" };
const ROWS: Record<string, any[]> = {
  campaign_label: [{ campaign: { id: 11, name: "Brand", status: "PAUSED" }, label: LABEL }],
  ad_group_label: [{ ad_group: { id: 22, name: "Core", status: "PAUSED" }, campaign: { name: "Brand" }, label: LABEL }],
  ad_group_ad_label: [{ ad_group_ad: { ad: { id: 33 }, status: "PAUSED" }, ad_group: { name: "Core" }, campaign: { name: "Brand" }, label: LABEL }],
  ad_group_criterion_label: [
    {
      ad_group_criterion: {
        resource_name: `${RN}/adGroupCriteria/22~44`,
        criterion_id: 44,
        keyword: { text: "blue widgets", match_type: "PHRASE" },
        status: "PAUSED",
      },
      ad_group: { name: "Core" },
      campaign: { name: "Brand" },
      label: LABEL,
    },
  ],
};

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "pending-changes-call-site-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  recorder.reset();
  recorder.answerQuery(/./, (gaql) => {
    checkSelectable(gaql);
    return ROWS[fromOf(gaql)] ?? [];
  });
});

async function listPending(): Promise<any> {
  const result: any = await client.callTool({
    name: "google_ads_list_pending_changes",
    arguments: { customer_id: FAKE_CUSTOMER_ID },
  });
  expect(result.isError, result.content[0].text).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

/** The one query sent for a resource, whitespace collapsed. */
function queryFrom(resource: string): string {
  const sent = recorder.queries().map((q) => q.replace(/\s+/g, " ")).filter((q) => fromOf(q) === resource);
  expect(sent, `queries FROM ${resource}`).toHaveLength(1);
  return sent[0];
}

describe("google_ads_list_pending_changes", () => {
  it("returns paused, claude-labelled keywords with what it takes to review and enable them", async () => {
    const pending = await listPending();
    expect(pending.keywords).toEqual(ROWS.ad_group_criterion_label);

    const q = queryFrom("ad_group_criterion_label");
    const select = q.slice(0, q.indexOf(" FROM "));
    for (const field of [
      "ad_group_criterion.resource_name",
      "ad_group_criterion.keyword.text",
      "ad_group_criterion.keyword.match_type",
      "ad_group_criterion.status",
      "ad_group.name",
      "campaign.name",
      "label.name",
    ]) {
      expect(select).toMatch(new RegExp(`[ ,]${field.replace(/\./g, "\\.")}(,|$)`));
    }
    const where = q.slice(q.indexOf(" WHERE "));
    expect(where).toContain("ad_group_criterion.status = 'PAUSED'");
    expect(where).toContain("ad_group_criterion.type = 'KEYWORD'");
    expect(where).toContain("label.name LIKE 'claude-%'");
  });

  it.each([
    ["campaigns", "campaign_label", "campaign.status = 'PAUSED'"],
    ["adGroups", "ad_group_label", "ad_group.status = 'PAUSED'"],
    ["ads", "ad_group_ad_label", "ad_group_ad.status = 'PAUSED'"],
  ])("still returns %s, joined to their labels through %s", async (key, resource, status) => {
    const pending = await listPending();
    expect(pending[key]).toEqual(ROWS[resource]);

    const where = queryFrom(resource).split(" WHERE ")[1];
    expect(where).toContain(status);
    expect(where).toContain("label.name LIKE 'claude-%'");
  });

  it("reads only", async () => {
    await listPending();
    expect(recorder.writes()).toEqual([]);
  });

  it("the fake refuses what Google refuses: label FROM campaign", () => {
    expect(() => checkSelectable("SELECT campaign.id, label.name FROM campaign WHERE label.name LIKE 'claude-%'")).toThrow(/'LABEL'.*incompatible/);
  });
});

describe("what the tools say about it", () => {
  it("google_ads_list_pending_changes names keywords, as google_ads_create_keywords promises", async () => {
    const { tools } = await client.listTools();
    const description = (name: string) => tools.find((t) => t.name === name)!.description!;
    expect(description("google_ads_list_pending_changes")).toMatch(/keywords/);
  });
});
