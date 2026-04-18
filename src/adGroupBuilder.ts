import { enums } from "google-ads-api";

/**
 * Pure builder for ad-group creation payloads. Separate from the manager so
 * it can be unit-tested without stubbing the live API.
 *
 * `type` for DEMAND_GEN_MULTI_ASSET_AD_GROUP emits the raw proto value 21
 * because the google-ads-api v23 enum map does not include it; the typed
 * AdGroup create path validates against the local enum, so DG creation must
 * flow through customer.mutateResources (which trusts the numeric value).
 */

export type AdGroupTypeName = "SEARCH_STANDARD" | "DEMAND_GEN_MULTI_ASSET_AD_GROUP";

// Proto value for DEMAND_GEN_MULTI_ASSET_AD_GROUP — see google.ads.googleads
// .v21.enums.AdGroupTypeEnum. v23 client typings are missing this constant.
export const AD_GROUP_TYPE_DEMAND_GEN_MULTI_ASSET = 21;

export interface AdGroupCreateInput {
  customer_id_clean: string; // without dashes
  name: string;
  campaign_id: string;
  cpc_bid_micros?: number;
  type?: AdGroupTypeName;
}

export interface AdGroupCreatePayload {
  name: string;
  campaign: string;
  status: number;
  cpc_bid_micros: number;
  type: number;
}

export function buildAdGroupCreatePayload(input: AdGroupCreateInput): AdGroupCreatePayload {
  const typeEnum =
    input.type === "DEMAND_GEN_MULTI_ASSET_AD_GROUP"
      ? AD_GROUP_TYPE_DEMAND_GEN_MULTI_ASSET
      : enums.AdGroupType.SEARCH_STANDARD;

  return {
    name: input.name,
    campaign: `customers/${input.customer_id_clean}/campaigns/${input.campaign_id}`,
    status: enums.AdGroupStatus.PAUSED,
    cpc_bid_micros: input.cpc_bid_micros ?? 1_000_000,
    type: typeEnum,
  };
}
