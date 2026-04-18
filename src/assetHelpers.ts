// Pure helpers for sitelink / asset management tools.
// Extracted so input validation and resource-name parsing are testable
// without hitting the Google Ads API.

export interface AssetUrlUpdate {
  asset_id: string;
  final_urls: string[];
}

export interface UpdateAssetUrlsArgs {
  customer_id?: string;
  updates: AssetUrlUpdate[];
  confirm?: boolean;
}

export interface PauseAssetLinksArgs {
  customer_id?: string;
  resource_names: string[];
  confirm?: boolean;
}

export type AssetLinkLevel = "customer_asset" | "campaign_asset" | "ad_group_asset";

export interface ParsedAssetLink {
  level: AssetLinkLevel;
  customer_id: string;
  resource_name: string;
}

// Resource name forms:
//   customers/{cid}/customerAssets/{assetId}~{FIELD_TYPE}
//   customers/{cid}/campaignAssets/{campaignId}~{assetId}~{FIELD_TYPE}
//   customers/{cid}/adGroupAssets/{adGroupId}~{assetId}~{FIELD_TYPE}
const RE_CUSTOMER_ASSET = /^customers\/(\d+)\/customerAssets\/[^/]+$/;
const RE_CAMPAIGN_ASSET = /^customers\/(\d+)\/campaignAssets\/[^/]+$/;
const RE_AD_GROUP_ASSET = /^customers\/(\d+)\/adGroupAssets\/[^/]+$/;

export function parseAssetLinkResourceName(rn: string): ParsedAssetLink | { error: string } {
  const trimmed = rn.trim();
  let m = trimmed.match(RE_CUSTOMER_ASSET);
  if (m) return { level: "customer_asset", customer_id: m[1], resource_name: trimmed };
  m = trimmed.match(RE_CAMPAIGN_ASSET);
  if (m) return { level: "campaign_asset", customer_id: m[1], resource_name: trimmed };
  m = trimmed.match(RE_AD_GROUP_ASSET);
  if (m) return { level: "ad_group_asset", customer_id: m[1], resource_name: trimmed };
  return {
    error: `Unrecognized asset-link resource name: "${rn}". Expected customers/{cid}/customerAssets/..., customers/{cid}/campaignAssets/..., or customers/{cid}/adGroupAssets/...`,
  };
}

export function validateFinalUrls(urls: unknown): { ok: true; urls: string[] } | { ok: false; error: string } {
  if (!Array.isArray(urls) || urls.length === 0) {
    return { ok: false, error: "final_urls must be a non-empty array" };
  }
  const cleaned: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string") return { ok: false, error: `final_urls entries must be strings, got ${typeof u}` };
    const t = u.trim();
    if (!t) return { ok: false, error: "final_urls entries must be non-empty" };
    if (!/^https?:\/\//i.test(t)) {
      return { ok: false, error: `final_urls entry "${t}" must start with http:// or https://` };
    }
    cleaned.push(t);
  }
  return { ok: true, urls: cleaned };
}

function coerceArray(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("[")) {
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) return p;
      } catch { /* fall through */ }
    }
  }
  return undefined;
}

export function normalizeUpdateAssetUrlsArgs(raw: Record<string, unknown> | undefined): UpdateAssetUrlsArgs | { error: string } {
  const r = raw ?? {};
  const customer_id = typeof r.customer_id === "string" ? r.customer_id : undefined;
  const rawUpdates = coerceArray(r.updates);
  if (!rawUpdates || rawUpdates.length === 0) {
    return { error: "updates must be a non-empty array" };
  }
  const updates: AssetUrlUpdate[] = [];
  for (const u of rawUpdates) {
    if (!u || typeof u !== "object") return { error: "each updates entry must be an object" };
    const obj = u as Record<string, unknown>;
    const asset_id = typeof obj.asset_id === "string" ? obj.asset_id.trim()
      : typeof obj.asset_id === "number" ? String(obj.asset_id)
      : "";
    if (!asset_id || !/^\d+$/.test(asset_id)) {
      return { error: `invalid asset_id: ${JSON.stringify(obj.asset_id)}. Expected numeric asset ID.` };
    }
    const v = validateFinalUrls(obj.final_urls);
    if (!v.ok) return { error: `asset_id ${asset_id}: ${v.error}` };
    updates.push({ asset_id, final_urls: v.urls });
  }
  return {
    customer_id,
    updates,
    confirm: r.confirm === true || r.confirm === "true",
  };
}

