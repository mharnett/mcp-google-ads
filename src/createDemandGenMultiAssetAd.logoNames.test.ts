/**
 * Logo name check at the call site: google_ads_create_demand_gen_multi_asset_ad
 * reads each logo asset's name before it creates the ad, and refuses a logo
 * whose name reads as a photo of a person. A PreToolUse hook can't make this
 * check, because the tool input carries logo asset ids, never names.
 *
 * Drives the real CallTool dispatch in src/index.ts with writes enabled.
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
import { tools } from "./tools.js";

vi.mock("google-ads-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("google-ads-api")>()),
  GoogleAdsApi: (await import("../tests/helpers/recordingGoogleAds.js")).FakeGoogleAdsApi,
}));
vi.mock("./credentials.js", async (importOriginal) =>
  (await import("../tests/helpers/recordingGoogleAds.js")).fakeCredentialsModule(
    await importOriginal<typeof import("./credentials.js")>(),
  ),
);

const TOOL = "google_ads_create_demand_gen_multi_asset_ad";
const ASSET_READ = /FROM\s+asset\s+WHERE\s+asset\.id\s+IN/i;

const BASE_ARGS = {
  customer_id: FAKE_CUSTOMER_ID,
  ad_group_id: "111",
  final_urls: ["https://example.com/"],
  business_name: "Example Org",
  call_to_action: "LEARN_MORE",
  marketing_image_asset_ids: ["123"],
  headlines: ["Headline 1", "Headline 2"],
  descriptions: ["Description 1", "Description 2"],
};

/** Answer the logo read the way Google would: only the asked-for ids, with these names. */
function assetNames(names: Record<string, string>): void {
  recorder.answerQuery(ASSET_READ, (gaql) => {
    const ids = (gaql.match(/IN\s*\(([^)]*)\)/)?.[1] ?? "").split(",").map((s) => s.trim());
    return ids.filter((id) => id in names).map((id) => ({ asset: { id: Number(id), name: names[id], type: "IMAGE" } }));
  });
}

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "dg-logo-names-test", version: "0.0.0" }, { capabilities: {} });
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

async function create(extra: Record<string, unknown>): Promise<any> {
  const result: any = await client.callTool({ name: TOOL, arguments: { ...BASE_ARGS, ...extra } });
  return JSON.parse(result.content[0].text);
}

const createOps = () =>
  recorder
    .callsTo("mutateResources")
    .flatMap((c) => c.args[0])
    .filter((op: any) => op.operation === "create");

describe("google_ads_create_demand_gen_multi_asset_ad: logo names are checked before the create", () => {
  it("refuses a logo named like a photo of a person, and creates nothing", async () => {
    assetNames({ "201": "Example-Logo-Square", "202": "ManHoldingPhone" });

    const body = await create({ logo_image_asset_ids: ["201", "202"] });

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/'ManHoldingPhone' \(id 202\): holding, man, phone/);
    expect(body.error).toMatch(/Nothing was created/);
    expect(recorder.queries().filter((q) => ASSET_READ.test(q))).toHaveLength(1);
    expect(recorder.writes()).toEqual([]);
  });

  it("creates the ad when every logo is named like a brand mark, reading the names before the create", async () => {
    assetNames({ "201": "Example-Logo-Square", "203": "demand-gen-logo" });

    const body = await create({ logo_image_asset_ids: ["201", "203"] });

    expect(body.success, JSON.stringify(body)).toBe(true);
    const ops = createOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].resource.ad.demand_gen_multi_asset_ad.logo_images).toEqual([
      { asset: `customers/${FAKE_CUSTOMER_ID}/assets/201` },
      { asset: `customers/${FAKE_CUSTOMER_ID}/assets/203` },
    ]);
    const readAt = recorder.calls.findIndex((c) => c.method === "query" && ASSET_READ.test(String(c.args[0])));
    const createAt = recorder.calls.findIndex((c) => c.method === "mutateResources");
    expect(readAt).toBeGreaterThanOrEqual(0);
    expect(readAt).toBeLessThan(createAt);
    expect(String(recorder.calls[readAt].args[0])).toMatch(/IN \(201, 203\)/);
  });

  it("refuses when the names can't be read, and creates nothing", async () => {
    recorder.answerQuery(ASSET_READ, () => {
      throw Object.assign(new Error("PERMISSION_DENIED: caller lacks access"), { code: 7 });
    });

    const body = await create({ logo_image_asset_ids: ["201"] });

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/could not read the logo assets' names.*PERMISSION_DENIED/s);
    expect(body.error).toMatch(/allow_person_photo_logos=true/);
    expect(recorder.writes()).toEqual([]);
  });

  it("refuses when a logo id is not in the account, and creates nothing", async () => {
    assetNames({ "201": "Example-Logo-Square" });

    const body = await create({ logo_image_asset_ids: ["201", "299"] });

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/logo asset id 299 was not found/);
    expect(recorder.writes()).toEqual([]);
  });

  it("allow_person_photo_logos=true skips the read and creates the ad", async () => {
    assetNames({ "202": "ManHoldingPhone" });

    const body = await create({ logo_image_asset_ids: ["202"], allow_person_photo_logos: true });

    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(recorder.queries().filter((q) => ASSET_READ.test(q))).toEqual([]);
    expect(createOps()).toHaveLength(1);
  });

  it("an ad without logos makes no asset read", async () => {
    const body = await create({});

    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(recorder.queries().filter((q) => ASSET_READ.test(q))).toEqual([]);
  });

  it("the tool schema declares allow_person_photo_logos as a boolean (the input allows no other extra keys)", () => {
    const schema: any = tools.find((t) => t.name === TOOL)?.inputSchema;
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.properties?.allow_person_photo_logos?.type).toBe("boolean");
  });
});
