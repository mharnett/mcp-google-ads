import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "google_ads_get_client_context",
    description: "Get the current client context based on working directory. Call this first to confirm which Google Ads account you're working with.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "The current working directory",
        },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "google_ads_list_campaigns",
    description: "List all campaigns for the current client account",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "The customer ID (will use context if not provided)",
        },
      },
    },
  },
  {
    name: "google_ads_list_ad_groups",
    description: "List ad groups, optionally filtered by campaign",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_get_campaign_tracking",
    description: "Get campaign tracking parameters including tracking URL template, final URL suffix, and custom URL parameters",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID to get tracking info for" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "google_ads_list_pending_changes",
    description: "List all pending changes (paused items with claude- label) awaiting review",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_validate_ad",
    description: "Validate an RSA without creating it. Use this to check for errors before creating.",
    inputSchema: {
      type: "object",
      properties: {
        headlines: {
          type: "array",
          items: { type: "string" },
          description: "3-15 headlines, max 30 chars each",
        },
        descriptions: {
          type: "array",
          items: { type: "string" },
          description: "2-4 descriptions, max 90 chars each",
        },
        final_urls: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["headlines", "descriptions", "final_urls"],
    },
  },
  {
    name: "google_ads_create_campaign",
    description: "Create a new campaign (will be PAUSED until approved). Returns campaign ID.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string" },
        daily_budget: { type: "number", description: "Daily budget in dollars" },
      },
      required: ["name", "daily_budget"],
    },
  },
  {
    name: "google_ads_create_ad_group",
    description: "Create a new ad group (will be PAUSED until approved). Returns ad group ID.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
        name: { type: "string" },
        cpc_bid: { type: "number", description: "CPC bid in dollars" },
      },
      required: ["campaign_id", "name"],
    },
  },
  {
    name: "google_ads_create_responsive_search_ad",
    description: "Create a responsive search ad (will be PAUSED until approved). Validates before creating. Headlines/descriptions can be plain strings or objects with pinned_position (1-3 for headlines, 1-2 for descriptions).",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        final_urls: { type: "array", items: { type: "string" } },
        headlines: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  pinned_position: { type: "number", description: "Pin to position 1, 2, or 3" },
                },
                required: ["text"],
              },
            ],
          },
        },
        descriptions: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  pinned_position: { type: "number", description: "Pin to position 1 or 2" },
                },
                required: ["text"],
              },
            ],
          },
        },
        path1: { type: "string" },
        path2: { type: "string" },
      },
      required: ["ad_group_id", "final_urls", "headlines", "descriptions"],
    },
  },
  {
    name: "google_ads_create_keywords",
    description: "Create keywords for an ad group (will be PAUSED until approved)",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["BROAD", "PHRASE", "EXACT"] },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["ad_group_id", "keywords"],
    },
  },
  {
    name: "google_ads_enable_items",
    description: "Enable paused campaigns, ad groups, or ads. REQUIRES USER APPROVAL. Use after reviewing in Google Ads UI.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "google_ads_pause_items",
    description: "Pause enabled campaigns, ad groups, or ads. REQUIRES USER APPROVAL. This will stop items from serving.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "google_ads_add_shared_negatives",
    description: "Add negative keywords to a shared negative keyword list. Keywords will immediately block matching queries across all campaigns the list is applied to.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        shared_set_id: { type: "string", description: "The shared set ID to add keywords to" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["BROAD", "PHRASE", "EXACT"] },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["shared_set_id", "keywords"],
    },
  },
  {
    name: "google_ads_add_campaign_negatives",
    description: "Add negative keywords at the campaign level. Use for campaign-specific negatives that shouldn't be in a shared list.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["BROAD", "PHRASE", "EXACT"] },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["campaign_id", "keywords"],
    },
  },
  {
    name: "google_ads_pause_keywords",
    description: "Pause active keywords by their criterion resource names.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        criterion_resource_names: { type: "array", items: { type: "string" }, description: "Full resource names like customers/123/adGroupCriteria/456~789" },
      },
      required: ["criterion_resource_names"],
    },
  },
  // ============================================
  // REPORTING TOOLS
  // ============================================
  {
    name: "google_ads_keyword_performance",
    description: "Get keyword performance report with metrics including impressions, clicks, cost, conversions, quality score components (quality score, expected CTR, ad relevance, landing page experience), and impression share metrics.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter keywords containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_keyword_performance_by_conversion",
    description: "Get keyword performance broken down by conversion action. Shows which keywords drive which conversion types (e.g., form fills, MQLs, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter keywords containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_report",
    description: "Get search term report showing actual search queries that triggered ads, with the keyword they matched to.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter by keyword text" },
        search_term_contains: { type: "string", description: "Filter search terms containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_report_by_conversion",
    description: "Get search term report broken down by conversion action. Shows which search queries drive which conversion types.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter by keyword text" },
        search_term_contains: { type: "string", description: "Filter search terms containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_ad_performance",
    description: "Get ad performance report with metrics, ad copy (headlines/descriptions), final URLs, and ad strength rating.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_ad_performance_by_conversion",
    description: "Get ad performance broken down by conversion action. Shows which ads drive which conversion types.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_list_conversion_actions",
    description: "List all available conversion actions (e.g., form fills, MQLs, etc.) to understand what conversion tracking is set up.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_search_term_insights",
    description: "Get search term category insights for a campaign. Shows the search categories your ads appeared against (like the Insights panel in the Google Ads UI). Must query one campaign at a time. Optionally compares two date ranges to show trends.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID to get insights for (required, one campaign at a time)" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        compare_start_date: { type: "string", description: "Comparison period start date (optional, for trend calculation)" },
        compare_end_date: { type: "string", description: "Comparison period end date (optional, for trend calculation)" },
      },
      required: ["campaign_id", "start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_insight_terms",
    description: "Drill into a specific search term category to see the individual search terms within it. Requires an insight_id from google_ads_search_term_insights.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID" },
        insight_id: { type: "string", description: "The insight category ID from google_ads_search_term_insights results" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
      },
      required: ["campaign_id", "insight_id", "start_date", "end_date"],
    },
  },
  {
    name: "google_ads_gaql_query",
    description: "Execute a raw GAQL (Google Ads Query Language) query. Use this for custom reports or accessing any Google Ads API resource not covered by other tools. See https://developers.google.com/google-ads/api/docs/query/overview for GAQL syntax.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        query: { type: "string", description: "The GAQL query to execute" },
      },
      required: ["query"],
    },
  },
];
