// google_ads_link_asset_to_ad_group: link an existing asset to ad groups.
//
// Kept out of index.ts so the dry-run / confirm / warning logic is testable
// without the Google Ads API: the handler injects two manager methods
// (getAdGroupAssetState for the read, linkAssetToAdGroup for the write).
//
// The rule this encodes: once an ad group has ANY enabled ad-group sitelink,
// its campaign-level sitelinks stop serving there. Linking the first ad-group
// sitelink can therefore cut an ad group from the campaign's full set to one.
// The tool warns (it does not refuse, and it does not copy the campaign set)
// whenever the resulting ad-group sitelink count would be under 4.
//
// Ad-group asset links have no label field, so the audit record is a
// claude-MM-DD-YY label string returned with the result and written to stderr,
// the same way the apply_* scripts print theirs.

import { assertLeadFormExplicitlyRequested } from "./campaignBuilder.js";
import { claudeAuditLabel, isValidClaudeLabel } from "./claudeLabel.js";

export const AD_GROUP_ASSET_FIELD_TYPES = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "LEAD_FORM"] as const;
export type AdGroupAssetFieldType = (typeof AD_GROUP_ASSET_FIELD_TYPES)[number];

/** Below this many enabled ad-group sitelinks the tool warns. */
export const MIN_AD_GROUP_SITELINKS = 4;

const TOOL_NAME = "google_ads_link_asset_to_ad_group";
const DEFAULT_AUDIT_DESCRIPTOR = "ad-group-asset-link";

export const PAUSE_PATH =
  "To undo, pass the returned resource_names (customers/{cid}/adGroupAssets/{adGroupId}~{assetId}~{FIELD_TYPE}) " +
  "to google_ads_pause_asset_links; it previews by default and pauses with confirm: true.";

export interface LinkAssetToAdGroupArgs {
  customer_id?: string;
  asset_id: string;
  ad_group_ids: string[];
  field_type: AdGroupAssetFieldType;
  audit_label?: string;
  confirm: boolean;
}

/** One ad group's current enabled links of the requested field type. */
export interface AdGroupAssetState {
  ad_group_id: string;
  ad_group_name: string;
  campaign_name: string;
  enabled_asset_ids: string[];
}

export interface AdGroupCoverage {
  ad_group_id: string;
  ad_group_name?: string;
  campaign_name?: string;
  current_enabled_count: number;
  resulting_enabled_count: number;
  already_linked: boolean;
  warning?: string;
  error?: string;
}

function idString(v: unknown): string {
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  if (typeof v === "string") return v.trim().replace(/-/g, "");
  return "";
}

