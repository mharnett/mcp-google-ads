/**
 * Pure validation for Demand Gen multi-asset ads. Kept as a standalone module
 * so we don't need to stand up a live Google Ads client to unit test the
 * rules. Rules come from Google Ads API docs for DemandGenMultiAssetAdInfo:
 *   - headlines:       max 5, each ≤ 40 chars
 *   - long_headlines:  max 5, each ≤ 90 chars
 *   - descriptions:    max 5, each ≤ 90 chars
 *   - marketing_image_asset_ids: required, ≥ 1 (1.91:1 landscape images)
 *   - business_name:   required, non-empty
 *   - call_to_action:  required, non-empty (string CTA enum value)
 *   - final_urls:      required, ≥ 1
 */

export interface DemandGenAdInput {
  final_urls: string[];
  business_name: string;
  call_to_action: string;
  marketing_image_asset_ids: string[];
  square_marketing_image_asset_ids?: string[];
  portrait_marketing_image_asset_ids?: string[];
  logo_image_asset_ids?: string[];
  headlines: Array<string | { text: string; pinned_position?: number }>;
  long_headlines?: string[];
  descriptions: string[];
  labels?: string[];
}

export interface DemandGenAdValidationResult {
  valid: boolean;
  errors: string[];
}

export const MAX_HEADLINES = 5;
export const MAX_HEADLINE_LEN = 40;
export const MAX_LONG_HEADLINES = 5;
export const MAX_LONG_HEADLINE_LEN = 90;
export const MAX_DESCRIPTIONS = 5;
export const MAX_DESCRIPTION_LEN = 90;

function headlineText(h: string | { text: string; pinned_position?: number }): string {
  return typeof h === "string" ? h : h.text;
}

/**
 * Build the raw Google Ads DemandGenMultiAssetAdInfo payload. Asset IDs in the
 * input are expanded to full resource names. Optional image fields are only
 * set when the caller provided a non-empty list.
 *
 * NOTE: the v23 typed helper for AdService is missing the long_headlines field
 * on DemandGenMultiAssetAdInfo. We emit long_headlines regardless; the payload
 * is submitted via customer.mutateResources which accepts unknown fields and
 * forwards them to the server.
 */
export interface DemandGenAdPayload {
  ad_group: string;
  status: number;
  ad: {
    final_urls: string[];
    demand_gen_multi_asset_ad: Record<string, any>;
  };
}

export function buildDemandGenAdPayload(args: {
  customer_id_clean: string;
  ad_group_id: string;
  input: DemandGenAdInput;
}): DemandGenAdPayload {
  const { customer_id_clean, ad_group_id, input } = args;
  const assetRef = (id: string) => ({ asset: `customers/${customer_id_clean}/assets/${id}` });

  const dgAd: Record<string, any> = {
    business_name: input.business_name,
    call_to_action_text: input.call_to_action,
    marketing_images: input.marketing_image_asset_ids.map(assetRef),
    headlines: input.headlines.map((h) => ({ text: headlineText(h) })),
    descriptions: input.descriptions.map((t) => ({ text: t })),
  };

  if (input.square_marketing_image_asset_ids?.length) {
    dgAd.square_marketing_images = input.square_marketing_image_asset_ids.map(assetRef);
  }
  if (input.portrait_marketing_image_asset_ids?.length) {
    dgAd.portrait_marketing_images = input.portrait_marketing_image_asset_ids.map(assetRef);
  }
  if (input.logo_image_asset_ids?.length) {
    dgAd.logo_images = input.logo_image_asset_ids.map(assetRef);
  }
  if (input.long_headlines?.length) {
    dgAd.long_headlines = input.long_headlines.map((t) => ({ text: t }));
  }

  // PAUSED status — matches the platform-wide "Claude creates, human reviews" rule.
  // enums.AdGroupAdStatus.PAUSED = 3
  return {
    ad_group: `customers/${customer_id_clean}/adGroups/${ad_group_id}`,
    status: 3,
    ad: {
      final_urls: input.final_urls,
      demand_gen_multi_asset_ad: dgAd,
    },
  };
}

export function validateDemandGenAd(ad: DemandGenAdInput): DemandGenAdValidationResult {
  const errors: string[] = [];

  if (!ad.final_urls || ad.final_urls.length === 0) {
    errors.push("At least one final URL is required");
  }
  if (!ad.business_name || !ad.business_name.trim()) {
    errors.push("business_name is required");
  }
  if (!ad.call_to_action || !ad.call_to_action.trim()) {
    errors.push("call_to_action is required (e.g. 'LEARN_MORE')");
  }
  if (!ad.marketing_image_asset_ids || ad.marketing_image_asset_ids.length === 0) {
    errors.push("At least one marketing_image_asset_id is required");
  }

  // Headlines
  if (!ad.headlines || ad.headlines.length === 0) {
    errors.push("At least one headline is required");
  } else if (ad.headlines.length > MAX_HEADLINES) {
    errors.push(`Maximum ${MAX_HEADLINES} headlines, got ${ad.headlines.length}`);
  }
  (ad.headlines ?? []).forEach((h, i) => {
    const text = headlineText(h);
    if (text.length > MAX_HEADLINE_LEN) {
      errors.push(`Headline ${i + 1} too long (${text.length}/${MAX_HEADLINE_LEN}): "${text}"`);
    }
  });

  // Long headlines (optional)
  if (ad.long_headlines && ad.long_headlines.length > MAX_LONG_HEADLINES) {
    errors.push(`Maximum ${MAX_LONG_HEADLINES} long_headlines, got ${ad.long_headlines.length}`);
  }
  (ad.long_headlines ?? []).forEach((t, i) => {
    if (t.length > MAX_LONG_HEADLINE_LEN) {
      errors.push(`Long headline ${i + 1} too long (${t.length}/${MAX_LONG_HEADLINE_LEN}): "${t}"`);
    }
  });

  // Descriptions
  if (!ad.descriptions || ad.descriptions.length === 0) {
    errors.push("At least one description is required");
  } else if (ad.descriptions.length > MAX_DESCRIPTIONS) {
    errors.push(`Maximum ${MAX_DESCRIPTIONS} descriptions, got ${ad.descriptions.length}`);
  }
  (ad.descriptions ?? []).forEach((t, i) => {
    if (t.length > MAX_DESCRIPTION_LEN) {
      errors.push(`Description ${i + 1} too long (${t.length}/${MAX_DESCRIPTION_LEN}): "${t}"`);
    }
  });

  return { valid: errors.length === 0, errors };
}
