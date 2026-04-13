import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "google_ads_get_client_context",
    description: "Get the current client context and health status based on working directory. Call this first to confirm which Google Ads account you're working with.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to get tracking info for" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "google_ads_list_pending_changes",
    description: "List all pending changes (paused items with claude- label) awaiting review",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_validate_ad",
    description: "Validate an RSA without creating it. Use this to check for errors before creating. Enforces: 3-15 headlines (≤30 chars), 2-4 descriptions (≤90 chars), ≥1 final URL, both path1 AND path2 present (≤15 chars each), ≥1 label.",
    inputSchema: {
      additionalProperties: false,
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
        path1: {
          type: "string",
          description: "Display URL path segment 1 (required, max 15 chars). Shown in ad preview.",
        },
        path2: {
          type: "string",
          description: "Display URL path segment 2 (required, max 15 chars). Shown in ad preview.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "At least 1 label required (e.g. 'claude-2026-04-12' for versioning). Enables later discovery and auditing.",
        },
      },
      required: ["headlines", "descriptions", "final_urls", "path1", "path2", "labels"],
    },
  },
  {
    name: "google_ads_create_campaign",
    description: "Create a new campaign (will be PAUSED until approved). Returns campaign ID.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
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
    description: "Create a responsive search ad (will be PAUSED until approved). Validates before creating. Headlines/descriptions can be plain strings or objects with pinned_position (1-3 for headlines, 1-2 for descriptions). path1 and path2 are required (display URL paths). A `claude-YYYY-MM-DD` label is auto-applied; pass additional `labels` to attach more.",
    inputSchema: {
      additionalProperties: false,
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
        path1: {
          type: "string",
          description: "Display URL path segment 1 (required, max 15 chars).",
        },
        path2: {
          type: "string",
          description: "Display URL path segment 2 (required, max 15 chars).",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional additional labels to attach alongside the auto-applied claude-YYYY-MM-DD label. The auto-label alone satisfies the ≥1 label requirement, so this is for extra tagging only.",
        },
      },
      required: ["ad_group_id", "final_urls", "headlines", "descriptions", "path1", "path2"],
    },
  },
  {
    name: "google_ads_create_keywords",
    description: "Create keywords for an ad group (will be PAUSED until approved). Keywords are auto-labeled for easy discovery via google_ads_list_pending_changes.",
    inputSchema: {
      additionalProperties: false,
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
        label: {
          type: "string",
          description: "Label to apply to created keywords (default: 'claude-pending'). Use to group and find paused keywords later.",
        },
      },
      required: ["ad_group_id", "keywords"],
    },
  },
  {
    name: "google_ads_enable_items",
    description: "Enable paused campaigns, ad groups, or ads. REQUIRES USER APPROVAL. Use after reviewing in Google Ads UI.",
    inputSchema: {
      additionalProperties: false,
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
    description: "Pause enabled campaigns, ad groups, or ads. REQUIRES USER APPROVAL. This will stop items from serving. Auto-applies today's `Claude-MM-DD-YY` label for audit trail.",
    inputSchema: {
      additionalProperties: false,
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
    name: "google_ads_create_shared_set",
    description: "Create a new shared negative keyword list at account level. Returns the new shared set ID.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string", description: "Name for the new shared negative keyword list" },
      },
      required: ["name"],
    },
  },
  {
    name: "google_ads_link_shared_set",
    description: "Link a shared negative keyword list to one or more campaigns. Once linked, all negatives in the list will apply to those campaigns.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        shared_set_id: { type: "string", description: "The shared set ID to link" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Numeric string campaign IDs to link the shared set to" },
      },
      required: ["shared_set_id", "campaign_ids"],
    },
  },
  {
    name: "google_ads_unlink_shared_set",
    description: "Unlink a shared negative keyword list from one or more campaigns. The list's negatives will no longer apply to those campaigns.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        shared_set_id: { type: "string", description: "The shared set ID to unlink" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Numeric string campaign IDs to unlink the shared set from" },
      },
      required: ["shared_set_id", "campaign_ids"],
    },
  },
  {
    name: "google_ads_add_shared_negatives",
    description: "Add negative keywords to a shared negative keyword list. Keywords will immediately block matching queries across all campaigns the list is applied to.",
    inputSchema: {
      additionalProperties: false,
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
    name: "google_ads_remove_shared_negatives",
    description: "Remove negative keywords from a shared negative keyword list by their resource names. Get resource names from a GAQL query on shared_criterion.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        resource_names: {
          type: "array",
          items: { type: "string" },
          description: "Resource names of the shared criteria to remove (e.g. customers/1234/sharedCriteria/5678~9012)",
        },
      },
      required: ["resource_names"],
    },
  },
  {
    name: "google_ads_add_campaign_negatives",
    description: "Add negative keywords at the campaign level. Use for campaign-specific negatives that shouldn't be in a shared list.",
    inputSchema: {
      additionalProperties: false,
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
    name: "google_ads_remove_campaign_negatives",
    description: "Remove campaign-level negative keywords by their resource names. Get resource names from a GAQL query on campaign_criterion.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        resource_names: {
          type: "array",
          items: { type: "string" },
          description: "Resource names of the campaign criteria to remove (e.g. customers/1234/campaignCriteria/5678~9012)",
        },
      },
      required: ["resource_names"],
    },
  },
  {
    name: "google_ads_remove_adgroup_negatives",
    description: "Remove ad-group-level negative keywords by their resource names. Get resource names from a GAQL query on ad_group_criterion.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        resource_names: {
          type: "array",
          items: { type: "string" },
          description: "Resource names of the ad group criteria to remove (e.g. customers/1234/adGroupCriteria/5678~9012)",
        },
      },
      required: ["resource_names"],
    },
  },
  {
    name: "google_ads_pause_keywords",
    description: "Pause active keywords by their criterion resource names.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        criterion_resource_names: { type: "array", items: { type: "string" }, description: "Full resource names like customers/123/adGroupCriteria/456~789" },
      },
      required: ["criterion_resource_names"],
    },
  },
  {
    name: "google_ads_update_campaign_tracking",
    description: "Update campaign tracking parameters: final URL suffix, tracking URL template, and/or custom URL parameters. Use google_ads_get_campaign_tracking first to see current values.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to update" },
        final_url_suffix: { type: "string", description: "New final URL suffix (appended to landing page URLs). Set to empty string to clear." },
        tracking_url_template: { type: "string", description: "New tracking URL template. Set to empty string to clear." },
        url_custom_parameters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Parameter name (without {_ } wrapper)" },
              value: { type: "string", description: "Parameter value (can include ValueTrack macros)" },
            },
            required: ["key", "value"],
          },
          description: "Custom URL parameters (replaces all existing custom params)",
        },
      },
      required: ["campaign_id"],
    },
  },
  // ============================================
  // REPORTING TOOLS
  // ============================================
  {
    name: "google_ads_keyword_performance",
    description: "Get keyword performance report with metrics including impressions, clicks, cost, conversions, quality score components (quality score, expected CTR, ad relevance, landing page experience), and impression share metrics.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter keywords containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_keyword_performance_by_conversion",
    description: "Get keyword performance broken down by conversion action. Shows which keywords drive which conversion types (e.g., form fills, MQLs, etc.).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter keywords containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_report",
    description: "Get search term report showing actual search queries that triggered ads, with the keyword they matched to.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter by keyword text" },
        search_term_contains: { type: "string", description: "Filter search terms containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_report_by_conversion",
    description: "Get search term report broken down by conversion action. Shows which search queries drive which conversion types.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter by keyword text" },
        search_term_contains: { type: "string", description: "Filter search terms containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_ad_performance",
    description: "Get ad performance report with metrics, ad copy (headlines/descriptions), final URLs, and ad strength rating.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_ad_performance_by_conversion",
    description: "Get ad performance broken down by conversion action. Shows which ads drive which conversion types.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_list_conversion_actions",
    description: "List all available conversion actions (e.g., form fills, MQLs, etc.) to understand what conversion tracking is set up.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to get insights for (required, one campaign at a time)" },
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
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID" },
        insight_id: { type: "string", description: "The insight category ID from google_ads_search_term_insights results" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
      },
      required: ["campaign_id", "insight_id", "start_date", "end_date"],
    },
  },
  {
    name: "google_ads_update_campaign_budget",
    description: "Update the daily budget for a campaign. Can update the existing budget amount or create a new solo budget and reassign the campaign to it (useful for breaking shared budgets).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to update" },
        daily_budget: { type: "number", description: "New daily budget in dollars" },
        create_new_budget: { type: "boolean", description: "If true, creates a new budget and reassigns this campaign to it (breaks shared budgets). If false, updates the existing budget amount in place (affects all campaigns sharing it)." },
      },
      required: ["campaign_id", "daily_budget"],
    },
  },
  {
    name: "google_ads_gaql_query",
    description: "Execute a raw GAQL (Google Ads Query Language) query. Use this for custom reports or accessing any Google Ads API resource not covered by other tools. See https://developers.google.com/google-ads/api/docs/query/overview for GAQL syntax.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        query: { type: "string", description: "The GAQL query to execute" },
      },
      required: ["query"],
    },
  },
  {
    name: "google_ads_keyword_volume",
    description: "Get historical search volume estimates for a list of keywords using the Google Ads Keyword Planner. Returns avg monthly searches, competition level, and CPC bid range for each keyword.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string", description: "The Google Ads customer ID" },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "List of keywords to get volume estimates for (max 20 per call)",
        },
        geo_target_constants: {
          type: "array",
          items: { type: "string" },
          description: "Geo target resource names, e.g. ['geoTargetConstants/2840'] for US. Defaults to US if omitted.",
        },
        language: {
          type: "string",
          description: "Language resource name, e.g. 'languageConstants/1000' for English. Defaults to English if omitted.",
        },
      },
      required: ["keywords"],
    },
  },
];
