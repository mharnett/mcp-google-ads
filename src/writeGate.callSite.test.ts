/**
 * Write gate at the call site: drives the real CallTool handler that
 * src/index.ts registers on its MCP server, over an in-memory MCP transport.
 *
 * writeGate.test.ts proves assertWriteAllowed() itself refuses write tools,
 * but it imports only tools.js, so deleting the assertWriteAllowed(name) call
 * from the dispatch left every test green (review 2026-11-14). Here every
 * name in WRITE_TOOLS is called through the server with GOOGLE_ADS_MCP_WRITE
 * unset, and the test asserts the gate's refusal came back before any Google
 * Ads call, client construction or credential read.
 *
 * Containment: GoogleAdsApi and the credential chain are replaced with the
 * recording fakes in tests/helpers/recordingGoogleAds.ts and fetch is stubbed
 * to throw, so even with the gate removed nothing here reaches Google Ads, the
 * network, the credentials file or the Keychain.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { recorder, FAKE_CUSTOMER_ID } from "../tests/helpers/recordingGoogleAds.js";
import { WRITE_TOOLS, WRITE_DISABLED_MESSAGE } from "./writeGate.js";
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

const WRITE_TOOL_NAMES = [...WRITE_TOOLS].sort();

/**
 * Two argument shapes per tool: the bare call (what a dry run or preview
 * looks like) and the most dangerous call, with every confirm/execute flag
 * set. Read mode must refuse both.
 */
const ARG_SHAPES: Array<[string, Record<string, unknown>]> = [
  ["bare", { customer_id: FAKE_CUSTOMER_ID }],
  [
    "confirmed",
    {
      customer_id: FAKE_CUSTOMER_ID,
      confirm: true,
      execute: true,
      dry_run: false,
      validate_only: false,
      explicit_lead_form_request: true,
    },
  ],
];

let client: Client;
let fetchCalls = 0;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    fetchCalls += 1;
    throw new Error("network is disabled in this test");
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "write-gate-call-site-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  recorder.reset();
  fetchCalls = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function bodyOf(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("write gate at the CallTool dispatch (GOOGLE_ADS_MCP_WRITE unset)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_ADS_MCP_WRITE", undefined);
  });

  it("covers a non-trivial set of write tools", () => {
    expect(WRITE_TOOL_NAMES.length).toBeGreaterThan(50);
  });

  describe.each(ARG_SHAPES)("%s arguments", (_shape, args) => {
    it.each(WRITE_TOOL_NAMES)("%s is refused before any Google Ads call", async (name) => {
      const result: any = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(bodyOf(result).message).toBe(`Tool "${name}" is a write operation. ${WRITE_DISABLED_MESSAGE}`);
      expect(recorder.calls).toEqual([]);
      expect(recorder.customersOpened).toBe(0);
      expect(recorder.apiConstructed).toBe(0);
      expect(recorder.credentialReads).toBe(0);
      expect(fetchCalls).toBe(0);
    });
  });

  it("hides every write tool from tools/list", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => WRITE_TOOLS.has(n))).toEqual([]);
  });

  it("still lets a read tool through to the client (the recorder is on the dispatch path)", async () => {
    const result: any = await client.callTool({
      name: "google_ads_list_campaigns",
      arguments: { customer_id: FAKE_CUSTOMER_ID },
    });

    expect(result.isError).toBeFalsy();
    expect(recorder.callsTo("query")).toHaveLength(1);
  });
});

describe("write gate open (GOOGLE_ADS_MCP_WRITE=true)", () => {
  it("lets a write tool through to the client's mutate call", async () => {
    vi.stubEnv("GOOGLE_ADS_MCP_WRITE", "true");

    const result: any = await client.callTool({
      name: "google_ads_create_keywords",
      arguments: {
        customer_id: FAKE_CUSTOMER_ID,
        ad_group_id: "999",
        keywords: [{ text: "example widget", match_type: "PHRASE" }],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(bodyOf(result).success).toBe(true);
    expect(recorder.callsTo("adGroupCriteria.create")).toHaveLength(1);
  });
});