export function normalizeLinkAssetToAdGroupArgs(
  raw: Record<string, unknown> | undefined,
): LinkAssetToAdGroupArgs | { error: string } {
  const r = raw ?? {};
  const customer_id = typeof r.customer_id === "string" ? r.customer_id : undefined;

  const asset_id = idString(r.asset_id);
  if (!/^\d+$/.test(asset_id)) {
    return { error: `invalid asset_id: ${JSON.stringify(r.asset_id)}. Expected a numeric asset ID.` };
  }

  if (!Array.isArray(r.ad_group_ids) || r.ad_group_ids.length === 0) {
    return { error: "ad_group_ids must be a non-empty array of numeric ad group IDs." };
  }
  const ad_group_ids: string[] = [];
  for (const raw_id of r.ad_group_ids) {
    const id = idString(raw_id);
    if (!/^\d+$/.test(id)) return { error: `invalid ad_group_ids entry: ${JSON.stringify(raw_id)}. Expected a numeric ad group ID.` };
    if (!ad_group_ids.includes(id)) ad_group_ids.push(id);
  }

  if (typeof r.field_type !== "string" || !r.field_type.trim()) {
    return { error: "field_type must be a non-empty string" };
  }
  const field_type = r.field_type.trim().toUpperCase();
  if (!(AD_GROUP_ASSET_FIELD_TYPES as readonly string[]).includes(field_type)) {
    return { error: `Unsupported field_type: "${r.field_type}". Supported values: ${AD_GROUP_ASSET_FIELD_TYPES.join(", ")}` };
  }
  if (field_type === "LEAD_FORM") {
    try {
      assertLeadFormExplicitlyRequested(r as { explicit_lead_form_request?: unknown }, TOOL_NAME);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  let audit_label: string | undefined;
  if (r.audit_label !== undefined) {
    if (typeof r.audit_label !== "string" || !isValidClaudeLabel(r.audit_label)) {
      return { error: `invalid audit_label: ${JSON.stringify(r.audit_label)}. Expected claude-MM-DD-YY or claude-MM-DD-YY-<kebab-desc>.` };
    }
    audit_label = r.audit_label;
  }

  return {
    customer_id,
    asset_id,
    ad_group_ids,
    field_type: field_type as AdGroupAssetFieldType,
    audit_label,
    confirm: r.confirm === true || r.confirm === "true",
  };
}

function underMinimumWarning(c: { ad_group_name?: string; campaign_name?: string; current: number; resulting: number }): string {
  const where = `"${c.ad_group_name}"${c.campaign_name ? ` in "${c.campaign_name}"` : ""}`;
  const base = `${where} would have ${c.resulting} enabled ad-group sitelinks, fewer than ${MIN_AD_GROUP_SITELINKS}.`;
  if (c.current === 0) {
    return `${base} It has none today, so it currently serves the campaign-level sitelinks; ` +
      "attaching an ad-group sitelink switches those off for this ad group. " +
      "Link the campaign set (or more ad-group sitelinks) to it as well.";
  }
  return `${base} Link more ad-group sitelinks to it.`;
}

/**
 * Pure: what linking `asset_id` would leave each ad group with.
 * `requested_ids`, when given, reports any id the read did not return.
 */
export function assessAdGroupAssetCoverage(
  asset_id: string,
  field_type: AdGroupAssetFieldType,
  states: AdGroupAssetState[],
  requested_ids?: string[],
): AdGroupCoverage[] {
  const out: AdGroupCoverage[] = states.map((s) => {
    const current = new Set(s.enabled_asset_ids);
    const already_linked = current.has(asset_id);
    const resulting = already_linked ? current.size : current.size + 1;
    const cov: AdGroupCoverage = {
      ad_group_id: s.ad_group_id,
      ad_group_name: s.ad_group_name,
      campaign_name: s.campaign_name,
      current_enabled_count: current.size,
      resulting_enabled_count: resulting,
      already_linked,
    };
    if (field_type === "SITELINK" && resulting < MIN_AD_GROUP_SITELINKS) {
      cov.warning = underMinimumWarning({ ad_group_name: s.ad_group_name, campaign_name: s.campaign_name, current: current.size, resulting });
    }
    return cov;
  });
  for (const id of requested_ids ?? []) {
    if (!states.some((s) => s.ad_group_id === id)) {
      out.push({
        ad_group_id: id,
        current_enabled_count: 0,
        resulting_enabled_count: 0,
        already_linked: false,
        error: `ad group ${id} not found in this account (or REMOVED).`,
      });
    }
  }
  return out;
}

export interface LinkAssetToAdGroupDeps {
  getState: (ad_group_ids: string[], field_type: AdGroupAssetFieldType) => Promise<AdGroupAssetState[]>;
  link: (args: { asset_id: string; ad_group_ids: string[]; field_type: AdGroupAssetFieldType }) => Promise<{ resource_names: string[] }>;
  now?: () => Date;
  log?: (line: string) => void;
}

/** Dry run by default; with confirm, links then reads back. */
export async function runLinkAssetToAdGroup(args: LinkAssetToAdGroupArgs, deps: LinkAssetToAdGroupDeps): Promise<Record<string, unknown>> {
  const before = await deps.getState(args.ad_group_ids, args.field_type);
  const coverage = assessAdGroupAssetCoverage(args.asset_id, args.field_type, before, args.ad_group_ids);
  const missing = coverage.filter((c) => c.error);
  const warnings = coverage.map((c) => c.warning).filter((w): w is string => !!w);
  const audit_label = args.audit_label ?? claudeAuditLabel((deps.now ?? (() => new Date()))(), DEFAULT_AUDIT_DESCRIPTOR);

  if (!args.confirm) {
    return {
      dry_run: true,
      action: "link_asset_to_ad_group",
      message: "DRY RUN. Nothing linked. Pass confirm: true to apply.",
      customer_id: args.customer_id ?? "",
      asset_id: args.asset_id,
      field_type: args.field_type,
      audit_label,
      ad_groups: coverage,
      warnings,
      errors: missing.map((c) => c.error),
      pause_path: PAUSE_PATH,
    };
  }

  if (missing.length > 0) {
    return { error: `Refusing to link: ${missing.map((c) => c.error).join(" ")}` };
  }

  const to_link = coverage.filter((c) => !c.already_linked).map((c) => c.ad_group_id);
  const skipped_already_linked = coverage.filter((c) => c.already_linked).map((c) => c.ad_group_id);
  let resource_names: string[] = [];
  if (to_link.length > 0) {
    const res = await deps.link({ asset_id: args.asset_id, ad_group_ids: to_link, field_type: args.field_type });
    resource_names = res.resource_names;
  }

  const after = to_link.length > 0 ? await deps.getState(args.ad_group_ids, args.field_type) : before;
  const ad_groups = after.map((s) => ({
    ad_group_id: s.ad_group_id,
    ad_group_name: s.ad_group_name,
    campaign_name: s.campaign_name,
    enabled_count: new Set(s.enabled_asset_ids).size,
    asset_linked: s.enabled_asset_ids.includes(args.asset_id),
  }));
  const after_warnings = args.field_type !== "SITELINK" ? [] : after
    .filter((s) => new Set(s.enabled_asset_ids).size < MIN_AD_GROUP_SITELINKS)
    .map((s) => {
      const prior = before.find((b) => b.ad_group_id === s.ad_group_id);
      return underMinimumWarning({
        ad_group_name: s.ad_group_name,
        campaign_name: s.campaign_name,
        current: prior ? new Set(prior.enabled_asset_ids).size : 0,
        resulting: new Set(s.enabled_asset_ids).size,
      });
    });

  (deps.log ?? ((l: string) => console.error(l)))(
    `[audit ${audit_label}] link_asset_to_ad_group customer=${args.customer_id ?? ""} asset=${args.asset_id} ` +
    `field_type=${args.field_type} linked=${to_link.join(",") || "-"} skipped=${skipped_already_linked.join(",") || "-"}`,
  );

  return {
    success: true,
    customer_id: args.customer_id ?? "",
    asset_id: args.asset_id,
    field_type: args.field_type,
    audit_label,
    linked: to_link.length,
    skipped_already_linked,
    resource_names,
    ad_groups,
    warnings: after_warnings,
    pause_path: PAUSE_PATH,
  };
}
