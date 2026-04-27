import { enums } from "google-ads-api";

/**
 * Pure builder for ad-group creation payloads. Separate from the manager so
 * it can be unit-tested without stubbing the live API.
 *
 * DEMAND_GEN_MULTI_ASSET_AD_GROUP uses the string enum name rather than the
 * integer 21. The v23 library's local enum map does not include 21, so integer
 * 21 gets JSON-serialized as "UNKNOWN_ENUM_VALUE_AdGroupType_21" which the API
 * rejects. Passing the string name directly bypasses the local enum lookup.
 * DG creation still flows through customer.mutateResources to avoid the typed
 * AdGroup.create path which only accepts known client-side enum values.
 */

export type AdGroupTypeName = "SEARCH_STANDARD" | "DEMAND_GEN_MULTI_ASSET_AD_GROUP";

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
  type: number | string;
}

export function buildAdGroupCreatePayload(input: AdGroupCreateInput): AdGroupCreatePayload {
  const typeEnum: number | string =
    input.type === "DEMAND_GEN_MULTI_ASSET_AD_GROUP"
      ? "DEMAND_GEN_MULTI_ASSET_AD_GROUP"  // string name avoids the unknown-enum serialization
      : enums.AdGroupType.SEARCH_STANDARD;

  return {
    name: input.name,
    campaign: `customers/${input.customer_id_clean}/campaigns/${input.campaign_id}`,
    status: enums.AdGroupStatus.PAUSED,
    cpc_bid_micros: input.cpc_bid_micros ?? 1_000_000,
    type: typeEnum,
  };
}
