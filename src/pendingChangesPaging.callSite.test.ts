/**
 * A large google_ads_list_pending_changes result says how much there is and
 * lets the caller get all of it.
 *
 * It used to be cut to 200 KB by halving every list, with `truncated: true`
 * and no counts, so most of the pending items were missing with nothing to
 * say how many or how to reach them.
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

const LIMIT_BYTES = 200_000;
const SECTIONS = ["campaigns", "adGroups", "ads", "keywords"] as const;
type Section = (typeof SECTIONS)[number];

const RESOURCE: Record<Section, string> = {
  campaigns: "campaign_label",
  adGroups: "ad_group_label",
  ads: "ad_group_ad_label",
  keywords: "ad_group_criterion_label",
};

const label = (n: number) => ({ name: `claude-11-${String(10 + n).padStart(2, "0")}-26` });
const PAD = "x".repeat(200);

const MAKE: Record<Section, (item: number, l: number) => any> = {
  campaigns: (i, l) => ({ campaign: { id: 1000 + i, name: `Campaign ${i}`, status: "PAUSED" }, label: label(l) }),
  adGroups: (i, l) => ({ ad_group: { id: 2000 + i, name: `Group ${i}`, status: "PAUSED" }, campaign: { name: "C" }, label: label(l) }),
  // Ad 0 is linked into two ad groups: one ad id, two items.
  ads: (i, l) => ({
    ad_group_ad: { ad: { id: i < 2 ? 3000 : 3000 + i }, status: "PAUSED" },
    ad_group: { id: 2000 + i, name: `Group ${i} ${PAD}` },
    campaign: { name: "C" },
    label: label(l),
  }),
  keywords: (i, l) => ({
    ad_group_criterion: {
      resource_name: `customers/${FAKE_CUSTOMER_ID}/adGroupCriteria/22~${4000 + i}`,
      criterion_id: 4000 + i,
      keyword: { text: `keyword ${i} ${PAD}`, match_type: "PHRASE" },
      status: "PAUSED",
    },
    ad_group: { name: "Core" },
    campaign: { name: "Brand" },
    label: label(l),
  }),
};

/** `items` entities; the first `twice` of them carry a second label. */
const rows = (section: Section, items: number, twice = 0) => [
  ...Array.from({ length: items }, (_, i) => MAKE[section](i, i % 3)),
  ...Array.from({ length: twice }, (_, i) => MAKE[section](i, 7)),
];

let data: Record<Section, any[]>;
const small = () => ({ campaigns: rows("campaigns", 2, 1), adGroups: rows("adGroups", 3), ads: rows("ads", 4), keywords: rows("keywords", 5, 2) });
const large = () => ({ campaigns: rows("campaigns", 3), adGroups: rows("adGroups", 8), ads: rows("ads", 600, 100), keywords: rows("keywords", 2500, 500) });

/** Row identity, independent of order. */
const idOf = (row: any) => JSON.stringify(row);
const sorted = (list: any[]) => list.map(idOf).sort();

let client: Client;
let queryCount = 0;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "pending-paging-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  recorder.reset();
  // The API promises no order without ORDER BY: rotate it on every query.
  recorder.answerQuery(/./, (gaql) => {
    const section = SECTIONS.find((s) => new RegExp(`FROM\\s+${RESOURCE[s]}\\b`).test(gaql))!;
    const list = data[section];
    const k = list.length ? (++queryCount * 137) % list.length : 0;
    return [...list.slice(k), ...list.slice(0, k)].reverse();
  });
});

async function call(args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string; body: any }> {
  const result: any = await client.callTool({
    name: "google_ads_list_pending_changes",
    arguments: { customer_id: FAKE_CUSTOMER_ID, ...args },
  });
  const text = result.content[0].text;
  return { isError: Boolean(result.isError), text, body: result.isError ? null : JSON.parse(text) };
}

async function page(args: Record<string, unknown> = {}): Promise<any> {
  const r = await call(args);
  expect(r.isError, r.text).toBe(false);
  expect(recorder.writes()).toEqual([]);
  return r.body;
}

/** Follow next_offset to the end of one section. */
async function readAll(section: Section, extra: Record<string, unknown> = {}) {
  const collected: any[] = [];
  let offset = 0;
  for (let pages = 0; pages < 100; pages++) {
    const body = await page({ entity_type: section, offset, ...extra });
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(LIMIT_BYTES);
    expect(body.counts[section].returned_rows).toBe(body[section].length);
    collected.push(...body[section]);
    const next = body.counts[section].next_offset;
    if (next === undefined) {
      expect(body.truncated).toBeUndefined();
      return { collected, pages: pages + 1 };
    }
    expect(body.truncated).toBe(true);
    expect(next).toBe(offset + body[section].length);
    expect(next).toBeGreaterThan(offset);
    offset = next;
  }
  throw new Error("paging did not end");
}

describe("a result that fits", () => {
  it("returns every row, with row and item totals per section and no truncation marks", async () => {
    data = small();
    const body = await page();

    for (const s of SECTIONS) expect(sorted(body[s])).toEqual(sorted(data[s]));
    expect(body.counts).toEqual({
      campaigns: { total_rows: 3, total_items: 2, returned_rows: 3 },
      adGroups: { total_rows: 3, total_items: 3, returned_rows: 3 },
      ads: { total_rows: 4, total_items: 4, returned_rows: 4 },
      keywords: { total_rows: 7, total_items: 5, returned_rows: 7 },
    });
    for (const key of ["truncated", "labels", "how_to_get_the_rest"]) expect(body).not.toHaveProperty(key);
  });
});

