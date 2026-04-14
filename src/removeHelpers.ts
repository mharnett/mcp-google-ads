// Pure helpers for google_ads_remove_items.
// Extracted from the handler so the dry-run + ordering logic is unit-testable
// without mocking the Google Ads API client.

export interface RemoveArgs {
  customer_id?: string;
  campaign_ids?: string[];
  ad_group_ids?: string[];
  ad_ids?: string[];
  confirm?: boolean;
  labels?: string[];
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateRemoveInput(args: RemoveArgs): ValidationResult {
  const hasCampaigns = (args.campaign_ids?.length ?? 0) > 0;
  const hasAdGroups = (args.ad_group_ids?.length ?? 0) > 0;
  const hasAds = (args.ad_ids?.length ?? 0) > 0;
  if (!hasCampaigns && !hasAdGroups && !hasAds) {
    return {
      ok: false,
      error: "No item IDs provided. Specify campaign_ids, ad_group_ids, or ad_ids.",
    };
  }
  return { ok: true };
}

export interface RemovePreview {
  dry_run: true;
  message: string;
  customer_id: string;
  would_remove: {
    campaigns: string[];
    ad_groups: string[];
    ads: string[];
  };
  labels_to_apply: string[];
  removal_order: string;
}

export function buildRemovePreview(args: RemoveArgs): RemovePreview {
  return {
    dry_run: true,
    message: "DRY RUN. Nothing removed. Pass confirm: true to actually remove.",
    customer_id: args.customer_id ?? "",
    would_remove: {
      campaigns: args.campaign_ids ?? [],
      ad_groups: args.ad_group_ids ?? [],
      ads: args.ad_ids ?? [],
    },
    labels_to_apply: args.labels ?? [],
    removal_order: "ads → ad_groups → campaigns (child-up, so parent removes don't fail on enabled children)",
  };
}

export type RemovalStep =
  | { type: "ads"; ids: string[] }
  | { type: "ad_groups"; ids: string[] }
  | { type: "campaigns"; ids: string[] };

// Child-up order: ads first, then ad_groups, then campaigns.
// Mitigates pre-mortem #3 (campaign remove with enabled children).
export function orderRemovalsChildUp(args: RemoveArgs): RemovalStep[] {
  const steps: RemovalStep[] = [];
  if (args.ad_ids?.length) steps.push({ type: "ads", ids: args.ad_ids });
  if (args.ad_group_ids?.length) steps.push({ type: "ad_groups", ids: args.ad_group_ids });
  if (args.campaign_ids?.length) steps.push({ type: "campaigns", ids: args.campaign_ids });
  return steps;
}
