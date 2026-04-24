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
    description: "Create a new campaign (will be PAUSED until approved). Defaults: channel_type=SEARCH, bidding_strategy=MANUAL_CPC (SEARCH) or MAXIMIZE_CONVERSIONS (DEMAND_GEN), language_id=1000 (English). For DEMAND_GEN provide geo_target_ids (Google Ads geo target constant IDs, e.g. '21134' for Alaska). TARGET_CPA requires target_cpa (dollars). MAXIMIZE_CLICKS may take target_cpc_cap (dollars). start_date/end_date are YYYY-MM-DD.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string" },
        daily_budget: { type: "number", description: "Daily budget in dollars" },
        channel_type: {
          type: "string",
          enum: ["SEARCH", "DEMAND_GEN"],
          description: "Advertising channel type. Defaults to SEARCH.",
        },
        bidding_strategy: {
          type: "string",
          enum: ["MANUAL_CPC", "MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA"],
          description: "Bidding strategy. Defaults to MANUAL_CPC for SEARCH, MAXIMIZE_CONVERSIONS for DEMAND_GEN.",
        },
        target_cpa: {
          type: "number",
          description: "Target CPA in dollars (required if bidding_strategy=TARGET_CPA).",
        },
        target_cpc_cap: {
          type: "number",
          description: "Optional CPC ceiling in dollars for MAXIMIZE_CLICKS strategy.",
        },
        geo_target_ids: {
          type: "array",
          items: { type: "string" },
          description: "Google Ads geo target constant IDs (e.g. '21134' = Alaska, '21141' = Maine).",
        },
        language_id: {
          type: "string",
          description: "Language constant ID. Defaults to '1000' (English).",
        },
        start_date: {
          type: "string",
          description: "YYYY-MM-DD start date (optional).",
        },
        end_date: {
          type: "string",
          description: "YYYY-MM-DD end date (optional).",
        },
      },
      required: ["name", "daily_budget"],
    },
  },
  {
    name: "google_ads_create_ad_group",
    description: "Create a new ad group (will be PAUSED until approved). Returns ad group ID. type defaults to SEARCH_STANDARD for back-compat; use DEMAND_GEN_MULTI_ASSET_AD_GROUP for Demand Gen campaigns.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
        name: { type: "string" },
        cpc_bid: { type: "number", description: "CPC bid in dollars" },
        type: {
          type: "string",
          enum: ["SEARCH_STANDARD", "DEMAND_GEN_MULTI_ASSET_AD_GROUP"],
          description: "Ad group type. Defaults to SEARCH_STANDARD. Use DEMAND_GEN_MULTI_ASSET_AD_GROUP for Demand Gen campaigns.",
        },
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
    description: "Enable paused campaigns, ad groups, or ads. REQUIRES USER APPROVAL. Use after reviewing in Google Ads UI. Auto-applies today's `Claude-MM-DD-YY` label; pass `labels` to attach additional custom labels so different enable operations stay distinguishable.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional custom labels to apply to every enabled item (in addition to the auto-applied `Claude-MM-DD-YY` label). Labels are created if they don't exist.",
        },
      },
    },
  },
  {
    name: "google_ads_pause_items",
    description: "Pause enabled campaigns, ad groups, or ads. REQUIRES USER APPROVAL. This will stop items from serving. Auto-applies today's `Claude-MM-DD-YY` label; pass `labels` to attach additional custom labels so different pause operations stay distinguishable (e.g. `fix-landing-page-redirect`).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional custom labels to apply to every paused item (in addition to the auto-applied `Claude-MM-DD-YY` label). Labels are created if they don't exist.",
        },
      },
    },
  },
  {
    name: "google_ads_remove_items",
    description: "Remove campaigns, ad groups, or ads permanently. IRREVERSIBLE at the API level (reports on removed resources still work). DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to get a preview; pass `confirm: true` to actually remove. Labels are applied BEFORE removal so the audit trail survives. Removals run in child-up order (ads → ad_groups → campaigns) so parent removes don't fail on enabled children. Auto-applies today's `Claude-MM-DD-YY` label.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
        confirm: {
          type: "boolean",
          description: "Must be true to actually remove. Omit or false for dry-run preview.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional custom labels to apply BEFORE removal (label-first ordering keeps the audit trail intact). Labels are created if they don't exist.",
        },
      },
    },
  },
  {
    name: "google_ads_apply_label",
    description: "Attach a label to existing campaigns, ad groups, or ads without changing their status. Label is created if it doesn't exist. Useful for tagging items for audit trails or bulk ops.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        label: {
          type: "string",
          description: "Label name. Created if it doesn't exist.",
        },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
      },
      required: ["label"],
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
    name: "google_ads_enable_keywords",
    description: "Enable paused keywords by their criterion resource names. REQUIRES USER APPROVAL. Use after reviewing in Google Ads UI. Auto-applies today's `Claude-MM-DD-YY` label; pass `labels` to attach additional custom labels so different enable operations stay distinguishable.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        criterion_resource_names: { type: "array", items: { type: "string" }, description: "Full resource names like customers/123/adGroupCriteria/456~789" },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional custom labels to apply to every enabled keyword (in addition to the auto-applied `Claude-MM-DD-YY` label). Labels are created if they don't exist.",
        },
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
    name: "google_ads_update_campaign_bidding",
    description: "Update a campaign's bidding strategy and/or target CPA / target ROAS. If `strategy` is omitted the current strategy is preserved and only the target values are updated (useful for adding a tCPA to an existing Max Conversions campaign). Dollar amounts are in dollars (converted to micros internally). target_roas is a decimal (e.g., 3.0 = 300%).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to update" },
        strategy: {
          type: "string",
          enum: ["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE", "TARGET_CPA", "TARGET_ROAS", "MANUAL_CPC", "MAXIMIZE_CLICKS"],
          description: "Optional. New bidding strategy. If omitted, keeps current strategy and only updates target values.",
        },
        target_cpa_dollars: { type: "number", description: "Target CPA in dollars. Applies to MAXIMIZE_CONVERSIONS (optional ceiling) or TARGET_CPA (required)." },
        target_roas: { type: "number", description: "Target ROAS as decimal (3.0 = 300%). Applies to MAXIMIZE_CONVERSION_VALUE or TARGET_ROAS." },
      },
      required: ["campaign_id"],
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
    name: "google_ads_update_asset_urls",
    description: "Update the final_urls on one or more assets (e.g. sitelinks, callouts). DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to get a preview. Updating an asset's URL affects EVERY campaign/ad group/customer link that uses that asset ID -- use GAQL against customer_asset/campaign_asset/ad_group_asset to check attachments first.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        updates: {
          type: "array",
          description: "List of assets to update.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              asset_id: { type: "string", description: "Numeric asset ID" },
              final_urls: {
                type: "array",
                items: { type: "string" },
                description: "New final URLs. Must start with http:// or https://.",
              },
            },
            required: ["asset_id", "final_urls"],
          },
        },
        confirm: {
          type: "boolean",
          description: "Must be true to actually update. Omit or false for dry-run preview.",
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "google_ads_create_sitelink",
    description: "Create a new sitelink Asset (link_text + final_urls, optional two description lines). Sitelinks are shared across campaigns/ad groups -- use google_ads_replace_sitelink_url if the goal is to fix a broken URL on an existing sitelink (sitelink final_urls are immutable; the correct pattern is create new + re-link). DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to preview.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        link_text: { type: "string", description: "Clickable sitelink label (max 25 chars)." },
        final_urls: {
          type: "array",
          items: { type: "string" },
          description: "Destination URLs. Must start with http:// or https://.",
        },
        description1: { type: "string", description: "Optional description line 1 (max 35 chars). If set, description2 must also be set." },
        description2: { type: "string", description: "Optional description line 2 (max 35 chars). If set, description1 must also be set." },
        confirm: {
          type: "boolean",
          description: "Must be true to actually create. Omit or false for dry-run preview.",
        },
      },
      required: ["link_text", "final_urls"],
    },
  },
  {
    name: "google_ads_replace_sitelink_url",
    description: "Fix a broken/outdated sitelink URL. Google Ads treats sitelink Asset.final_urls as immutable, so this creates a new sitelink asset with the corrected URL (preserving link_text + descriptions from the old one unless overridden), re-links every campaign / ad-group / customer-level attachment to the new asset, then removes the old links. The old Asset itself is NOT deleted. DRY-RUN BY DEFAULT.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        old_asset_id: { type: "string", description: "Numeric ID of the existing sitelink asset to replace." },
        new_final_urls: {
          type: "array",
          items: { type: "string" },
          description: "New destination URLs for the replacement sitelink. Must start with http:// or https://.",
        },
        new_link_text: { type: "string", description: "Optional override for the sitelink click text (default: preserve from old asset). Max 25 chars." },
        new_description1: { type: "string", description: "Optional override for description line 1 (default: preserve from old asset). Max 35 chars." },
        new_description2: { type: "string", description: "Optional override for description line 2 (default: preserve from old asset). Max 35 chars." },
        confirm: {
          type: "boolean",
          description: "Must be true to actually replace. Omit or false for dry-run preview.",
        },
      },
      required: ["old_asset_id", "new_final_urls"],
    },
  },
  {
    name: "google_ads_pause_asset_links",
    description: "Pause asset links (customer_asset, campaign_asset, or ad_group_asset). Use this to stop a sitelink from serving without deleting the underlying asset. DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to get a preview. Resource name form: customers/{cid}/customerAssets/{assetId}~SITELINK, customers/{cid}/campaignAssets/{campId}~{assetId}~SITELINK, or customers/{cid}/adGroupAssets/{agId}~{assetId}~SITELINK.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        resource_names: {
          type: "array",
          items: { type: "string" },
          description: "Full resource names of the asset links to pause.",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to actually pause. Omit or false for dry-run preview.",
        },
      },
      required: ["resource_names"],
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
  {
    name: "google_ads_create_demand_gen_multi_asset_ad",
    description: "Create a Demand Gen Multi-Asset ad under a DEMAND_GEN_MULTI_ASSET_AD_GROUP (will be PAUSED until approved). Validates character limits and count caps before the API call: headlines (max 5, ≤40 chars each), long_headlines (max 5, ≤90 chars), descriptions (max 5, ≤90 chars). marketing_image_asset_ids is required (1:1 square images, ≥1); square/portrait/logo assets are optional. call_to_action is a string enum value such as 'LEARN_MORE' or 'SHOP_NOW'. Auto-labels the created ad.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        final_urls: { type: "array", items: { type: "string" } },
        business_name: { type: "string" },
        call_to_action: {
          type: "string",
          description: "CallToAction enum value, e.g. LEARN_MORE, SHOP_NOW, SIGN_UP, DOWNLOAD, BOOK_NOW, CONTACT_US, GET_QUOTE, APPLY_NOW, SUBSCRIBE, BUY_NOW, DONATE_NOW, ORDER_NOW, PLAY_NOW, SEE_MORE, START_NOW, VISIT_SITE, WATCH_NOW.",
        },
        marketing_image_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "1.91:1 landscape marketing image asset IDs (min 1). Get IDs from google_ads_create_image_asset.",
        },
        square_marketing_image_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional 1:1 square marketing image asset IDs.",
        },
        portrait_marketing_image_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional 4:5 portrait marketing image asset IDs.",
        },
        logo_image_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional 1:1 logo image asset IDs.",
        },
        headlines: {
          type: "array",
          description: "Max 5 headlines, each ≤40 characters. Each item is a string or { text, pinned_position? }.",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  pinned_position: { type: "number" },
                },
                required: ["text"],
              },
            ],
          },
        },
        long_headlines: {
          type: "array",
          description: "Max 5 long headlines, each ≤90 characters.",
          items: { type: "string" },
        },
        descriptions: {
          type: "array",
          description: "Max 5 descriptions, each ≤90 characters.",
          items: { type: "string" },
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional additional labels (auto-applied Claude-MM-DD-YY label is added regardless).",
        },
      },
      required: [
        "ad_group_id",
        "final_urls",
        "business_name",
        "call_to_action",
        "marketing_image_asset_ids",
        "headlines",
        "descriptions",
      ],
    },
  },
  {
    name: "google_ads_create_image_asset",
    description: "Upload an image asset for use in Demand Gen (or other image-capable) ads. Provide exactly one of file_path (absolute path to PNG/JPG/GIF on disk) or base64_data (raw base64, no data URL prefix). Validates mime type, max 5MB, min dimensions 600x314 (Demand Gen minimum). Auto-labels the created asset. Returns {asset_id, resource_name, name, bytes, mime_type}.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string", description: "Human-readable asset name (shown in the Google Ads UI)." },
        file_path: { type: "string", description: "Absolute path to the image on disk. Mutually exclusive with base64_data." },
        base64_data: { type: "string", description: "Raw base64-encoded image data (no 'data:image/...;base64,' prefix). Mutually exclusive with file_path." },
      },
      required: ["name"],
    },
  },
];
