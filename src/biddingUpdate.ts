// Pure builder for campaign bidding-strategy mutate payloads.
//
// Extracted from GoogleAdsManager.updateCampaignBidding so the mutate-object
// construction is unit-testable independent of the live Google Ads client.

// Ground truth: google-ads-api v23 BiddingStrategyType enum
// (node_modules/google-ads-api/build/src/protos/autogen/enums.d.ts).
// Only the numeric values this tool's `strategy` parameter can actually
// produce are mapped. Anything else (ENHANCED_CPC=2, PERCENT_CPC=12,
// TARGET_IMPRESSION_SHARE=15, etc.) is deliberately left unmapped so the
// "preserve current strategy" fallback in updateCampaignBidding resolves to
// "UNKNOWN" and buildBiddingCampaignUpdate throws — a loud failure beats
// silently coercing an unsupported strategy into the wrong one.
export const BIDDING_TYPE_ENUM_TO_NAME: Record<number, string> = {
  3: "MANUAL_CPC",
  6: "TARGET_CPA",
  8: "TARGET_ROAS",
  9: "MAXIMIZE_CLICKS", // API type TARGET_SPEND=9, exposed to callers as MAXIMIZE_CLICKS
  10: "MAXIMIZE_CONVERSIONS",
  11: "MAXIMIZE_CONVERSION_VALUE",
};

export interface BiddingUpdateOpts {
  resourceName: string;
  targetCpaMicros?: number;
  targetRoas?: number;
}

export function buildBiddingCampaignUpdate(
  strategy: string,
  opts: BiddingUpdateOpts
): Record<string, any> {
  const { resourceName, targetCpaMicros, targetRoas } = opts;
  const update: Record<string, any> = { resource_name: resourceName };

  switch (strategy) {
    // NOTE: the google-ads-api client derives the mutate field mask from
    // populated fields and DROPS empty sub-messages ({}). A switch to Maximize
    // Conversions / Maximize Conversion Value with no target must therefore
    // carry an explicit zero sentinel (target_cpa_micros:0 / target_roas:0 ==
    // "no target") so the field is non-empty and the mask includes it. An empty
    // {} silently no-ops: the mutate returns success while the strategy never
    // changes. (Same {target_cpa_micros:0} pattern used in the budget path.)
    case "MAXIMIZE_CONVERSIONS":
      update.maximize_conversions = {
        target_cpa_micros: targetCpaMicros !== undefined ? targetCpaMicros : 0,
      };
      break;
    case "MAXIMIZE_CONVERSION_VALUE":
      update.maximize_conversion_value = {
        target_roas: targetRoas !== undefined ? targetRoas : 0,
      };
      break;
    case "TARGET_CPA":
      if (targetCpaMicros === undefined) {
        throw new Error("TARGET_CPA strategy requires target_cpa_dollars");
      }
      update.target_cpa = { target_cpa_micros: targetCpaMicros };
      break;
    case "TARGET_ROAS":
      if (targetRoas === undefined) {
        throw new Error("TARGET_ROAS strategy requires target_roas");
      }
      update.target_roas = { target_roas: targetRoas };
      break;
    case "MANUAL_CPC":
      update.manual_cpc = {};
      break;
    case "MAXIMIZE_CLICKS":
      update.target_spend = {};
      break;
    default:
      throw new Error(`Unsupported strategy: ${strategy}`);
  }

  return update;
}
