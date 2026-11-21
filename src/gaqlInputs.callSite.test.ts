/**
 * Caller-supplied ids, dates and enum values that are interpolated into GAQL
 * are refused at the CallTool dispatch before any query or write.
 *
 * `campaign.id = ${campaignId}` went into GAQL raw at five sites (review
 * 2026-11-14, gap 7), plus report date ranges, the experiment resource name
 * and the experiment status filter. Each case below passes a malicious value
 * through the real dispatch and asserts the server refused it without making
 * a single call on the client: no query (so nothing was read with an
 * attacker-shaped WHERE clause) and no write.
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

const BAD_ID = "1 OR campaign.id > 0";
const BAD_DATE = "2026-01-01' OR segments.date > '2000-01-01";

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "gaql-inputs-call-site-test", version: "0.0.0" }, { capabilities: {} });
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

async function callText(name: string, args: Record<string, unknown>): Promise<string> {
  const result: any = await client.callTool({ name, arguments: { customer_id: FAKE_CUSTOMER_ID, ...args } });
  return result.content[0].text as string;
}

const DATES = { start_date: "2026-01-01", end_date: "2026-01-31" };

const REFUSED: Array<[string, Record<string, unknown>, RegExp]> = [
  ["google_ads_get_campaign_tracking", { campaign_id: BAD_ID }, /campaign_id must be a numeric id/],
  ["google_ads_update_campaign_tracking", { campaign_id: BAD_ID, final_url_suffix: "a=b" }, /campaign_id must be a numeric id/],
  ["google_ads_update_campaign_budget", { campaign_id: BAD_ID, daily_budget: 10 }, /campaign_id must be a numeric id/],
  ["google_ads_detach_portfolio_bid_strategy", { campaign_id: BAD_ID, confirm: true }, /campaign_id must be a numeric id/],
  ["google_ads_update_campaign_bidding", { campaign_id: BAD_ID, strategy: "MANUAL_CPC" }, /campaign_id must be a numeric id/],
  ["google_ads_update_campaign_ad_rotation", { campaign_id: BAD_ID, mode: "OPTIMIZE", confirm: true }, /campaign_id must be a numeric id/],
  ["google_ads_create_page_feed", { campaign_id: BAD_ID, name: "Feed", urls: ["https://example.com/a"] }, /campaign_id must be a numeric id/],
  ["google_ads_get_experiment", { experiment_id: "1' OR experiment.name != '" }, /experiment_id must be a numeric id/],
  ["google_ads_list_experiments", { status_filter: "ENABLED' OR experiment.status != 'X" }, /status_filter must be one of/],
  ...(
    [
      "google_ads_keyword_performance",
      "google_ads_keyword_performance_by_conversion",
      "google_ads_search_term_report",
      "google_ads_search_term_report_by_conversion",
      "google_ads_ad_performance",
      "google_ads_ad_performance_by_conversion",
    ].flatMap((tool): Array<[string, Record<string, unknown>, RegExp]> => [
      [tool, { ...DATES, start_date: BAD_DATE }, /start_date must be a date in YYYY-MM-DD form/],
      [tool, { ...DATES, end_date: BAD_DATE }, /end_date must be a date in YYYY-MM-DD form/],
    ])
  ),
];

describe("GAQL inputs are refused at the CallTool dispatch before any client call", () => {
  it.each(REFUSED)("%s refuses %j", async (name, args, message) => {
    const text = await callText(name, args);

    expect(text).toMatch(message);
    expect(recorder.calls).toEqual([]);
  });

  it("a numeric campaign id still reaches the query (the recorder is on the path)", async () => {
    await callText("google_ads_get_campaign_tracking", { campaign_id: "123" });

    expect(recorder.queries().some((q) => /WHERE campaign\.id = 123\s*$/.test(q))).toBe(true);
  });

  it("a valid date range still reaches the report query", async () => {
    await callText("google_ads_ad_performance", DATES);

    expect(recorder.queries().some((q) => q.includes("BETWEEN '2026-01-01' AND '2026-01-31'"))).toBe(true);
  });

  it("a listed experiment status still reaches the query", async () => {
    await callText("google_ads_list_experiments", { status_filter: "ENABLED" });

    expect(recorder.queries().some((q) => q.includes("AND experiment.status = 'ENABLED'"))).toBe(true);
  });
});
