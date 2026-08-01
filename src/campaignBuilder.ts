import { enums } from "google-ads-api";

/**
 * Pure builders for campaign creation. Produces the raw operation payloads
 * that would be submitted via customer.campaigns.create / campaignBudgets.create
 * / campaignCriteria.create. Kept as pure functions so they can be unit tested
 * without needing a live Google Ads API client.
 *
 * Note: we return the payloads, not the operations, so callers can still use
 * typed create(...) paths. For criteria, we return an array that may be empty.
 */

export type ChannelType = "SEARCH" | "DEMAND_GEN";
export type BiddingStrategy = "MANUAL_CPC" | "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS" | "TARGET_CPA";

export interface CampaignCreateInput {
  name: string;
  budget_amount_micros: number;
  channel_type?: ChannelType;
  bidding_strategy?: BiddingStrategy;
  target_cpa?: number;         // dollars
  target_cpc_cap?: number;     // dollars, optional cap for MAXIMIZE_CLICKS
  geo_target_ids?: string[];
  language_id?: string;        // default "1000" (English)
  start_date?: string;         // YYYY-MM-DD
  end_date?: string;           // YYYY-MM-DD
}

export interface CampaignCreatePayload {
  budget: Record<string, any>;
  campaign: Record<string, any>;
  /** Campaign-criterion payloads. `campaign` resource name is applied later
   *  (after the campaign exists). Here the shape is pre-resolution. */
  criteria: Array<Record<string, any>>;
}

/**
 * Build the operation payloads for a campaign creation. Does NOT attach
 * resource_name references that only exist post-budget-create; the caller
 * still has to call the budget first, then interpolate.
 *
 * Back-compat: calling with just {name, budget_amount_micros} produces the
 * exact same SEARCH + manual_cpc + no-criteria shape as v1.1.
 */
export function buildCampaignCreatePayload(input: CampaignCreateInput): CampaignCreatePayload {
  const budget = {
    name: `${input.name} Budget`,
    amount_micros: input.budget_amount_micros,
    delivery_method: enums.BudgetDeliveryMethod.STANDARD,
    // Google Ads API defaults to explicitly_shared=true when omitted, which
    // makes auto-bidding strategies (MAXIMIZE_CONVERSIONS, TARGET_CPA, etc.)
    // reject with "Bidding strategy type is incompatible with shared budget".
    // Every MCP-created campaign has a 1:1 dedicated budget, so pin this
    // explicitly to false.
    explicitly_shared: false,
  };

  const channelType = input.channel_type ?? "SEARCH";
  const channelEnum =
    channelType === "DEMAND_GEN"
      ? enums.AdvertisingChannelType.DEMAND_GEN
      : enums.AdvertisingChannelType.SEARCH;

  // Default bidding: SEARCH → MANUAL_CPC (back-compat); DEMAND_GEN → MAXIMIZE_CONVERSIONS.
  const strategy: BiddingStrategy =
    input.bidding_strategy ?? (channelType === "DEMAND_GEN" ? "MAXIMIZE_CONVERSIONS" : "MANUAL_CPC");

  const campaign: Record<string, any> = {
    name: input.name,
    status: enums.CampaignStatus.PAUSED,
    advertising_channel_type: channelEnum,
    // EuPoliticalAdvertisingStatus enum: 3 = DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING.
    // Required for all new campaigns in API v23+. Must be a non-zero enum value
    // (proto3 strips default/zero values, so `false`/0 gets omitted and the API
    // rejects with "required field not present").
    contains_eu_political_advertising:
      enums.EuPoliticalAdvertisingStatus?.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING ?? 3,
    // API defaults geo_target_type_setting.positive_geo_target_type to
    // PRESENCE_OR_INTEREST when omitted, which serves ads worldwide to anyone
    // "interested in" the targeted location regardless of correct geo_target_ids.
    // Always PRESENCE — caught 3x in production (2026-07-20, 07-31, 08-01) via
    // next-day monitoring because this field was never set at creation time.
    geo_target_type_setting: {
      positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
    },
  };

  // DEMAND_GEN campaigns use target_google_search: true to signal Demand Gen
  // surfaces (YouTube, Discover, Gmail). target_content_network must be false —
  // the API rejects DEMAND_GEN with content_network=true as of Apr 2026.
  // audience_setting.use_audience_grouped=true is required for all DG campaigns.
  // SEARCH path retains the historical behavior of omitting these settings.
  if (channelType === "DEMAND_GEN") {
    campaign.network_settings = {
      target_google_search: true,
      target_search_network: false,
      target_content_network: false,
      target_partner_search_network: false,
    };
    campaign.audience_setting = { use_audience_grouped: true };
  }

  if (input.start_date) campaign.start_date = input.start_date;
  if (input.end_date) campaign.end_date = input.end_date;

  switch (strategy) {
    case "MANUAL_CPC":
      campaign.manual_cpc = {};
      break;
    case "MAXIMIZE_CONVERSIONS":
      campaign.maximize_conversions = {};
      break;
    case "TARGET_CPA": {
      if (typeof input.target_cpa !== "number") {
        throw new Error("bidding_strategy=TARGET_CPA requires target_cpa (dollars)");
      }
      campaign.target_cpa = { target_cpa_micros: Math.round(input.target_cpa * 1_000_000) };
      break;
    }
    case "MAXIMIZE_CLICKS": {
      // Google Ads API calls this "target_spend". Optional cpc_bid_ceiling_micros
      // caps per-click spend when the user wants MAXIMIZE_CLICKS with a ceiling.
      const cap: Record<string, any> = {};
      if (typeof input.target_cpc_cap === "number") {
        cap.cpc_bid_ceiling_micros = Math.round(input.target_cpc_cap * 1_000_000);
      }
      campaign.target_spend = cap;
      break;
    }
  }

  const criteria: Array<Record<string, any>> = [];
  for (const geoId of input.geo_target_ids ?? []) {
    criteria.push({ location: { geo_target_constant: `geoTargetConstants/${geoId}` } });
  }

  // Always add a language criterion when geo targeting or language is being set
  // (default to English "1000"). When neither is provided, leave criteria empty
  // so the back-compat SEARCH case stays a no-op.
  const hasGeo = (input.geo_target_ids?.length ?? 0) > 0;
  if (hasGeo || input.language_id) {
    const langId = input.language_id ?? "1000";
    criteria.push({ language: { language_constant: `languageConstants/${langId}` } });
  }

  return {
    budget,
    campaign,
    criteria,
  };
}
