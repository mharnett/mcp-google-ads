// google_ads_enable_asset_links: turn PAUSED asset links on.
//
// The three link_asset_to_* tools create their CampaignAsset, AdGroupAsset or
// CustomerAsset PAUSED (AssetLinkStatus.PAUSED; `status` is settable on create
// on all three resources), so a new sitelink, callout or snippet serves only
// once this tool enables it. Kept out of index.ts so the strict resource-name
// parse, the lead-form gate and the per-link plan are testable without the
// Google Ads API; the handler injects the read and the update.
//
// An asset link has no label surface, so the claude-MM-DD-YY audit label goes
// on the campaign or ad group each enabled link belongs to, the way the
// negatives and campaign-criteria edits label their parent. An account-level
// link has no labelable parent.

import { enums } from "google-ads-api";
import { assertLeadFormExplicitlyRequested } from "./campaignBuilder.js";
import type { AssetLinkLevel } from "./assetHelpers.js";

export const ENABLE_ASSET_LINKS_TOOL = "google_ads_enable_asset_links";

/** Said by every link_asset_to_* result and dry run. */
export const ENABLE_PATH =
  "Links are created PAUSED and do not serve. To turn them on, pass the returned resource_names to " +
  "google_ads_enable_asset_links; it previews by default and enables with confirm: true.";

const ACCOUNT_LEVEL_SENTENCE =
  "An account-level (customerAssets) link has no campaign or ad group to label; find it in the account's change history.";

export const PARENT_LABEL_NOTE =
  "An asset link cannot carry a label in Google Ads, so the campaign or ad group each enabled link belongs to was labeled. " +
  ACCOUNT_LEVEL_SENTENCE;

/** link_asset_to_campaign and link_asset_to_ad_group results. */
export const LINK_PARENT_LABEL_NOTE =
  "An asset link cannot carry a label in Google Ads, so the campaign or ad group each new link belongs to was labeled.";

/** pause_asset_links results. */
export const PAUSE_PARENT_LABEL_NOTE =
  "An asset link cannot carry a label in Google Ads, so the campaign or ad group each paused link belongs to was labeled. " +
  ACCOUNT_LEVEL_SENTENCE;

/** link_asset_to_customer results, and a pause of account-level links only. */
export const ACCOUNT_LINK_LABEL_NOTE =
  "An account-level (customerAssets) link has no campaign or ad group to label, so no claude-MM-DD-YY label was applied. " +
  "Find this change in the account's change history.";

export const AD_GROUP_SITELINK_NOTE =
  "Once an ad group has any enabled ad-group sitelink, its campaign-level sitelinks stop serving there. " +
  "Keep at least 4 enabled ad-group sitelinks on it.";

export interface AssetLinkTarget {
  resource_name: string;
  level: AssetLinkLevel;
  customer_id: string;
  asset_id: string;
  field_type: string;
  campaign_id?: string;
  ad_group_id?: string;
}

/** What the read found for one link. Absent from the read = not found. */
export interface AssetLinkState {
  resource_name: string;
  status: string;
  parent_status?: string;
  campaign_name?: string;
  ad_group_name?: string;
}

export type EnableOutcome =
  | "would_enable"
  | "enabled"
  | "already_enabled"
  | "not_found"
  | "removed"
  | "parent_removed"
  | "not_paused"
  | "failed";

export interface EnableLinkRow extends AssetLinkTarget {
  campaign_name?: string;
  ad_group_name?: string;
  previous_status: string | null;
  outcome: EnableOutcome;
  error?: string;
  audit_label?: string | null;
  note?: string;
}

export interface EnableAssetLinksArgs {
  customer_id: string;
  links: AssetLinkTarget[];
  confirm: boolean;
}

// Exact shapes only. Ids are numeric and the field type is a real
// AssetFieldType name, so a parsed name is also safe inside a GAQL string.
const RE_CAMPAIGN_ASSET = /^customers\/(\d+)\/campaignAssets\/(\d+)~(\d+)~([A-Z_]+)$/;
const RE_AD_GROUP_ASSET = /^customers\/(\d+)\/adGroupAssets\/(\d+)~(\d+)~([A-Z_]+)$/;
const RE_CUSTOMER_ASSET = /^customers\/(\d+)\/customerAssets\/(\d+)~([A-Z_]+)$/;

const SHAPES =
  "customers/{cid}/campaignAssets/{campaignId}~{assetId}~{FIELD_TYPE}, " +
  "customers/{cid}/adGroupAssets/{adGroupId}~{assetId}~{FIELD_TYPE} or " +
  "customers/{cid}/customerAssets/{assetId}~{FIELD_TYPE}";

function isAssetFieldType(name: string): boolean {
  if (name === "UNSPECIFIED" || name === "UNKNOWN") return false;
  return typeof (enums.AssetFieldType as Record<string, unknown>)[name] === "number";
}

