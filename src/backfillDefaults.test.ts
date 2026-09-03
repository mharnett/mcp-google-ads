import { describe, it, expect } from "vitest";
import {
  extractSelectedFields,
  resolveFieldType,
  backfillOmittedBooleans,
} from "./backfillDefaults.js";

// Origin: 2026-09-03, Forcepoint. google_ads_gaql_query returned a row with no
// `optimized_targeting_enabled` key at all for an ad_group that genuinely had
// it set to `false` -- Google's REST API omits fields at their proto3 default
// value from the JSON body entirely (confirmed live: direct python client
// access to the same field returned `False`). A missing key is then
// indistinguishable from "not returned"/error, which is exactly the failure
// shape this repo's CLAUDE.md calls out ("a checker that silently skips a
// category reports success for it").

describe("extractSelectedFields", () => {
  it("parses a simple SELECT clause", () => {
    const q = "SELECT ad_group.id, ad_group.name FROM ad_group";
    expect(extractSelectedFields(q)).toEqual(["ad_group.id", "ad_group.name"]);
  });

  it("handles multiline queries and WHERE clauses", () => {
    const q = `SELECT
      campaign.id,
      campaign.geo_target_type_setting.positive_geo_target_type
    FROM campaign WHERE campaign.status = 'ENABLED'`;
    expect(extractSelectedFields(q)).toEqual([
      "campaign.id",
      "campaign.geo_target_type_setting.positive_geo_target_type",
    ]);
  });

  it("returns an empty array when there's no FROM clause", () => {
    expect(extractSelectedFields("not a query")).toEqual([]);
  });
});

describe("resolveFieldType", () => {
  it("resolves a known BOOL leaf field", () => {
    expect(resolveFieldType("ad_group.optimized_targeting_enabled")).toBe("BOOL");
  });

  it("resolves a nested enum leaf as its object map, not a bare string", () => {
    // positive_geo_target_type is an ENUM lookup table, not a scalar -- must
    // not be misidentified as BOOL/STRING/etc.
    expect(resolveFieldType("campaign.geo_target_type_setting.positive_geo_target_type")).toBeUndefined();
  });

  it("returns undefined for an unknown resource", () => {
    expect(resolveFieldType("not_a_real_resource.some_field")).toBeUndefined();
  });

  it("returns undefined for a bare resource with no field segment", () => {
    expect(resolveFieldType("ad_group")).toBeUndefined();
  });
});

describe("backfillOmittedBooleans", () => {
  const query = "SELECT ad_group.id, ad_group.optimized_targeting_enabled FROM ad_group";

  it("backfills a missing BOOL leaf to false when its parent object is present", () => {
    const rows = [{ ad_group: { id: 1 } }];
    const result = backfillOmittedBooleans(query, rows);
    expect(result[0].ad_group.optimized_targeting_enabled).toBe(false);
  });

  it("leaves an explicitly-true value untouched", () => {
    const rows = [{ ad_group: { id: 1, optimized_targeting_enabled: true } }];
    const result = backfillOmittedBooleans(query, rows);
    expect(result[0].ad_group.optimized_targeting_enabled).toBe(true);
  });

  it("does not fabricate the parent object when the resource itself is absent from the row", () => {
    const rows = [{ metrics: { impressions: "5" } }];
    const result = backfillOmittedBooleans(query, rows);
    expect(result[0]).not.toHaveProperty("ad_group");
  });

  it("is a no-op when no selected field resolves to BOOL", () => {
    const q2 = "SELECT campaign.id, campaign.name FROM campaign";
    const rows = [{ campaign: { id: 1 } }];
    const result = backfillOmittedBooleans(q2, rows);
    expect(result).toEqual([{ campaign: { id: 1 } }]);
  });

  it("handles multiple rows independently", () => {
    const rows = [
      { ad_group: { id: 1 } },
      { ad_group: { id: 2, optimized_targeting_enabled: true } },
    ];
    const result = backfillOmittedBooleans(query, rows);
    expect(result[0].ad_group.optimized_targeting_enabled).toBe(false);
    expect(result[1].ad_group.optimized_targeting_enabled).toBe(true);
  });
});
