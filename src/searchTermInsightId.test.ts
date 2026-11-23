/**
 * Search-term insight category ids are int64. A 19-digit id is past
 * Number.MAX_SAFE_INTEGER, and google-ads-api's REST parser turns every INT64
 * field into a Number, so ...299648 came back as ...300000 and the drill-down
 * into google_ads_search_term_insight_terms matched nothing. The id has to stay
 * a string from the API response to the tool output and back into the GAQL.
 *
 * Containment: the REAL google-ads-api Customer, with `paginatedSearch`
 * replaced on its prototype. The stub runs REST-shaped rows (camelCase keys,
 * int64 as JSON strings, as the REST API sends them) through the library's own
 * parser, so the rounding under test is the library's, not a copy.
 * `getAccessToken` / `getCredentials` throw, so nothing can reach Google.
 * Request-log lines go to a temp file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleAdsApi, Customer } from "google-ads-api";

import { GoogleAdsManager } from "./index.js";
import { exactInsightId } from "./searchTermInsightId.js";

const requireCjs = createRequire(import.meta.url);
const { Service } = requireCjs("google-ads-api/build/src/service.js");
const { decamelizeKeys } = requireCjs("google-ads-api/build/src/parserRest.js");

const CID = "1234567890";
const CAMPAIGN = "111222333";
// 19 digits, past 2^53: as a double it reads 2345678901234300000.
const CATEGORY_ID = "2345678901234299648";
const SMALL_ID = "4242";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gads-sti-"));
  vi.stubEnv("GOOGLE_ADS_REQUEST_LOG_PATH", path.join(dir, "requests.jsonl"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** One REST row as the API sends it. resourceName only when the GAQL selects it. */
function restRow(gaql: string, id: string, label: string, extra: Record<string, unknown> = {}) {
  const insight: Record<string, unknown> = { campaignId: CAMPAIGN, categoryLabel: label, id };
  if (gaql.includes("campaign_search_term_insight.resource_name")) {
    insight.resourceName = `customers/${CID}/campaignSearchTermInsights/${CAMPAIGN}~${id}`;
  }
  return { campaignSearchTermInsight: insight, metrics: { clicks: "12", impressions: "340", conversions: 1.5, conversionsValue: 3 }, ...extra };
}

function stubSearch(rowsFor: (gaql: string) => any[]) {
  const queries: string[] = [];
  vi.spyOn(Customer.prototype as any, "paginatedSearch").mockImplementation(async (gaql: any) => {
    queries.push(String(gaql));
    return { response: rowsFor(String(gaql)).map((r) => decamelizeKeys(r)) };
  });
  vi.spyOn(Service.prototype, "getAccessToken").mockImplementation(async () => {
    throw new Error("containment: getAccessToken reached");
  });
  vi.spyOn(Service.prototype, "getCredentials").mockImplementation(() => {
    throw new Error("containment: getCredentials reached");
  });
  return queries;
}

function manager(): GoogleAdsManager {
  const mgr = Object.create(GoogleAdsManager.prototype) as any;
  mgr.api = new GoogleAdsApi({ client_id: "fake-client", client_secret: "fake-secret", developer_token: "fake-dev-token" });
  mgr.config = { clients: {}, google_ads: { mcc_customer_id: "999-888-7777" } };
  mgr.defaultRefreshToken = "fake-refresh";
  return mgr as GoogleAdsManager;
}

describe("the library really does round the id (guards the fixture)", () => {
  it("a parsed INT64 id loses its low digits", () => {
    const parsed = decamelizeKeys({ campaignSearchTermInsight: { id: CATEGORY_ID } });
    expect(String(parsed.campaign_search_term_insight.id)).toBe("2345678901234300000");
  });
});

describe("google_ads_search_term_insights keeps category ids exact", () => {
  it("returns the 19-digit insight_id as the exact string", async () => {
    stubSearch((gaql) => [restRow(gaql, CATEGORY_ID, "cloud security"), restRow(gaql, SMALL_ID, "dlp")]);
    const out: any = await manager().getSearchTermInsights(CID, { campaignId: CAMPAIGN, startDate: "2026-11-01", endDate: "2026-11-21" });
    const byLabel = Object.fromEntries(out.categories.map((c: any) => [c.category, c.insight_id]));
    expect(byLabel).toEqual({ "cloud security": CATEGORY_ID, dlp: SMALL_ID });
    expect(JSON.stringify(out)).toContain(`"insight_id":"${CATEGORY_ID}"`);
  });

  it("the id it returns drills down: insight_terms queries with the same digits and echoes them back", async () => {
    const queries = stubSearch((gaql) => [restRow(gaql, CATEGORY_ID, "cloud security", { segments: { searchTerm: "casb vendors" } })]);
    const mgr = manager();
    const insights: any = await mgr.getSearchTermInsights(CID, { campaignId: CAMPAIGN, startDate: "2026-11-01", endDate: "2026-11-21" });
    const insightId = insights.categories[0].insight_id;

    const terms: any = await mgr.getSearchTermInsightTerms(CID, {
      campaignId: CAMPAIGN,
      insightId,
      startDate: "2026-11-01",
      endDate: "2026-11-21",
    });
    const termsQuery = queries[queries.length - 1];
    expect(termsQuery).toContain(`campaign_search_term_insight.id = '${CATEGORY_ID}'`);
    expect(terms).toHaveLength(1);
    expect(terms[0].campaign_search_term_insight.id).toBe(CATEGORY_ID);
    expect(terms[0].segments.search_term).toBe("casb vendors");
  });

  it("insight_terms refuses an insight_id that arrives as an already-rounded number, and makes no call", async () => {
    const queries = stubSearch(() => []);
    await expect(
      manager().getSearchTermInsightTerms(CID, {
        campaignId: CAMPAIGN,
        insightId: Number(CATEGORY_ID) as any,
        startDate: "2026-11-01",
        endDate: "2026-11-21",
      }),
    ).rejects.toThrow(/insight_id must be passed as a string/);
    expect(queries).toEqual([]);
  });
});

describe("exactInsightId", () => {
  it("reads the id from the resource name, not the rounded number", () => {
    expect(
      exactInsightId({
        resource_name: `customers/${CID}/campaignSearchTermInsights/${CAMPAIGN}~${CATEGORY_ID}`,
        id: Number(CATEGORY_ID),
      }),
    ).toBe(CATEGORY_ID);
  });

  it("falls back to a safe-integer id when there is no resource name", () => {
    expect(exactInsightId({ id: 4242 })).toBe("4242");
    expect(exactInsightId({ id: "4242" })).toBe("4242");
  });

  it("never returns a rounded id: an unsafe number with no resource name is null", () => {
    expect(exactInsightId({ id: Number(CATEGORY_ID) })).toBeNull();
    expect(exactInsightId(undefined)).toBeNull();
  });
});
