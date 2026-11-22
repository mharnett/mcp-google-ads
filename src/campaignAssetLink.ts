// google_ads_link_asset_to_campaign: link an existing asset to campaigns.
//
// Kept out of index.ts so the read / dry-run / confirm logic is testable
// without the Google Ads API: the handler injects two manager methods
// (getCampaignAssetState for the read, linkAssetToCampaign for the write).
//
// The tool used to send one CampaignAsset create per campaign with no read.
// Links are created PAUSED, and a PAUSED link still exists, so re-running a
// link that was staged earlier failed the whole (atomic) create as a
// duplicate. Like google_ads_link_asset_to_ad_group, it now reads each
// campaign's ENABLED and PAUSED links of the field type first, reports an
// existing link with its status, and creates only the missing ones. A
// REMOVED link does not count. A campaign the read does not return (wrong
// id, or REMOVED) is reported in the dry run and refused on confirm.
//
// A campaign asset link cannot carry a label, so the manager's link method
// labels each campaign it linked claude-MM-DD-YY.

import { assertLeadFormExplicitlyRequested } from "./campaignBuilder.js";
import { AD_GROUP_ASSET_FIELD_TYPES, type AdGroupAssetFieldType } from "./adGroupAssetLink.js";
import { ENABLE_PATH, LINK_PARENT_LABEL_NOTE } from "./assetLinkEnable.js";

/** Same field types as the ad-group tool. */
export const CAMPAIGN_ASSET_FIELD_TYPES = AD_GROUP_ASSET_FIELD_TYPES;
export type CampaignAssetFieldType = AdGroupAssetFieldType;

const TOOL_NAME = "google_ads_link_asset_to_campaign";

export interface LinkAssetToCampaignArgs {
  customer_id?: string;
  asset_id: string;
  campaign_ids: string[];
  field_type: CampaignAssetFieldType;
  confirm: boolean;
}

/** One campaign's current ENABLED and PAUSED links of the requested field type. */
export interface CampaignAssetState {
  campaign_id: string;
  campaign_name: string;
  enabled_asset_ids: string[];
  paused_asset_ids: string[];
}

export interface CampaignLinkCoverage {
  campaign_id: string;
  campaign_name?: string;
  already_linked: boolean;
  /** Status of the asset's existing link on this campaign, when it has one. */
  existing_link_status?: "ENABLED" | "PAUSED";
  error?: string;
}

function idString(v: unknown): string {
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  if (typeof v === "string") return v.trim().replace(/-/g, "");
  return "";
}

export function normalizeLinkAssetToCampaignArgs(
  raw: Record<string, unknown> | undefined,
): LinkAssetToCampaignArgs | { error: string } {
  const r = raw ?? {};
  const customer_id = typeof r.customer_id === "string" ? r.customer_id : undefined;

  const asset_id = idString(r.asset_id);
  if (!/^\d+$/.test(asset_id)) {
    return { error: `invalid asset_id: ${JSON.stringify(r.asset_id)}. Expected a numeric asset ID.` };
  }

  if (!Array.isArray(r.campaign_ids) || r.campaign_ids.length === 0) {
    return { error: "campaign_ids must be a non-empty array of numeric campaign IDs." };
  }
  const campaign_ids: string[] = [];
  for (const raw_id of r.campaign_ids) {
    const id = idString(raw_id);
    if (!/^\d+$/.test(id)) return { error: `invalid campaign_ids entry: ${JSON.stringify(raw_id)}. Expected a numeric campaign ID.` };
    if (!campaign_ids.includes(id)) campaign_ids.push(id);
  }

  if (typeof r.field_type !== "string" || !r.field_type.trim()) {
    return { error: "field_type must be a non-empty string" };
  }
  const field_type = r.field_type.trim().toUpperCase();
  if (!(CAMPAIGN_ASSET_FIELD_TYPES as readonly string[]).includes(field_type)) {
    return { error: `Unsupported field_type: "${r.field_type}". Supported values: ${CAMPAIGN_ASSET_FIELD_TYPES.join(", ")}` };
  }
  if (field_type === "LEAD_FORM") {
    try {
      assertLeadFormExplicitlyRequested(r as { explicit_lead_form_request?: unknown }, TOOL_NAME);
    } catch (e: any) {
      return { error: e.message };
    }
  }

  return {
    customer_id,
    asset_id,
    campaign_ids,
    field_type: field_type as CampaignAssetFieldType,
    confirm: r.confirm === true || r.confirm === "true",
  };
}

