/**
 * google_ads_remove_items is irreversible. These tests drive the real CallTool
 * dispatch in src/index.ts with writes enabled and read the calls the handler
 * makes on a recording client.
 *
 * Changing the handler's `confirm !== true` check to `false` left every test
 * green (review 2026-11-14): the dry-run branch, label-first ordering, the
 * abort on a failed label and the child-up order were tested only through
 * the pure helpers in removeHelpers.ts. Each case here fails if the handler
 * removes without confirm, removes before labelling, removes after a label
 * failure, or drops the claude-MM-DD-YY audit label.
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
/** 2026-11-21 12:00 local: the audit label for this instant is claude-11-21-26. */
const FIXED_NOW = new Date(2026, 10, 21, 12, 0, 0);

const TARGETS = { campaign_ids: ["31"], ad_group_ids: ["41"], ad_ids: ["51"] };

/** Methods that remove something. */
const REMOVE_METHODS = ["adGroupAds.remove", "adGroups.remove", "campaigns.remove"];
const LABEL_METHODS = ["campaignLabels.create", "adGroupLabels.create", "adGroupAdLabels.create"];

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "remove-items-call-site-test", version: "0.0.0" }, { capabilities: {} });
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
  // Ad 51 lives in ad group 41, so the ad resolver can build its adGroupAd name.
  recorder.answerQuery(/FROM ad_group_ad WHERE ad_group_ad\.ad\.id IN \(51\)/, [
    { ad_group: { id: 41 }, ad_group_ad: { ad: { id: 51 } } },
  ]);
  vi.stubEnv("GOOGLE_ADS_MCP_WRITE", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function removeItems(args: Record<string, unknown>): Promise<any> {
  const result: any = await client.callTool({
    name: "google_ads_remove_items",
    arguments: { customer_id: CID, ...TARGETS, ...args },
  });
  return JSON.parse(result.content[0].text);
}

function methodsCalled(): string[] {
  return recorder.writes().map((c) => c.method);
}

describe("google_ads_remove_items at the CallTool dispatch (GOOGLE_ADS_MCP_WRITE=true)", () => {
  it.each<[string, Record<string, unknown>]>([
    ["confirm unset", {}],
    ["confirm: false", { confirm: false }],
    ["confirm: \"yes\"", { confirm: "yes" }],
    ["confirm: 1", { confirm: 1 }],
  ])("%s returns the dry-run preview and writes nothing", async (_label, args) => {
    const body = await removeItems(args);

    expect(body.dry_run).toBe(true);
    expect(body.would_remove).toEqual({ campaigns: ["31"], ad_groups: ["41"], ads: ["51"] });
    expect(recorder.writes()).toEqual([]);
  });

  it("confirm: true labels every target with claude-MM-DD-YY before the first remove", async () => {
    const body = await removeItems({ confirm: true });

    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(body.labels_applied).toEqual(["claude-11-21-26"]);

    const order = methodsCalled();
    const firstRemove = order.findIndex((m) => REMOVE_METHODS.includes(m));
    const lastLabel = Math.max(...LABEL_METHODS.map((m) => order.lastIndexOf(m)));
    expect(firstRemove).toBeGreaterThan(-1);
    expect(lastLabel).toBeLessThan(firstRemove);

    // Each label op targets the resource that is about to be removed.
    const labelled = LABEL_METHODS.flatMap((m) => recorder.callsTo(m)).flatMap((c) => c.args[0]);
    expect(labelled.map((op: any) => op.campaign ?? op.ad_group ?? op.ad_group_ad)).toEqual([
      `customers/${CID}/campaigns/31`,
      `customers/${CID}/adGroups/41`,
      `customers/${CID}/adGroupAds/41~51`,
    ]);
  });

  it("confirm: true removes child-up: ads, then ad groups, then campaigns", async () => {
    await removeItems({ confirm: true });

    expect(methodsCalled().filter((m) => REMOVE_METHODS.includes(m))).toEqual(REMOVE_METHODS);
    expect(recorder.callsTo("adGroupAds.remove")[0].args[0]).toEqual([`customers/${CID}/adGroupAds/41~51`]);
    expect(recorder.callsTo("adGroups.remove")[0].args[0]).toEqual([`customers/${CID}/adGroups/41`]);
    expect(recorder.callsTo("campaigns.remove")[0].args[0]).toEqual([`customers/${CID}/campaigns/31`]);
  });

  it("caller labels are applied after the audit label, and also before any remove", async () => {
    const body = await removeItems({ confirm: true, labels: ["cleanup-q4"] });

    expect(body.labels_applied).toEqual(["claude-11-21-26", "cleanup-q4"]);
    const labelQueries = recorder.queries().filter((q) => /FROM label WHERE/.test(q));
    expect(labelQueries.map((q) => q.match(/label\.name = '([^']*)'/)?.[1])).toEqual(["claude-11-21-26", "cleanup-q4"]);
  });

  it("a failed label attach aborts before anything is removed", async () => {
    recorder.failMethod("adGroupLabels.create", Object.assign(new Error("label attach rejected"), { code: 400 }));

    const body = await removeItems({ confirm: true });

    expect(body.error).toMatch(/Label attach failed before removal: label attach rejected\. Nothing removed\./);
    expect(methodsCalled().filter((m) => REMOVE_METHODS.includes(m))).toEqual([]);
  });
});
