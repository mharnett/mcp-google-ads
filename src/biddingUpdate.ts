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

// Every branch of buildBiddingCampaignUpdate below sets a non-oneof-portfolio
// bidding field (maximize_conversions / target_cpa / etc.), which clears the
// campaign's `bidding_strategy` (portfolio) oneof reference. So any campaign
// currently attached to a portfolio strategy — bidding_strategy populated —
// gets silently detached the moment updateCampaignBidding runs, regardless of
// which strategy the caller asked for.
export function wouldDetachPortfolioStrategy(
  currentBiddingStrategyResource: string | null | undefined
): currentBiddingStrategyResource is string {
  return typeof currentBiddingStrategyResource === "string" && currentBiddingStrategyResource.length > 0;
}

export class PortfolioDetachBlocked extends Error {
  campaignId: string;
  campaignName: string;
  portfolioStrategyResource: string;

  constructor(campaignId: string, campaignName: string, portfolioStrategyResource: string) {
    super(
      `Campaign ${campaignId} ("${campaignName}") is attached to portfolio bid strategy ` +
        `${portfolioStrategyResource}. This update would silently detach it. ` +
        `Use google_ads_detach_portfolio_bid_strategy instead if you intend to break the attachment.`
    );
    this.name = "PortfolioDetachBlocked";
    this.campaignId = campaignId;
    this.campaignName = campaignName;
    this.portfolioStrategyResource = portfolioStrategyResource;
  }
}

// Magnitude-ceiling guard. Mirrors automation/quality-control's gads_apply.py
// (DEFAULT_MAGNITUDE_CEILING_PCT, compute_magnitude_delta_pct,
// exceeds_magnitude_ceiling) for cross-repo naming consistency — that gate
// only covers a different pipeline (the SPC Slack-card apply flow) and has
// no integration with this MCP server at all, which is the actual gap this
// closes for direct/manual bidding changes.
export const DEFAULT_MAGNITUDE_CEILING_PCT = 20;

export function computeMagnitudeDeltaPct(
  oldValue: number | undefined | null,
  newValue: number | undefined | null
): number | null {
  if (oldValue === undefined || oldValue === null || oldValue === 0) return null;
  if (newValue === undefined || newValue === null) return null;
  return ((newValue - oldValue) / oldValue) * 100;
}

export function exceedsMagnitudeCeiling(
  oldValue: number | undefined | null,
  newValue: number | undefined | null,
  ceilingPct: number = DEFAULT_MAGNITUDE_CEILING_PCT
): boolean {
  const delta = computeMagnitudeDeltaPct(oldValue, newValue);
  if (delta === null) return false;
  return Math.abs(delta) > ceilingPct;
}

const TARGET_BASED_STRATEGIES = new Set(["TARGET_CPA", "TARGET_ROAS"]);

// Losing an existing numeric target entirely (cap -> uncapped) or switching
// away from a target-based strategy has no percentage delta to compute, but
// is the exact class of change behind the incident that motivated this
// feature (silent portfolio/target detachment) — gate it directly rather
// than let a missing baseline silently mean "nothing to check."
export function isStrategyLooseningChange(
  oldTargetMicros: number | undefined | null,
  newTargetMicros: number | undefined | null,
  oldStrategy: string,
  newStrategy: string
): boolean {
  const hadTarget = typeof oldTargetMicros === "number" && oldTargetMicros > 0;
  const hasTarget = typeof newTargetMicros === "number" && newTargetMicros > 0;
  if (hadTarget && !hasTarget) return true;
  if (TARGET_BASED_STRATEGIES.has(oldStrategy) && !TARGET_BASED_STRATEGIES.has(newStrategy)) {
    return true;
  }
  return false;
}

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