/**
 * Pure: whether each campaign already has `asset_id` linked. With
 * `requested_ids`, rows follow the request and an id the read did not
 * return is reported with an error.
 */
export function assessCampaignAssetLinks(
  asset_id: string,
  states: CampaignAssetState[],
  requested_ids?: string[],
): CampaignLinkCoverage[] {
  const ids = requested_ids ?? states.map((s) => s.campaign_id);
  return ids.map((id) => {
    const s = states.find((st) => st.campaign_id === id);
    if (!s) {
      return { campaign_id: id, already_linked: false, error: `campaign ${id} not found in this account (or REMOVED).` };
    }
    const existing = s.enabled_asset_ids.includes(asset_id)
      ? "ENABLED"
      : (s.paused_asset_ids ?? []).includes(asset_id) ? "PAUSED" : undefined;
    return {
      campaign_id: id,
      campaign_name: s.campaign_name,
      already_linked: existing !== undefined,
      ...(existing ? { existing_link_status: existing } : {}),
    };
  });
}

export interface LinkAssetToCampaignDeps {
  getState: (campaign_ids: string[], field_type: CampaignAssetFieldType) => Promise<CampaignAssetState[]>;
  /** Creates the links PAUSED and labels their campaigns; returns the label attached, or null. */
  link: (args: {
    asset_id: string;
    campaign_ids: string[];
    field_type: CampaignAssetFieldType;
  }) => Promise<{ resource_names: string[]; audit_label: string | null; asset_resource_name?: string }>;
}

/** Dry run by default; with confirm, creates only the missing links, PAUSED. */
export async function runLinkAssetToCampaign(args: LinkAssetToCampaignArgs, deps: LinkAssetToCampaignDeps): Promise<Record<string, unknown>> {
  const before = await deps.getState(args.campaign_ids, args.field_type);
  const coverage = assessCampaignAssetLinks(args.asset_id, before, args.campaign_ids);
  const missing = coverage.filter((c) => c.error);
  const to_link = coverage.filter((c) => !c.error && !c.already_linked).map((c) => c.campaign_id);
  const skipped_already_linked = coverage.filter((c) => c.already_linked).map((c) => c.campaign_id);

  if (!args.confirm) {
    return {
      dry_run: true,
      action: "link_asset_to_campaign",
      message: "DRY RUN. Nothing linked. Pass confirm: true to create the links PAUSED.",
      customer_id: args.customer_id ?? "",
      asset_id: args.asset_id,
      campaign_ids: args.campaign_ids,
      field_type: args.field_type,
      campaigns_to_link: to_link.length,
      status: "PAUSED",
      campaigns: coverage,
      errors: missing.map((c) => c.error),
      enable_path: ENABLE_PATH,
    };
  }

  if (missing.length > 0) {
    return { error: `Refusing to link: ${missing.map((c) => c.error).join(" ")}` };
  }

  let resource_names: string[] = [];
  let audit_label: string | null = null;
  let asset_resource_name: string | undefined;
  if (to_link.length > 0) {
    const res = await deps.link({ asset_id: args.asset_id, campaign_ids: to_link, field_type: args.field_type });
    resource_names = res.resource_names;
    audit_label = res.audit_label;
    asset_resource_name = res.asset_resource_name;
  }

  return {
    success: true,
    customer_id: args.customer_id ?? "",
    asset_id: args.asset_id,
    ...(asset_resource_name ? { asset_resource_name } : {}),
    field_type: args.field_type,
    status: "PAUSED",
    linked: to_link.length,
    campaigns_linked: to_link.length,
    skipped_already_linked,
    resource_names,
    campaigns: coverage.map((c) => ({ ...c, link_status: c.existing_link_status ?? "PAUSED" })),
    audit_label,
    audit_label_note: LINK_PARENT_LABEL_NOTE,
    enable_path: ENABLE_PATH,
  };
}
