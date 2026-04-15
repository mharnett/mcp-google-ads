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
