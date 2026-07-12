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
    name: "google_ads_set_ad_group_location_targeting",
    description: "Add location (geo) targeting criteria at the ad group level. Required for Demand Gen campaigns — Demand Gen sets location at ad group level, not campaign level. Pass numeric geo target IDs (e.g. '2840' for USA). Existing criteria are NOT removed.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        geo_target_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric geo target constant IDs, e.g. ['2840', '2124'] for USA + Canada.",
        },
      },
      required: ["ad_group_id", "geo_target_ids"],
    },
  },
  {
    name: "google_ads_set_campaign_location_targeting",
    description: "Add location (geo) targeting criteria to an existing campaign. Mirrors the geo_target_ids parameter available at campaign creation. Pass the numeric geo target IDs (e.g. '2840' for USA, '2124' for Canada). Existing location criteria are NOT removed — call GAQL to check first if needed.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
        geo_target_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric geo target constant IDs, e.g. ['2840', '2124'] for USA + Canada.",
        },
      },
      required: ["campaign_id", "geo_target_ids"],
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
    name: "google_ads_add_adgroup_negatives",
    description: "Add negative keywords at the ad-group level. Use when only one ad group in a campaign should exclude the term — other ad groups in the same campaign can still match it. For campaign-wide exclusion use google_ads_add_campaign_negatives instead.",
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
      },
      required: ["ad_group_id", "keywords"],
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
    name: "google_ads_update_ad_asset_automation",
    description: "Set asset_automation_settings (auto-generated video, image enhancements, etc.) on one or more AdGroupAds. Use this to opt Demand Gen multi-asset ads OUT of Google's auto-generation features so creative output stays under advertiser control. Likely Demand Gen UI mappings (verify in UI on first use): 'Auto-generate video' → GENERATE_VIDEOS_FROM_OTHER_ASSETS; 'Adaptive layouts' → GENERATE_DESIGN_VERSIONS_FOR_IMAGES. Auto-applies today's Claude-MM-DD-YY label.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric ad IDs OR full ad_group_ad resource names. Resource names are preferred when an ad ID exists in multiple ad groups.",
        },
        automation_types: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "TEXT_ASSET_AUTOMATION",
              "GENERATE_VERTICAL_YOUTUBE_VIDEOS",
              "GENERATE_SHORTER_YOUTUBE_VIDEOS",
              "GENERATE_LANDING_PAGE_PREVIEW",
              "GENERATE_ENHANCED_YOUTUBE_VIDEOS",
              "GENERATE_IMAGE_ENHANCEMENT",
              "GENERATE_IMAGE_EXTRACTION",
              "GENERATE_DESIGN_VERSIONS_FOR_IMAGES",
              "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION",
              "GENERATE_VIDEOS_FROM_OTHER_ASSETS",
            ],
          },
          description: "AssetAutomationType enum names to set. For Demand Gen 'auto-generate video' + 'adaptive layouts' opt-out, default candidates are GENERATE_VIDEOS_FROM_OTHER_ASSETS and GENERATE_DESIGN_VERSIONS_FOR_IMAGES.",
        },
        status: {
          type: "string",
          enum: ["OPTED_IN", "OPTED_OUT"],
          description: "Default OPTED_OUT.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional custom labels (added alongside auto-applied Claude-MM-DD-YY label).",
        },
      },
      required: ["ad_ids", "automation_types"],
    },
  },
  {
    name: "google_ads_get_campaign_diagnostics",
    description: "Diagnose why a campaign is not spending or serving. Returns primary_status, primary_status_reasons, serving_status, budget, bidding strategy, and last-7-days metrics in a single call. Use this as the first step when a campaign has unexpectedly low spend or impressions.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: {
          type: "array",
          items: { type: "string" },
          description: "One or more numeric campaign IDs to diagnose. If omitted, returns diagnostics for all enabled campaigns.",
        },
      },
    },
  },
  {
    name: "google_ads_get_ad_strength",
    description: "Get the ad strength rating (POOR, AVERAGE, GOOD, EXCELLENT) for RSAs in a campaign or ad group, along with headline/description counts. Ad strength below GOOD suppresses delivery. Use this to identify ads that need more creative assets.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: {
          type: "array",
          items: { type: "string" },
          description: "Filter by numeric campaign IDs.",
        },
        ad_group_ids: {
          type: "array",
          items: { type: "string" },
          description: "Filter by ad group IDs.",
        },
      },
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
    description: "Create a Demand Gen Multi-Asset ad under a DEMAND_GEN_MULTI_ASSET_AD_GROUP (will be PAUSED until approved). Supports both image-based and video-only ads. Validates character limits and count caps before the API call: headlines (max 5, ≤40 chars each), long_headlines (max 5, ≤90 chars), descriptions (max 5, ≤90 chars). For image ads: marketing_image_asset_ids (1.91:1 landscape, ≥1); for video-only ads, omit images. Square/portrait/logo assets are optional. call_to_action is a string enum value such as 'LEARN_MORE' or 'SHOP_NOW'. Auto-labels the created ad.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        name: {
          type: "string",
          description: "Optional internal ad name (not user-facing) shown in the UI's Ad column — e.g. 'Gartner CIO AI - NAM Gov'. Set it to avoid the generic auto-name ('Ad 1'). NOTE: immutable after creation on DG multi-asset ads, so set it here.",
        },
        final_urls: { type: "array", items: { type: "string" } },
        business_name: { type: "string" },
        call_to_action: {
          type: "string",
          description: "CallToAction enum value, e.g. LEARN_MORE, SHOP_NOW, SIGN_UP, DOWNLOAD, BOOK_NOW, CONTACT_US, GET_QUOTE, APPLY_NOW, SUBSCRIBE, BUY_NOW, DONATE_NOW, ORDER_NOW, PLAY_NOW, SEE_MORE, START_NOW, VISIT_SITE, WATCH_NOW.",
        },
        marketing_image_asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "1.91:1 landscape marketing image asset IDs (min 1 for image-based ads). Optional for video-only ads. Get IDs from google_ads_create_image_asset.",
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
        "headlines",
        "descriptions",
      ],
    },
  },
  {
    name: "google_ads_update_demand_gen_multi_asset_ad",
    description: "Attempt to update copy on a Demand Gen ad. WARNING: on Demand Gen MULTI-ASSET ads the entire creative — headlines, descriptions, AND images — is IMMUTABLE after creation; the Google Ads API rejects any such update with IMMUTABLE_FIELD (verified live 2026-07-12). To change ANY creative on a multi-asset ad you must RECREATE it (create a new ad + pause the old one), not update it. This tool is retained for DG ad formats that may permit copy edits; against a multi-asset ad it will error. Provide the ad's resource name (customers/XXX/adGroupAds/YYY~ZZZ) or numeric ad ID.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_resource_name: {
          type: "string",
          description: "Full resource name (e.g. customers/7158566222/adGroupAds/200360442360~814405338431) or numeric ad ID (814405338431). If numeric ID, the tool resolves it to the full name.",
        },
        headlines: {
          type: "array",
          description: "Optional: max 5 headlines, each ≤40 characters. Omit to keep current value.",
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
          description: "Optional: max 5 long headlines, each ≤90 characters. Omit to keep current value.",
          items: { type: "string" },
        },
        descriptions: {
          type: "array",
          description: "Optional: max 5 descriptions, each ≤90 characters. Omit to keep current value.",
          items: { type: "string" },
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Optional additional labels (auto-applied Claude-MM-DD-YY label is added regardless).",
        },
      },
      required: [
        "customer_id",
        "ad_resource_name",
      ],
    },
  },
  {
    name: "google_ads_create_page_feed",
    description: "Create an AI Max / DSA page feed (AssetSet of type PAGE_FEED) and attach it to a campaign. Each URL becomes a PageFeedAsset tagged with the given label. Use this to constrain AI Max final-URL expansion to a specific list of landing pages. Returns the AssetSet resource name and the number of URLs added.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "Numeric campaign ID to attach the page feed to." },
        name: { type: "string", description: "Display name for the AssetSet (shown in Business Data)." },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "List of full landing page URLs to include.",
        },
        label: { type: "string", description: "Custom label applied to all feed items (default: 'page-feed')." },
      },
      required: ["campaign_id", "name", "urls"],
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
  {
    name: "google_ads_create_lead_form_asset",
    description: "Create a LeadFormAsset (Google Demand Gen / Discovery / Search lead form). Validates required fields, enum membership, and Google's character limits before hitting the API. After creation, use google_ads_link_asset_to_campaign with field_type=LEAD_FORM to attach it to a campaign. v1 supports standard fields only (FULL_NAME, EMAIL, WORK_EMAIL, PHONE_NUMBER, COMPANY_NAME, JOB_TITLE, etc.); custom questions, qualifying questions, and CRM delivery_methods (webhook) are NOT yet supported — leads must be downloaded from Google Ads UI as CSV until delivery_methods ships. Auto-labels the created asset. Returns {asset_id, resource_name, name}.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string", description: "Human-readable asset name shown in the Google Ads UI." },
        business_name: { type: "string", description: "Business name shown on the form (≤25 chars)." },
        call_to_action: {
          type: "string",
          enum: ["LEARN_MORE", "GET_QUOTE", "APPLY_NOW", "SIGN_UP", "CONTACT_US", "SUBSCRIBE", "DOWNLOAD", "BOOK_NOW", "GET_OFFER", "REGISTER", "GET_INFO", "REQUEST_DEMO", "JOIN_NOW", "GET_STARTED"],
          description: "Primary CTA enum on the form (button label).",
        },
        call_to_action_description: {
          type: "string",
          description: "Secondary CTA description text (≤30 chars). Shown alongside the CTA button.",
        },
        headline: { type: "string", description: "Form headline (≤30 chars)." },
        description: { type: "string", description: "Form description / value proposition (≤200 chars)." },
        privacy_policy_url: { type: "string", description: "https:// URL to the privacy policy. Required by Google." },
        privacy_policy_text: { type: "string", description: "Optional custom privacy policy disclosure text." },
        final_urls: {
          type: "array",
          items: { type: "string" },
          description: "Required by Google. At least one https:// landing URL — e.g. the landing page for the offer. Distinct from privacy_policy_url. Without this the API returns REQUIRED_NONEMPTY_LIST on operations.create.final_urls.",
        },
        post_submit_headline: { type: "string", description: "Confirmation screen headline (≤25 chars)." },
        post_submit_description: { type: "string", description: "Confirmation screen description (≤200 chars)." },
        post_submit_call_to_action: {
          type: "string",
          enum: ["VISIT_SITE", "DOWNLOAD", "LEARN_MORE", "SHOP_NOW"],
          description: "Post-submit CTA enum.",
        },
        desired_intent: {
          type: "string",
          enum: ["LOW_INTENT", "HIGH_INTENT"],
          description: "Optional. LOW_INTENT (more leads, lower quality) vs HIGH_INTENT (review screen before submit; fewer/higher-quality leads). Defaults to Google's default if omitted.",
        },
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: ["FULL_NAME", "EMAIL", "PHONE_NUMBER", "POSTAL_CODE", "STREET_ADDRESS", "CITY", "REGION", "COUNTRY", "WORK_EMAIL", "COMPANY_NAME", "WORK_PHONE", "JOB_TITLE"],
          },
          description: "Standard fields collected from the user. Must include EMAIL or WORK_EMAIL.",
        },
        background_image_asset_id: {
          type: "string",
          description: "Optional. Numeric asset_id of a previously-uploaded image asset to use as the form background. Use google_ads_create_image_asset to create one first.",
        },
      },
      required: [
        "name",
        "business_name",
        "call_to_action",
        "call_to_action_description",
        "headline",
        "description",
        "privacy_policy_url",
        "final_urls",
        "post_submit_headline",
        "post_submit_description",
        "post_submit_call_to_action",
        "fields",
      ],
    },
  },
  // ============================================
  // EXPERIMENT TOOLS
  // ============================================
  {
    name: "google_ads_create_experiment",
    description: "Create a SEARCH_CUSTOM experiment (A/B test) on an existing campaign. Google automatically creates a treatment campaign as a copy of the base. Returns experiment_id and treatment_campaign_id so you can modify the treatment arm (e.g. change final URLs, add RSAs) before scheduling. Use google_ads_schedule_experiment to go live.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        base_campaign_id: {
          type: "string",
          description: "Numeric ID of the base (control) campaign.",
        },
        name: {
          type: "string",
          description: "Human-readable experiment name.",
        },
        description: {
          type: "string",
          description: "Optional description.",
        },
        suffix: {
          type: "string",
          description: "Suffix appended to the auto-created treatment campaign name. Defaults to ' [EXP]'.",
        },
        traffic_split_percent: {
          type: "number",
          description: "Percent of traffic sent to the treatment arm (1–99). Defaults to 50.",
        },
        start_date: {
          type: "string",
          description: "YYYY-MM-DD start date. Defaults to today.",
        },
        end_date: {
          type: "string",
          description: "YYYY-MM-DD end date.",
        },
      },
      required: ["base_campaign_id", "name"],
    },
  },
  {
    name: "google_ads_list_experiments",
    description: "List all experiments in the account, optionally filtered by base campaign ID.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: {
          type: "string",
          description: "Optional: filter to experiments on this base campaign.",
        },
        status_filter: {
          type: "string",
          enum: ["ALL", "SETUP", "ENABLED", "HALTED", "PROMOTED", "GRADUATED"],
          description: "Filter by status. Defaults to ALL (excluding REMOVED).",
        },
      },
    },
  },
  {
    name: "google_ads_get_experiment",
    description: "Get full details for an experiment including its arms and treatment campaign ID.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        experiment_id: {
          type: "string",
          description: "Numeric experiment ID (from google_ads_create_experiment or google_ads_list_experiments).",
        },
      },
      required: ["experiment_id"],
    },
  },
  {
    name: "google_ads_schedule_experiment",
    description: "Start a SETUP experiment so it begins serving traffic. Moves status from SETUP → ENABLED.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        experiment_id: { type: "string" },
      },
      required: ["experiment_id"],
    },
  },
  {
    name: "google_ads_end_experiment",
    description: "Halt a running experiment. Traffic returns entirely to the base (control) campaign. Moves status to HALTED.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        experiment_id: { type: "string" },
      },
      required: ["experiment_id"],
    },
  },
  {
    name: "google_ads_promote_experiment",
    description: "Graduate the treatment arm to become the permanent campaign (replaces base). Use when the treatment wins. Moves status to PROMOTED.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        experiment_id: { type: "string" },
        validate_only: {
          type: "boolean",
          description: "Dry-run: validate without actually promoting. Defaults to false.",
        },
      },
      required: ["experiment_id"],
    },
  },
  {
    name: "google_ads_remove_experiment",
    description: "Permanently remove an experiment that is in SETUP status. Use to clean up orphaned or misconfigured experiments before recreating them. Only works on SETUP experiments (not yet scheduled/running).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        experiment_id: {
          type: "string",
          description: "Numeric experiment ID to remove.",
        },
      },
      required: ["experiment_id"],
    },
  },
  {
    name: "google_ads_update_campaign_ad_urls",
    description: "Bulk-replace the final URL on every enabled ad in a campaign. Used to point an experiment treatment campaign at a new landing page. Returns a dry-run preview unless execute=true.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: {
          type: "string",
          description: "Campaign whose ads will be updated.",
        },
        new_final_url: {
          type: "string",
          description: "The new final URL to set on all ads (e.g. 'https://www.forcepoint.com/form/dlp-free-trial').",
        },
        execute: {
          type: "boolean",
          description: "Set true to apply changes. Omit or false for a dry-run preview of affected ads.",
        },
      },
      required: ["campaign_id", "new_final_url"],
    },
  },
  {
    name: "google_ads_update_ad_final_urls",
    description: "Update final_urls on specific ads by ID, leaving other ads in the same campaign/ad group untouched. Use this when you need to retarget a subset of ads (e.g. one ad group's ads, or specific experiment-arm-labeled ads) without affecting siblings in the same campaign. Dry-run by default — pass confirm=true to apply.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: {
          type: "string",
          description: "Numeric ad group ID. Required: each ad belongs to exactly one ad group, and the AdService resource name is ad_group_ad/{ad_group_id}~{ad_id}.",
        },
        ad_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric ad IDs to update. All ads must live in the specified ad_group_id.",
        },
        new_final_url: {
          type: "string",
          description: "New final URL (must start with http:// or https://). Replaces existing final_urls with [new_final_url].",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to apply. Omit or false for dry-run preview.",
        },
      },
      required: ["ad_group_id", "ad_ids", "new_final_url"],
    },
  },
  {
    name: "google_ads_rename_ad_group",
    description: "Rename an ad group. DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to preview the change.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string", description: "Numeric ID of the ad group to rename." },
        new_name: { type: "string", description: "New ad group name." },
        confirm: {
          type: "boolean",
          description: "Must be true to apply the rename. Omit or false for dry-run preview.",
        },
      },
      required: ["ad_group_id", "new_name"],
    },
  },
  {
    name: "google_ads_rename_campaign",
    description: "Rename a campaign. DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to preview the change. Note: renaming a campaign does NOT update its url_custom_parameters (utmcampaign value carries the literal old name). Pair with google_ads_update_campaign_tracking to sync.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "Numeric ID of the campaign to rename." },
        new_name: { type: "string", description: "New campaign name." },
        confirm: {
          type: "boolean",
          description: "Must be true to apply the rename. Omit or false for dry-run preview.",
        },
      },
      required: ["campaign_id", "new_name"],
    },
  },
  {
    name: "google_ads_link_asset_to_campaign",
    description: "Link an existing asset to one or more campaigns by field type. Supports SITELINK, CALLOUT, STRUCTURED_SNIPPET, and LEAD_FORM. Create the asset first (e.g. with google_ads_create_sitelink or google_ads_create_lead_form_asset), then use this to attach it to campaigns. DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to preview.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        asset_id: { type: "string", description: "Numeric ID of the existing asset to link." },
        campaign_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of campaigns to link the asset to.",
        },
        field_type: {
          type: "string",
          enum: ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "LEAD_FORM"],
          description: "Asset field type — determines how the asset appears in ads.",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to apply. Omit or false for dry-run preview.",
        },
      },
      required: ["asset_id", "campaign_ids", "field_type"],
    },
  },
  {
    name: "google_ads_attach_user_list_audience",
    description: "Attach a Customer Match / user-list audience to one or more ad groups. Defaults to OBSERVATION mode (reporting-only, does not restrict delivery) — pass mode='TARGETING' to restrict delivery to list members. Use for measuring on-list reach/CPM/conversions of existing campaigns without changing targeting. Get user_list_id from a GAQL query on user_list. DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to preview.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric IDs of ad groups to attach the user list to.",
        },
        user_list_id: { type: "string", description: "Numeric ID of the user_list (Customer Match list, similar audience, etc)." },
        mode: {
          type: "string",
          enum: ["OBSERVATION", "TARGETING"],
          description: "OBSERVATION (default) reports on list members without restricting delivery. TARGETING restricts the ad group to list members only.",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to apply. Omit or false for dry-run preview.",
        },
      },
      required: ["ad_group_ids", "user_list_id"],
    },
  },
  {
    name: "google_ads_create_and_attach_audience_bundle",
    description: "Create an Audience resource that bundles one or more user_lists (Customer Match lists, lookalikes, etc.) and attach it to ad groups. OR pass `existing_audience_id` to skip creation and attach an existing Audience to additional ad groups (useful for replicating one bundle across many campaigns/theaters). Required for Demand Gen ad groups whose use_audience_grouped flag is set (where direct user_list criterion attachment is rejected with CANNOT_ADD_AUDIENCE_SEGMENT_CRITERION_WHEN_AUDIENCE_GROUPED_IS_SET). Also handles Lookalike audiences which can never be attached as direct user_list criteria. Note: each ad group can only have one Audience criterion (ONE_AUDIENCE_ALLOWED_PER_AD_GROUP) — the call will fail for ad groups that already have one. The bundled audience is attached as a signal — for Demand Gen this informs optimization without restricting delivery (observation-equivalent) and surfaces in ad_group_audience_view reports. DRY-RUN BY DEFAULT: omit `confirm` or pass `confirm: false` to preview.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string", description: "Name for the new Audience resource (required when creating; ignored when existing_audience_id is set)." },
        description: { type: "string", description: "Optional human-readable description of the audience." },
        user_list_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric IDs of user_lists to bundle into the audience. Required when creating; ignored when existing_audience_id is set.",
        },
        existing_audience_id: {
          type: "string",
          description: "Optional: numeric ID of an existing Audience resource to attach instead of creating a new one. When set, name and user_list_ids are ignored.",
        },
        ad_group_ids: {
          type: "array",
          items: { type: "string" },
          description: "Numeric IDs of ad groups to attach the bundled audience to.",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to apply. Omit or false for dry-run preview.",
        },
      },
      required: ["ad_group_ids"],
    },
  },
];
