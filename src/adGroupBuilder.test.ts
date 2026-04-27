import { describe, it, expect } from "vitest";
import { buildAdGroupCreatePayload } from "./adGroupBuilder.js";
import { enums } from "google-ads-api";

describe("buildAdGroupCreatePayload", () => {
  it("defaults to SEARCH_STANDARD when type not specified (back-compat)", () => {
    const payload = buildAdGroupCreatePayload({
      customer_id_clean: "1234567890",
      name: "AG1",
      campaign_id: "555",
    });

    expect(payload.type).toBe(enums.AdGroupType.SEARCH_STANDARD);
    expect(payload.type).toBe(2);
    expect(payload.campaign).toBe("customers/1234567890/campaigns/555");
    expect(payload.status).toBe(enums.AdGroupStatus.PAUSED);
    expect(payload.cpc_bid_micros).toBe(1_000_000);
  });

  it("type=DEMAND_GEN_MULTI_ASSET_AD_GROUP emits string name (not integer) to avoid unknown-enum serialization", () => {
    // v23 enum map lacks value 21; integer 21 gets JSON-serialized as
    // "UNKNOWN_ENUM_VALUE_AdGroupType_21" which the API rejects. Use the
    // string name "DEMAND_GEN_MULTI_ASSET_AD_GROUP" which passes through
    // JSON/REST serialization correctly.
    const payload = buildAdGroupCreatePayload({
      customer_id_clean: "1234567890",
      name: "DG AG",
      campaign_id: "777",
      type: "DEMAND_GEN_MULTI_ASSET_AD_GROUP",
    });

    expect(payload.type).toBe("DEMAND_GEN_MULTI_ASSET_AD_GROUP");
  });
});
