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

  it("type=DEMAND_GEN_MULTI_ASSET_AD_GROUP emits proto value 21 (not in v23 client enum)", () => {
    const payload = buildAdGroupCreatePayload({
      customer_id_clean: "1234567890",
      name: "DG AG",
      campaign_id: "777",
      type: "DEMAND_GEN_MULTI_ASSET_AD_GROUP",
    });

    expect(payload.type).toBe(21);
  });
});
