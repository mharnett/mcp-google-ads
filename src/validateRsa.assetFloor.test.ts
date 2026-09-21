import { describe, it, expect } from "vitest";

import { validateRsa } from "./validateRsa.js";

const BASE_VALID_AD = {
  headlines: ["Headline 1", "Headline 2", "Headline 3"],
  descriptions: ["Description 1", "Description 2"],
  final_urls: ["https://example.com/"],
  path1: "nonprofit",
  path2: "crm",
  labels: ["claude-2026-04-12"],
};

const FLOOR_HEADLINES = Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`);
const FLOOR_DESCRIPTIONS = Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`);

describe("validateRsa asset floor (enforceAssetFloor)", () => {
  it("rejects 3 headlines / 2 descriptions when enforceAssetFloor is true, naming both the supplied count and the required floor", () => {
    const result = validateRsa({
      ...BASE_VALID_AD,
      enforceAssetFloor: true,
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => /House floor requires at least 15 headlines, got 3/.test(e))
    ).toBe(true);
    expect(
      result.errors.some((e) => /House floor requires at least 4 descriptions, got 2/.test(e))
    ).toBe(true);
  });

  it("accepts 15 headlines / 4 descriptions when enforceAssetFloor is true", () => {
    const result = validateRsa({
      ...BASE_VALID_AD,
      headlines: FLOOR_HEADLINES,
      descriptions: FLOOR_DESCRIPTIONS,
      enforceAssetFloor: true,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still accepts 3 headlines / 2 descriptions when enforceAssetFloor is omitted (default path unaffected)", () => {
    const result = validateRsa(BASE_VALID_AD);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still accepts 3 headlines / 2 descriptions when enforceAssetFloor is explicitly false", () => {
    const result = validateRsa({
      ...BASE_VALID_AD,
      enforceAssetFloor: false,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
