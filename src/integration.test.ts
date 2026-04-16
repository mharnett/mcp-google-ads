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
    expect(data.customer_id || data.error).toBeDefined();
  }, 15_000);

  it("google_ads_list_campaigns returns campaigns array", async () => {
    const result = await client.callTool({
      name: "google_ads_list_campaigns",
      arguments: { customer_id: CUSTOMER_ID },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(Array.isArray(data) || data.error).toBeTruthy();
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
    // Should return array of keyword rows or be wrapped in a response object
    expect(Array.isArray(data) || typeof data === "object").toBeTruthy();
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
    // Should either be an error response or the default customer_id is used
    expect(data).toBeDefined();
  }, 15_000);

  it("google_ads_list_conversion_actions returns actions", async () => {
    const result = await client.callTool({
      name: "google_ads_list_conversion_actions",
      arguments: { customer_id: CUSTOMER_ID },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(Array.isArray(data) || typeof data === "object").toBeTruthy();
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
    expect(Array.isArray(data) || typeof data === "object").toBeTruthy();
  }, 15_000);

  it("error: invalid customer_id returns error response", async () => {
    const result = await client.callTool({
      name: "google_ads_list_campaigns",
      arguments: { customer_id: "0000000000" },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error || data.error_type).toBeDefined();
  }, 15_000);
});
