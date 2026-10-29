// Write guards shared by the mutating tools: a magnitude ceiling for budget
// changes and an `expected_old` check that refuses a write when the live
// value is not the one the caller thinks it is overwriting.
//
// The bidding tool's ceiling lives in biddingUpdate.ts; this module reuses
// its constants so the two tools share one threshold.

import {
  DEFAULT_MAGNITUDE_CEILING_PCT,
  computeMagnitudeDeltaPct,
} from "./biddingUpdate.js";

export const BUDGET_CEILING_PCT = DEFAULT_MAGNITUDE_CEILING_PCT;

export class MagnitudeCeilingBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MagnitudeCeilingBlocked";
  }
}

export function formatDollarsFromMicros(micros: number): string {
  return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

function formatPct(pct: number): string {
  const rounded = Math.round(pct);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

export interface BudgetChangeInput {
  campaignId: string;
  campaignName: string;
  oldMicros: number;
  newMicros: number;
  confirmLargeChange?: boolean;
  reason?: string;
  ceilingPct?: number;
}

export interface BudgetChangeVerdict {
  deltaPct: number | null;
  overCeiling: boolean;
  /** True only when the change exceeded the ceiling and was let through by an explicit override. */
  override: boolean;
}

/**
 * Decide whether a daily-budget change may proceed. Throws
 * MagnitudeCeilingBlocked when the change is larger than ±ceilingPct and the
 * caller has not passed both confirm_large_change: true and a non-empty reason.
 */
export function evaluateBudgetChange(input: BudgetChangeInput): BudgetChangeVerdict {
  const ceiling = input.ceilingPct ?? BUDGET_CEILING_PCT;
  const deltaPct = computeMagnitudeDeltaPct(Number(input.oldMicros), Number(input.newMicros));
  const overCeiling = deltaPct !== null && Math.abs(deltaPct) > ceiling;
  if (!overCeiling) return { deltaPct, overCeiling: false, override: false };

  const hasReason = typeof input.reason === "string" && input.reason.trim().length > 0;
  if (input.confirmLargeChange === true && hasReason) {
    return { deltaPct, overCeiling: true, override: true };
  }

  const what =
    `Budget change on campaign "${input.campaignName}" (id ${input.campaignId}) from ` +
    `${formatDollarsFromMicros(input.oldMicros)} to ${formatDollarsFromMicros(input.newMicros)}/day ` +
    `is ${formatPct(deltaPct!)}, exceeding the ±${ceiling}% ceiling.`;
  const fix =
    input.confirmLargeChange === true
      ? ` confirm_large_change was passed without a reason: add a non-empty reason string to proceed.`
      : ` Pass confirm_large_change: true and a non-empty reason to proceed.`;
  throw new MagnitudeCeilingBlocked(what + fix);
}

// ---------------------------------------------------------------------------
// expected_old: refuse a write when the live value is not what the caller
// believes it is overwriting. Optional on every update tool for now; to be
// made required once callers send it.
// ---------------------------------------------------------------------------

export type ExpectedOldKind = "exact" | "money" | "number" | "set";

export interface ExpectedOldField {
  field: string;
  expected: unknown;
  current: unknown;
  kind: ExpectedOldKind;
}

export class ExpectedOldMismatch extends Error {
  tool: string;
  entity: string;
  current: Record<string, unknown>;
  expected: Record<string, unknown>;

  constructor(tool: string, entity: string, mismatches: ExpectedOldField[]) {
    const current: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const m of mismatches) {
      current[m.field] = m.current ?? null;
      expected[m.field] = m.expected;
    }
    const detail = mismatches
      .map((m) => `${m.field}: live ${JSON.stringify(m.current ?? null)}, expected ${JSON.stringify(m.expected)}`)
      .join("; ");
    super(
      `${tool}: expected_old does not match the live value on ${entity} (${detail}). ` +
        `No write was made. Re-read the current value and retry.`
    );
    this.name = "ExpectedOldMismatch";
    this.tool = tool;
    this.entity = entity;
    this.current = current;
    this.expected = expected;
  }
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function normalizeSet(v: unknown): string[] {
  if (isEmpty(v)) return [];
  const arr = Array.isArray(v) ? v : [v];
  return [...new Set(arr.map((x) => String(x)))].sort();
}

function valuesMatch(expected: unknown, current: unknown, kind: ExpectedOldKind): boolean {
  switch (kind) {
    case "exact":
      if (isEmpty(expected) || isEmpty(current)) return isEmpty(expected) && isEmpty(current);
      return String(expected) === String(current);
    case "money":
      if (isEmpty(expected) || isEmpty(current)) return isEmpty(expected) && isEmpty(current);
      return Math.round(Number(expected) * 100) === Math.round(Number(current) * 100);
    case "number":
      if (isEmpty(expected) || isEmpty(current)) return isEmpty(expected) && isEmpty(current);
      return Math.abs(Number(expected) - Number(current)) < 1e-6;
    case "set": {
      const a = normalizeSet(expected);
      const b = normalizeSet(current);
      return a.length === b.length && a.every((x, i) => x === b[i]);
    }
  }
}

/** Fields whose `expected` was given (not undefined) and does not match `current`. */
export function findExpectedOldMismatches(fields: ExpectedOldField[]): ExpectedOldField[] {
  return fields.filter((f) => f.expected !== undefined && !valuesMatch(f.expected, f.current, f.kind));
}

/** Throws ExpectedOldMismatch when any given expected value differs from the live one. */
export function assertExpectedOld(tool: string, entity: string, fields: ExpectedOldField[]): void {
  const mismatches = findExpectedOldMismatches(fields);
  if (mismatches.length > 0) throw new ExpectedOldMismatch(tool, entity, mismatches);
}

/** Trailing numeric id of a resource name ("customers/1/assets/42" -> "42"); ids pass through. */
export function idOf(resourceNameOrId: unknown): string {
  const s = String(resourceNameOrId ?? "");
  const m = s.match(/(\d+)$/);
  return m ? m[1] : s;
}

// ---------------------------------------------------------------------------
// Guard registry. Every tool in WRITE_TOOLS is classified here; the contract
// test (writeGuards.contract.test.ts) fails when a write tool that takes a
// number declares neither a ceiling nor a no_ceiling_reason, or an
// overwriting update tool neither accepts expected_old nor says why not.
// ---------------------------------------------------------------------------

export interface WriteToolGuardSpec {
  /** Magnitude ceiling enforced by the tool (requires confirm_large_change to exceed). */
  ceiling?: { pct: number; on: string };
  /** Why a tool that takes a number has no magnitude ceiling. */
  no_ceiling_reason?: string;
  /** Why an overwriting update tool does not accept expected_old. */
  no_expected_old_reason?: string;
}

const CREATE_NO_PRIOR =
  "creates a new entity (landing PAUSED); there is no prior value to measure a change against";
const PIN_ORDINAL = "the only number is pinned_position, an ordinal slot index, not a magnitude";

export const WRITE_TOOL_GUARDS: Readonly<Record<string, WriteToolGuardSpec>> = {
  google_ads_create_campaign: { no_ceiling_reason: CREATE_NO_PRIOR },
  google_ads_create_ad_group: { no_ceiling_reason: CREATE_NO_PRIOR },
  google_ads_create_responsive_search_ad: { no_ceiling_reason: PIN_ORDINAL },
  google_ads_create_keywords: {},
  google_ads_create_shared_set: {},
  google_ads_create_demand_gen_multi_asset_ad: { no_ceiling_reason: PIN_ORDINAL },
  google_ads_update_demand_gen_multi_asset_ad: { no_ceiling_reason: PIN_ORDINAL },
  google_ads_update_video_ad_videos: {},
  google_ads_update_responsive_search_ad_text: { no_ceiling_reason: PIN_ORDINAL },
  google_ads_create_image_asset: {},
  google_ads_create_lead_form_asset: {},
  google_ads_enable_items: {},
  google_ads_pause_items: {},
  google_ads_pause_keywords: {},
  google_ads_enable_keywords: {},
  google_ads_pause_asset_links: {},
  google_ads_remove_items: {},
  google_ads_remove_shared_negatives: {},
  google_ads_remove_campaign_negatives: {},
  google_ads_remove_adgroup_negatives: {},
  google_ads_add_adgroup_negatives: {},
  google_ads_add_shared_negatives: {},
  google_ads_add_campaign_negatives: {},
  google_ads_link_shared_set: {},
  google_ads_unlink_shared_set: {},
  google_ads_apply_label: {},
  google_ads_update_campaign_tracking: {},
  google_ads_update_campaign_budget: { ceiling: { pct: BUDGET_CEILING_PCT, on: "daily_budget" } },
  google_ads_update_campaign_bidding: { ceiling: { pct: DEFAULT_MAGNITUDE_CEILING_PCT, on: "target_cpa_dollars / target_roas" } },
  google_ads_detach_portfolio_bid_strategy: {},
  google_ads_update_ad_asset_automation: { no_expected_old_reason: "sets opt-in/opt-out status on named automation types; the target state is fully specified by the call and re-applying it is harmless, like pause/enable" },
  google_ads_update_asset_urls: {},
  google_ads_create_sitelink: {},
  google_ads_replace_sitelink_url: {},
  google_ads_create_page_feed: {},
  google_ads_create_experiment: { no_ceiling_reason: "traffic_split_percent is set once on a new experiment; there is no prior split to measure a change against" },
  google_ads_schedule_experiment: {},
  google_ads_end_experiment: {},
  google_ads_promote_experiment: {},
  google_ads_remove_experiment: {},
  google_ads_update_campaign_ad_urls: {},
  google_ads_update_ad_final_urls: {},
  google_ads_rename_ad_group: {},
  google_ads_rename_campaign: {},
  google_ads_link_asset_to_campaign: {},
  google_ads_link_asset_to_ad_group: {},
  google_ads_create_callout: {},
  google_ads_create_structured_snippet: {},
  google_ads_link_asset_to_customer: {},
  google_ads_set_ad_group_location_targeting: {},
  google_ads_set_campaign_location_targeting: {},
  google_ads_attach_user_list_audience: {},
  google_ads_create_and_attach_audience_bundle: {},
  google_ads_update_campaign_ad_rotation: {},
  google_ads_update_campaign_selective_optimization: {},
  google_ads_update_campaign_geo_target_type: {},
};