describe("a result too large for one response", () => {
  beforeEach(() => {
    data = large();
  });

  it("reports the full totals, stays within the limit and keeps the small sections whole", async () => {
    const body = await page();

    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(LIMIT_BYTES);
    // Nearly all of the space is used.
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(LIMIT_BYTES * 0.95);
    expect(body.truncated).toBe(true);
    expect(body.counts.ads).toMatchObject({ total_rows: 700, total_items: 600 });
    expect(body.counts.keywords).toMatchObject({ total_rows: 3000, total_items: 2500 });
    expect(body.campaigns).toHaveLength(3);
    expect(body.adGroups).toHaveLength(8);
    expect(body.counts.campaigns.next_offset).toBeUndefined();
    for (const s of ["ads", "keywords"] as const) {
      expect(body[s].length).toBeGreaterThan(0);
      expect(body.counts[s].returned_rows).toBe(body[s].length);
      expect(body.counts[s].next_offset).toBe(body[s].length);
    }
    expect(body.how_to_get_the_rest).toMatch(/entity_type.*offset.*next_offset/s);
  });

  it("summarises rows per label, adding up to the totals", async () => {
    const body = await page();

    expect(body.labels.map((l: any) => l.label).sort()).toEqual([label(0), label(1), label(2), label(7)].map((l) => l.name).sort());
    for (const s of SECTIONS) {
      expect(body.labels.reduce((n: number, l: any) => n + l[s], 0)).toBe(data[s].length);
    }
  });

  it.each(["ads", "keywords"] as const)("returns every %s row exactly once across pages, whatever order the API uses", async (section) => {
    const { collected, pages } = await readAll(section);

    expect(pages).toBeGreaterThan(1);
    expect(sorted(collected)).toEqual(sorted(data[section]));
  });

  it("continues a section from the next_offset of the first, all-section response", async () => {
    const first = await page();
    let collected = [...first.keywords];
    let offset = first.counts.keywords.next_offset;
    // Bounded, so an offset that stops advancing fails instead of looping.
    for (let pages = 0; offset !== undefined && pages < 100; pages++) {
      const body = await page({ entity_type: "keywords", offset });
      collected = collected.concat(body.keywords);
      const next = body.counts.keywords.next_offset;
      if (next !== undefined) expect(next).toBeGreaterThan(offset);
      offset = next;
    }
    expect(offset).toBeUndefined();
    expect(sorted(collected)).toEqual(sorted(data.keywords));
  });

  it("with entity_type, queries and returns only that section", async () => {
    const body = await page({ entity_type: "ads" });

    expect(recorder.queries()).toHaveLength(1);
    expect(Object.keys(body.counts)).toEqual(["ads"]);
    for (const s of ["campaigns", "adGroups", "keywords"]) expect(body).not.toHaveProperty(s);
  });

  it("with label, counts and returns only that label's rows", async () => {
    const name = label(7).name;
    const expected = data.keywords.filter((r) => r.label.name === name);
    const { collected } = await readAll("keywords", { label: name });

    expect(sorted(collected)).toEqual(sorted(expected));
    const body = await page({ label: name });
    expect(body.label).toBe(name);
    expect(body.counts.keywords.total_rows).toBe(500);
    expect(body.counts.campaigns.total_rows).toBe(0);
  });

  it("past the end returns no rows and no next_offset", async () => {
    const body = await page({ entity_type: "ads", offset: 5000 });

    expect(body.ads).toEqual([]);
    expect(body.counts.ads).toEqual({ total_rows: 700, total_items: 600, returned_rows: 0 });
  });
});

describe("the label summary", () => {
  it("is capped and says how many labels there are, so it cannot fill the response", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => {
      const row = MAKE.keywords(i, 0);
      return { ...row, label: { name: `claude-11-25-26-change-${i % 900}` } };
    });
    data = { campaigns: [], adGroups: [], ads: [], keywords: many };
    const body = await page();

    expect(body.labels).toHaveLength(300);
    expect(body.total_labels).toBe(900);
    expect(body.keywords.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(LIMIT_BYTES);
  });
});

describe("bad paging arguments", () => {
  it.each([
    [{ offset: 10 }, /offset needs entity_type/],
    [{ entity_type: "keyword" }, /entity_type must be one of campaigns, adGroups, ads, keywords/],
    [{ entity_type: "ads", offset: -1 }, /offset must be a whole number/],
    [{ entity_type: "ads", offset: 1.5 }, /offset must be a whole number/],
    [{ entity_type: "ads", offset: "ten" }, /offset must be a whole number/],
  ])("refuses %j before querying", async (args, message) => {
    data = small();
    const r = await call(args);

    expect(r.isError).toBe(true);
    expect(r.text).toMatch(message);
    expect(recorder.queries()).toEqual([]);
  });
});

describe("the tool definition", () => {
  it("offers entity_type, offset and label, and explains the counts", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "google_ads_list_pending_changes")!;
    const props = tool.inputSchema.properties as any;

    expect(props.entity_type.enum).toEqual([...SECTIONS]);
    expect(props.offset.type).toBe("integer");
    expect(props.label.type).toBe("string");
    for (const word of [/total_rows/, /total_items/, /next_offset/, /truncated/]) expect(tool.description).toMatch(word);
  });
});