export function normalizePauseAssetLinksArgs(raw: Record<string, unknown> | undefined): PauseAssetLinksArgs | { error: string } {
  const r = raw ?? {};
  const customer_id = typeof r.customer_id === "string" ? r.customer_id : undefined;
  const rawRns = coerceArray(r.resource_names);
  if (!rawRns || rawRns.length === 0) {
    return { error: "resource_names must be a non-empty array" };
  }
  const resource_names: string[] = [];
  for (const rn of rawRns) {
    if (typeof rn !== "string" || !rn.trim()) {
      return { error: "each resource_names entry must be a non-empty string" };
    }
    const parsed = parseAssetLinkResourceName(rn);
    if ("error" in parsed) return { error: parsed.error };
    resource_names.push(parsed.resource_name);
  }
  return {
    customer_id,
    resource_names,
    confirm: r.confirm === true || r.confirm === "true",
  };
}

export interface UpdateUrlsDryRun {
  dry_run: true;
  message: string;
  customer_id: string;
  updates: AssetUrlUpdate[];
  warning: string;
}

export function buildUpdateUrlsDryRun(args: UpdateAssetUrlsArgs): UpdateUrlsDryRun {
  return {
    dry_run: true,
    message: "DRY RUN. Nothing changed. Pass confirm: true to actually update.",
    customer_id: args.customer_id ?? "",
    updates: args.updates,
    warning: "Updating an asset's final_urls affects EVERY campaign/ad group/customer link that uses this asset ID. Verify attachments before confirming.",
  };
}

export interface PauseLinksDryRun {
  dry_run: true;
  message: string;
  customer_id: string;
  would_pause: {
    customer_asset: string[];
    campaign_asset: string[];
    ad_group_asset: string[];
  };
}

// ============================================
// CREATE SITELINK
// ============================================

export interface CreateSitelinkArgs {
  customer_id?: string;
  link_text: string;
  final_urls: string[];
  description1?: string;
  description2?: string;
  confirm?: boolean;
}

export interface CreateSitelinkDryRun {
  dry_run: true;
  message: string;
  customer_id: string;
  link_text: string;
  final_urls: string[];
  description1?: string;
  description2?: string;
}

function validateSitelinkText(value: unknown, field: string, max: number): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  const t = value.trim();
  if (!t) return { ok: false, error: `${field} must be non-empty` };
  if (t.length > max) return { ok: false, error: `${field} exceeds ${max} chars (got ${t.length})` };
  return { ok: true, value: t };
}

export function normalizeCreateSitelinkArgs(raw: Record<string, unknown> | undefined): CreateSitelinkArgs | { error: string } {
  const r = raw ?? {};
  const customer_id = typeof r.customer_id === "string" ? r.customer_id : undefined;

  const linkText = validateSitelinkText(r.link_text, "link_text", 25);
  if (!linkText.ok) return { error: linkText.error };

  const urls = validateFinalUrls(r.final_urls);
  if (!urls.ok) return { error: urls.error };

  const out: CreateSitelinkArgs = {
    customer_id,
    link_text: linkText.value,
    final_urls: urls.urls,
    confirm: r.confirm === true || r.confirm === "true",
  };

  if (r.description1 !== undefined && r.description1 !== null && r.description1 !== "") {
    const d = validateSitelinkText(r.description1, "description1", 35);
    if (!d.ok) return { error: d.error };
    out.description1 = d.value;
  }
  if (r.description2 !== undefined && r.description2 !== null && r.description2 !== "") {
    const d = validateSitelinkText(r.description2, "description2", 35);
    if (!d.ok) return { error: d.error };
    out.description2 = d.value;
  }
  if ((out.description1 && !out.description2) || (!out.description1 && out.description2)) {
    return { error: "description1 and description2 must both be set or both omitted" };
  }
  return out;
}

