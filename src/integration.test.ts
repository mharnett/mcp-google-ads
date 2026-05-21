import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LIVE = process.env.LIVE_TEST === "true";
const CUSTOMER_ID = process.env.TEST_CUSTOMER_ID || "1234567890";

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
}

describe.skipIf(!LIVE)("mcp-google-ads integration", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bash",
      args: ["-c", "source ./run-mcp.sh"],
      cwd: process.cwd(),
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists tools and finds expected tool names", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("google_ads_get_client_context");
    expect(names).toContain("google_ads_list_campaigns");
    expect(names).toContain("google_ads_keyword_performance");
    expect(names).toContain("google_ads_gaql_query");
    expect(names.length).toBeGreaterThanOrEqual(30);
  });

  it("google_ads_get_client_context returns client info", async () => {
    const result = await client.callTool({
      name: "google_ads_get_client_context",
      arguments: { working_directory: process.cwd() },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    // Happy path must surface customer_id; an MCP server that always errors
    // would have failed the loose `customer_id || error` form previously here.
    expect(data.error).toBeUndefined();
    expect(typeof data.customer_id).toBe("string");
    expect(data.customer_id).toMatch(/^\d{10}$|^\d{3}-\d{3}-\d{4}$/);
  }, 15_000);

  it("google_ads_list_campaigns returns campaigns array", async () => {
    const result = await client.callTool({
      name: "google_ads_list_campaigns",
      arguments: { customer_id: CUSTOMER_ID },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    // Expected shape: array of campaign rows OR { campaigns: [...] }
    const campaigns = Array.isArray(data) ? data : data.campaigns;
    expect(Array.isArray(campaigns)).toBe(true);
    if (campaigns.length > 0) {
      expect(campaigns[0]).toHaveProperty("id");
    }
  }, 15_000);

  it("google_ads_keyword_performance with a date range", async () => {
    const result = await client.callTool({
      name: "google_ads_keyword_performance",
      arguments: {
        customer_id: CUSTOMER_ID,
        start_date: "2026-03-01",
        end_date: "2026-03-07",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    // Expect either an array of keyword rows or { rows | results: [...] }.
    const rows = Array.isArray(data) ? data : (data.rows ?? data.results);
    expect(Array.isArray(rows)).toBe(true);
  }, 30_000);

  it("error: missing customer_id returns error", async () => {
    const result = await client.callTool({
      name: "google_ads_keyword_performance",
      arguments: {
        start_date: "2026-03-01",
        end_date: "2026-03-07",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    // Must be an error response; pin the error message to surface a real
    // missing-customer-id signal (not e.g. an auth error from a default CID).
    expect(typeof data.error).toBe("string");
    expect(data.error.toLowerCase()).toMatch(/customer_id|customer id|required|missing/);
  }, 15_000);

  it("google_ads_list_conversion_actions returns actions", async () => {
    const result = await client.callTool({
      name: "google_ads_list_conversion_actions",
      arguments: { customer_id: CUSTOMER_ID },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    const actions = Array.isArray(data) ? data : (data.conversion_actions ?? data.actions ?? data.results);
    expect(Array.isArray(actions)).toBe(true);
  }, 15_000);

  it("google_ads_gaql_query executes custom query", async () => {
    const result = await client.callTool({
      name: "google_ads_gaql_query",
      arguments: {
        customer_id: CUSTOMER_ID,
        query: "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED' LIMIT 5",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    const rows = Array.isArray(data) ? data : (data.rows ?? data.results);
    expect(Array.isArray(rows)).toBe(true);
  }, 15_000);

  it("error: invalid customer_id returns error response", async () => {
    const result = await client.callTool({
      name: "google_ads_list_campaigns",
      arguments: { customer_id: "0000000000" },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    // Must surface a structured error — not "defined".
    const errVal = data.error ?? data.error_type;
    expect(typeof errVal).toBe("string");
    expect(errVal.length).toBeGreaterThan(0);
  }, 15_000);
});
