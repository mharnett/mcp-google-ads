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
    "google_ads_remove_items",
    "google_ads_apply_label",
    "google_ads_create_shared_set",
    "google_ads_link_shared_set",
    "google_ads_unlink_shared_set",
    "google_ads_add_shared_negatives",
    "google_ads_remove_shared_negatives",
    "google_ads_add_campaign_negatives",
    "google_ads_remove_campaign_negatives",
    "google_ads_remove_adgroup_negatives",
    "google_ads_pause_keywords",
    "google_ads_enable_keywords",
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
    "google_ads_update_campaign_bidding",
    "google_ads_gaql_query",
    "google_ads_update_asset_urls",
    "google_ads_create_sitelink",
    "google_ads_replace_sitelink_url",
    "google_ads_pause_asset_links",
    "google_ads_keyword_volume",
    "google_ads_create_demand_gen_multi_asset_ad",
    "google_ads_create_page_feed",
    "google_ads_create_image_asset",
    "google_ads_create_experiment",
    "google_ads_list_experiments",
    "google_ads_get_experiment",
    "google_ads_schedule_experiment",
    "google_ads_end_experiment",
    "google_ads_promote_experiment",
    "google_ads_update_campaign_ad_urls",
    "google_ads_rename_ad_group",
    "google_ads_link_asset_to_campaign",
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

    it("create_campaign accepts channel_type, bidding_strategy, target_cpa, geo_target_ids, language_id, start_date, end_date", () => {
      const tool = tools.find(t => t.name === "google_ads_create_campaign");
      const props = (tool!.inputSchema as any).properties;
      expect(props.channel_type?.enum).toEqual(["SEARCH", "DEMAND_GEN"]);
      expect(props.bidding_strategy?.enum).toEqual([
        "MANUAL_CPC",
        "MAXIMIZE_CLICKS",
        "MAXIMIZE_CONVERSIONS",
        "TARGET_CPA",
      ]);
      expect(props.target_cpa?.type).toBe("number");
      expect(props.target_cpc_cap?.type).toBe("number");
      expect(props.geo_target_ids?.type).toBe("array");
      expect(props.language_id?.type).toBe("string");
      expect(props.start_date?.type).toBe("string");
      expect(props.end_date?.type).toBe("string");
    });

    it("create_demand_gen_multi_asset_ad has the required DG ad schema", () => {
      const tool = tools.find(t => t.name === "google_ads_create_demand_gen_multi_asset_ad");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as any;
      // Required fields: ad_group_id, final_urls, business_name, call_to_action, marketing_image_asset_ids, headlines, descriptions
      expect(schema.required).toContain("ad_group_id");
      expect(schema.required).toContain("final_urls");
      expect(schema.required).toContain("business_name");
      expect(schema.required).toContain("call_to_action");
      expect(schema.required).toContain("marketing_image_asset_ids");
      expect(schema.required).toContain("headlines");
      expect(schema.required).toContain("descriptions");

      // Optional arrays
      expect(schema.properties.square_marketing_image_asset_ids?.type).toBe("array");
      expect(schema.properties.portrait_marketing_image_asset_ids?.type).toBe("array");
      expect(schema.properties.logo_image_asset_ids?.type).toBe("array");
      expect(schema.properties.long_headlines?.type).toBe("array");
      expect(schema.properties.labels?.type).toBe("array");
    });

    it("create_image_asset requires name and accepts file_path or base64_data", () => {
      const tool = tools.find(t => t.name === "google_ads_create_image_asset");
      expect(tool).toBeDefined();
      const schema = tool!.inputSchema as any;
      expect(schema.required).toContain("name");
      expect(schema.properties.file_path?.type).toBe("string");
      expect(schema.properties.base64_data?.type).toBe("string");
      expect(schema.properties.name?.type).toBe("string");
    });

    it("create_ad_group accepts type SEARCH_STANDARD | DEMAND_GEN_MULTI_ASSET_AD_GROUP", () => {
      const tool = tools.find(t => t.name === "google_ads_create_ad_group");
      const props = (tool!.inputSchema as any).properties;
      expect(props.type?.enum).toEqual([
        "SEARCH_STANDARD",
        "DEMAND_GEN_MULTI_ASSET_AD_GROUP",
      ]);
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

    it("remove_items has confirm field (dry-run default)", () => {
      const tool = tools.find(t => t.name === "google_ads_remove_items");
      expect(tool).toBeDefined();
      const props = (tool!.inputSchema as any).properties;
      expect(props).toHaveProperty("confirm");
      expect(props.confirm.type).toBe("boolean");
    });

    it("remove_items description warns about irreversibility + dry-run", () => {
      const tool = tools.find(t => t.name === "google_ads_remove_items");
      expect(tool!.description).toMatch(/IRREVERSIBLE|irreversible/);
      expect(tool!.description!.toLowerCase()).toContain("dry");
      expect(tool!.description!.toLowerCase()).toContain("confirm");
    });

    it("remove_items supports all three resource types", () => {
      const tool = tools.find(t => t.name === "google_ads_remove_items");
      const props = (tool!.inputSchema as any).properties;
      expect(props).toHaveProperty("campaign_ids");
      expect(props).toHaveProperty("ad_group_ids");
      expect(props).toHaveProperty("ad_ids");
    });

    it("apply_label requires label", () => {
      const tool = tools.find(t => t.name === "google_ads_apply_label");
      expect(tool).toBeDefined();
      expect((tool!.inputSchema as any).required).toContain("label");
    });

    it("apply_label supports all three resource types", () => {
      const tool = tools.find(t => t.name === "google_ads_apply_label");
      const props = (tool!.inputSchema as any).properties;
      expect(props).toHaveProperty("campaign_ids");
      expect(props).toHaveProperty("ad_group_ids");
      expect(props).toHaveProperty("ad_ids");
    });
  });
});