export function buildCreateSitelinkDryRun(args: CreateSitelinkArgs): CreateSitelinkDryRun {
  return {
    dry_run: true,
    message: "DRY RUN. Nothing created. Pass confirm: true to actually create the sitelink asset.",
    customer_id: args.customer_id ?? "",
    link_text: args.link_text,
    final_urls: args.final_urls,
    description1: args.description1,
    description2: args.description2,
  };
}

// ============================================
// REPLACE SITELINK URL
// ============================================

export interface ReplaceSitelinkArgs {
  customer_id?: string;
  old_asset_id: string;
  new_final_urls: string[];
  new_link_text?: string;
  new_description1?: string;
  new_description2?: string;
  confirm?: boolean;
}

export interface ReplaceSitelinkDryRun {
  dry_run: true;
  message: string;
  customer_id: string;
  old_asset_id: string;
  new_final_urls: string[];
  new_link_text_override?: string;
  warning: string;
}

export function normalizeReplaceSitelinkArgs(raw: Record<string, unknown> | undefined): ReplaceSitelinkArgs | { error: string } {
  const r = raw ?? {};
  const customer_id = typeof r.customer_id === "string" ? r.customer_id : undefined;

  const assetIdRaw = typeof r.old_asset_id === "string" ? r.old_asset_id.trim()
    : typeof r.old_asset_id === "number" ? String(r.old_asset_id)
    : "";
  if (!assetIdRaw || !/^\d+$/.test(assetIdRaw)) {
    return { error: `invalid old_asset_id: ${JSON.stringify(r.old_asset_id)}. Expected numeric asset ID.` };
  }

  const urls = validateFinalUrls(r.new_final_urls);
  if (!urls.ok) return { error: urls.error };

  const out: ReplaceSitelinkArgs = {
    customer_id,
    old_asset_id: assetIdRaw,
    new_final_urls: urls.urls,
    confirm: r.confirm === true || r.confirm === "true",
  };

  if (r.new_link_text !== undefined && r.new_link_text !== null && r.new_link_text !== "") {
    const d = validateSitelinkText(r.new_link_text, "new_link_text", 25);
    if (!d.ok) return { error: d.error };
    out.new_link_text = d.value;
  }
  if (r.new_description1 !== undefined && r.new_description1 !== null && r.new_description1 !== "") {
    const d = validateSitelinkText(r.new_description1, "new_description1", 35);
    if (!d.ok) return { error: d.error };
    out.new_description1 = d.value;
  }
  if (r.new_description2 !== undefined && r.new_description2 !== null && r.new_description2 !== "") {
    const d = validateSitelinkText(r.new_description2, "new_description2", 35);
    if (!d.ok) return { error: d.error };
    out.new_description2 = d.value;
  }
  return out;
}

export function buildReplaceSitelinkDryRun(args: ReplaceSitelinkArgs): ReplaceSitelinkDryRun {
  return {
    dry_run: true,
    message: "DRY RUN. Nothing changed. Pass confirm: true to replace the sitelink.",
    customer_id: args.customer_id ?? "",
    old_asset_id: args.old_asset_id,
    new_final_urls: args.new_final_urls,
    new_link_text_override: args.new_link_text,
    warning: "Will create a NEW sitelink asset, re-link every campaign/ad-group/customer link currently pointing at old_asset_id, then remove the old links. The old Asset itself is NOT deleted and can still be re-used manually.",
  };
}

export function buildPauseLinksDryRun(args: PauseAssetLinksArgs): PauseLinksDryRun {
  const would: PauseLinksDryRun["would_pause"] = {
    customer_asset: [],
    campaign_asset: [],
    ad_group_asset: [],
  };
  for (const rn of args.resource_names) {
    const parsed = parseAssetLinkResourceName(rn);
    if (!("error" in parsed)) {
      would[parsed.level].push(parsed.resource_name);
    }
  }
  return {
    dry_run: true,
    message: "DRY RUN. Nothing paused. Pass confirm: true to actually pause.",
    customer_id: args.customer_id ?? "",
    would_pause: would,
  };
}
