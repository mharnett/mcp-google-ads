/**
 * Pure validation for Demand Gen multi-asset ads. Kept as a standalone module
 * so we don't need to stand up a live Google Ads client to unit test the
 * rules. Rules come from Google Ads API docs for DemandGenMultiAssetAdInfo:
 *   - headlines:       max 5, each ≤ 40 chars
 *   - long_headlines:  max 5, each ≤ 90 chars
 *   - descriptions:    max 5, each ≤ 90 chars
 *   - marketing_image_asset_ids: optional, ≥ 1 when provided (1.91:1 landscape images); video-only ads supported
 *   - video_asset_ids:  optional, YouTube video asset IDs for video-only (or video+image) ads
 *   - business_name:   required, non-empty
 *   - call_to_action:  required, non-empty (string CTA enum value)
 *   - final_urls:      required, ≥ 1
 */

export interface DemandGenAdInput {
  final_urls: string[];
  business_name: string;
  call_to_action: string;
  /** Optional internal ad name (not user-facing). Set once at creation —
   *  ad.name is immutable on DG multi-asset ads after create. */
  name?: string;
  marketing_image_asset_ids?: string[];
  square_marketing_image_asset_ids?: string[];
  portrait_marketing_image_asset_ids?: string[];
  logo_image_asset_ids?: string[];
  video_asset_ids?: string[];
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
    name?: string;
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
    call_to_action_text: normalizeCallToAction(input.call_to_action),
    headlines: input.headlines.map((h) => ({ text: headlineText(h) })),
    descriptions: input.descriptions.map((t) => ({ text: t })),
  };

  // marketing_images is optional for video-only ads
  if (input.marketing_image_asset_ids?.length) {
    dgAd.marketing_images = input.marketing_image_asset_ids.map(assetRef);
  }

  if (input.square_marketing_image_asset_ids?.length) {
    dgAd.square_marketing_images = input.square_marketing_image_asset_ids.map(assetRef);
  }
  if (input.portrait_marketing_image_asset_ids?.length) {
    dgAd.portrait_marketing_images = input.portrait_marketing_image_asset_ids.map(assetRef);
  }
  if (input.logo_image_asset_ids?.length) {
    dgAd.logo_images = input.logo_image_asset_ids.map(assetRef);
  }
  if (input.video_asset_ids?.length) {
    dgAd.videos = input.video_asset_ids.map(assetRef);
  }
  if (input.long_headlines?.length) {
    dgAd.long_headlines = input.long_headlines.map((t) => ({ text: t }));
  }

  // PAUSED status — matches the platform-wide "Claude creates, human reviews" rule.
  // enums.AdGroupAdStatus.PAUSED = 3
  const ad: DemandGenAdPayload["ad"] = {
    final_urls: input.final_urls,
    demand_gen_multi_asset_ad: dgAd,
  };
  // ad.name is a create-only, non-user-facing identifier (immutable after create).
  if (input.name) {
    ad.name = input.name;
  }
  return {
    ad_group: `customers/${customer_id_clean}/adGroups/${ad_group_id}`,
    status: 3,
    ad,
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
  // marketing_image_asset_ids is now optional for video-only ads

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

/**
 * DEMAND_GEN channel type enum value. Kept as a literal so this module doesn't
 * pull in google-ads-api for a single constant that never changes at runtime.
 * See enums.AdvertisingChannelType.DEMAND_GEN.
 */
const DEMAND_GEN_CHANNEL_TYPE = 14;

/**
 * Decide whether a GAQL row describes a Demand Gen ad group. Accepts two
 * orthogonal signals:
 *   1) ad_group.type matches DEMAND_GEN_MULTI_ASSET_AD_GROUP (proto value 21
 *      or its string name when future libs add it).
 *   2) campaign.advertising_channel_type === DEMAND_GEN (14). This is the
 *      authoritative check because DG campaigns can only contain DG ad groups,
 *      and google-ads-api v23 returns undefined for ad_group.type when the
 *      stored proto value isn't in its local enum map.
 */
export function isDemandGenAdGroup(row: any): boolean {
  if (!row) return false;
  const agType = row.ad_group?.type;
  const campaignChannelType = row.campaign?.advertising_channel_type;
  return (
    agType === 21 ||
    agType === "21" ||
    agType === "DEMAND_GEN_MULTI_ASSET_AD_GROUP" ||
    campaignChannelType === DEMAND_GEN_CHANNEL_TYPE ||
    campaignChannelType === "DEMAND_GEN"
  );
}

/**
 * Google Ads' DemandGenMultiAssetAdInfo.call_to_action_text accepts a closed
 * set of DISPLAY strings (e.g. "Learn more") — NOT the enum-style names
 * (e.g. "LEARN_MORE") that are used in the CallToActionType enum. The server
 * rejects enum-style names with "Invalid call to action text."
 *
 * This helper normalizes enum-style names to the display strings Google
 * accepts. Display-cased strings pass through unchanged. Unknown values pass
 * through so the server's error (rather than a silent fallback) surfaces.
 *
 * Discovered during live Survey Measure launch 2026-04-17.
 */
const CTA_DISPLAY_MAP: Record<string, string> = {
  LEARN_MORE: "Learn more",
  GET_QUOTE: "Get quote",
  APPLY_NOW: "Apply now",
  SIGN_UP: "Sign up",
  CONTACT_US: "Contact us",
  SUBSCRIBE: "Subscribe",
  DOWNLOAD: "Download",
  BOOK_NOW: "Book now",
  SHOP_NOW: "Shop now",
  BUY_NOW: "Buy now",
  DONATE_NOW: "Donate now",
  ORDER_NOW: "Order now",
  PLAY_NOW: "Play now",
  SEE_MORE: "See more",
  START_NOW: "Start now",
  VISIT_SITE: "Visit site",
  WATCH_NOW: "Watch now",
};

export function normalizeCallToAction(input: string): string {
  if (!input) return input;
  const key = input.toUpperCase();
  return CTA_DISPLAY_MAP[key] ?? input;
}