/** Strict parse of one asset-link resource name. */
export function parseAssetLinkTarget(raw: unknown): AssetLinkTarget | { error: string } {
  const rn = typeof raw === "string" ? raw.trim() : "";
  const refuse = { error: `Not an asset-link resource name: ${JSON.stringify(raw)}. Expected ${SHAPES}.` };
  let m = rn.match(RE_CAMPAIGN_ASSET);
  if (m) {
    if (!isAssetFieldType(m[4])) return refuse;
    return { resource_name: rn, level: "campaign_asset", customer_id: m[1], campaign_id: m[2], asset_id: m[3], field_type: m[4] };
  }
  m = rn.match(RE_AD_GROUP_ASSET);
  if (m) {
    if (!isAssetFieldType(m[4])) return refuse;
    return { resource_name: rn, level: "ad_group_asset", customer_id: m[1], ad_group_id: m[2], asset_id: m[3], field_type: m[4] };
  }
  m = rn.match(RE_CUSTOMER_ASSET);
  if (m) {
    if (!isAssetFieldType(m[3])) return refuse;
    return { resource_name: rn, level: "customer_asset", customer_id: m[1], asset_id: m[2], field_type: m[3] };
  }
  return refuse;
}

/** An array, or a JSON-encoded array string (some clients send arrays as strings). */
function coerceArray(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

/**
 * Refuses, before any read: a missing or empty list, any entry that is not an
 * exact asset-link resource name, links from more than one account, a link
 * outside the customer_id given, and a LEAD_FORM link without
 * explicit_lead_form_request (enabling one is what makes a lead form serve).
 */
export function normalizeEnableAssetLinksArgs(raw: Record<string, unknown> | undefined): EnableAssetLinksArgs | { error: string } {
  const r = raw ?? {};
  const list = coerceArray(r.resource_names);
  if (!list || list.length === 0) {
    return { error: `resource_names must be a non-empty array of asset-link resource names (${SHAPES}).` };
  }

  const links: AssetLinkTarget[] = [];
  for (const entry of list) {
    const parsed = parseAssetLinkTarget(entry);
    if ("error" in parsed) return parsed;
    if (!links.some((l) => l.resource_name === parsed.resource_name)) links.push(parsed);
  }

  const accounts = [...new Set(links.map((l) => l.customer_id))];
  if (accounts.length > 1) {
    return { error: `resource_names span ${accounts.length} customer accounts (${accounts.join(", ")}); enable one account's links per call.` };
  }
  const given = typeof r.customer_id === "string" ? r.customer_id.trim().replace(/-/g, "") : "";
  if (given && given !== accounts[0]) {
    return { error: `resource_names belong to customer ${accounts[0]}, not customer_id ${given}. Refusing to enable another account's links.` };
  }

  if (links.some((l) => l.field_type === "LEAD_FORM")) {
    try {
      assertLeadFormExplicitlyRequested(r as { explicit_lead_form_request?: unknown }, ENABLE_ASSET_LINKS_TOOL);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  return { customer_id: accounts[0], links, confirm: r.confirm === true || r.confirm === "true" };
}

/** Pure: what confirm would do with each link, given the read. */
export function planEnableAssetLinks(links: AssetLinkTarget[], states: AssetLinkState[]): EnableLinkRow[] {
  const byName = new Map(states.map((s) => [s.resource_name, s]));
  return links.map((link) => {
    const st = byName.get(link.resource_name);
    const row: EnableLinkRow = {
      ...link,
      ...(st?.campaign_name ? { campaign_name: st.campaign_name } : {}),
      ...(st?.ad_group_name ? { ad_group_name: st.ad_group_name } : {}),
      previous_status: st ? st.status : null,
      outcome: "would_enable",
    };
    if (!st) row.outcome = "not_found";
    else if (st.status === "REMOVED") row.outcome = "removed";
    else if (st.parent_status === "REMOVED") row.outcome = "parent_removed";
    else if (st.status === "ENABLED") row.outcome = "already_enabled";
    else if (st.status !== "PAUSED") row.outcome = "not_paused";
    if (row.level === "ad_group_asset" && row.field_type === "SITELINK" && row.outcome === "would_enable") {
      row.note = AD_GROUP_SITELINK_NOTE;
    }
    return row;
  });
}

const SKIP_REASON: Partial<Record<EnableOutcome, string>> = {
  not_found: "no such link in this account",
  removed: "the link is REMOVED and cannot be re-enabled; link the asset again",
  parent_removed: "its campaign or ad group is REMOVED, so Google refuses any change to the link",
  not_paused: "the link is neither PAUSED nor ENABLED",
};

export function buildEnableAssetLinksDryRun(args: EnableAssetLinksArgs, plan: EnableLinkRow[]): Record<string, unknown> {
  return {
    dry_run: true,
    action: "enable_asset_links",
    message: "DRY RUN. Nothing enabled. Pass confirm: true to enable the links marked would_enable.",
    customer_id: args.customer_id,
    would_enable: plan.filter((r) => r.outcome === "would_enable").length,
    links: withSkipReasons(plan),
  };
}

/** Parent campaign / ad group resource name of a link, if it has one. */
export function labelParentOf(link: AssetLinkTarget): { kind: "campaign" | "ad_group"; resource_name: string } | null {
  if (link.level === "campaign_asset") return { kind: "campaign", resource_name: `customers/${link.customer_id}/campaigns/${link.campaign_id}` };
  if (link.level === "ad_group_asset") return { kind: "ad_group", resource_name: `customers/${link.customer_id}/adGroups/${link.ad_group_id}` };
  return null;
}

/** Each row, plus why it was skipped when it was. */
export function withSkipReasons(rows: EnableLinkRow[]): Array<EnableLinkRow & { reason?: string }> {
  return rows.map((r) => (SKIP_REASON[r.outcome] ? { ...r, reason: SKIP_REASON[r.outcome] } : r));
}
