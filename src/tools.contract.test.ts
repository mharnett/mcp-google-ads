import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";

describe("Tool Schema Contract", () => {
  // Expected tool names - if this list changes, the test fails
  const EXPECTED_TOOLS = [
    "google_ads_get_client_context",
    "google_ads_list_campaigns",
    "google_ads_list_ad_groups",
    "google_ads_get_campaign_tracking",
    "google_ads_list_pending_changes",
    "google_ads_validate_ad",
    "google_ads_create_campaign",
    "google_ads_create_ad_group",
    "google_ads_create_responsive_search_ad",
    "google_ads_create_keywords",
    "google_ads_enable_items",
    "google_ads_pause_items",
    "google_ads_create_shared_set",
    "google_ads_link_shared_set",
    "google_ads_unlink_shared_set",
    "google_ads_add_shared_negatives",
    "google_ads_remove_shared_negatives",
    "google_ads_add_campaign_negatives",
    "google_ads_remove_campaign_negatives",
    "google_ads_remove_adgroup_negatives",
    "google_ads_pause_keywords",
    "google_ads_update_campaign_tracking",
    "google_ads_keyword_performance",
    "google_ads_keyword_performance_by_conversion",
    "google_ads_search_term_report",
    "google_ads_search_term_report_by_conversion",
    "google_ads_ad_performance",
    "google_ads_ad_performance_by_conversion",
    "google_ads_list_conversion_actions",
    "google_ads_search_term_insights",
    "google_ads_search_term_insight_terms",
    "google_ads_update_campaign_budget",
    "google_ads_gaql_query",
    "google_ads_keyword_volume",
  ];

  it("exports the expected number of tools", () => {
    expect(tools).toHaveLength(EXPECTED_TOOLS.length);
  });

  it("exports all expected tool names", () => {
    const names = tools.map(t => t.name);
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it("all tools have google_ads_ prefix", () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^google_ads_/);
    }
  });

  it("all tools have a description", () => {
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(10);
    }
  });

  it("all tools have valid inputSchema", () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).toHaveProperty("properties");
    }
  });

  it("all required fields exist in properties", () => {
    for (const tool of tools) {
      const schema = tool.inputSchema as any;
      if (schema.required) {
        for (const field of schema.required) {
          expect(schema.properties).toHaveProperty(
            field,
            expect.anything()
          );
        }
      }
    }
  });

  it("no tool has empty properties", () => {
    for (const tool of tools) {
      const props = (tool.inputSchema as any).properties;
      expect(Object.keys(props).length).toBeGreaterThan(0);
    }
  });

  // Specific contract checks for critical tools
  describe("critical tool schemas", () => {
    it("create_campaign requires name and daily_budget", () => {
      const tool = tools.find(t => t.name === "google_ads_create_campaign");
      expect((tool!.inputSchema as any).required).toContain("name");
      expect((tool!.inputSchema as any).required).toContain("daily_budget");
    });

    it("keyword_performance requires date range", () => {
      const tool = tools.find(t => t.name === "google_ads_keyword_performance");
      expect((tool!.inputSchema as any).required).toContain("start_date");
      expect((tool!.inputSchema as any).required).toContain("end_date");
    });

    it("gaql_query requires query", () => {
      const tool = tools.find(t => t.name === "google_ads_gaql_query");
      expect((tool!.inputSchema as any).required).toContain("query");
    });
  });
});
