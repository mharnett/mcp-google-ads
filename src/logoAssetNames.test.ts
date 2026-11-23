/**
 * The Demand Gen create's logo check, as pure functions: split an asset name
 * into words, build the GAQL that reads the logo assets' names, and decide
 * whether the rows refuse the create. The call-site tests in
 * createDemandGenMultiAssetAd.logoNames.test.ts drive the real create.
 */
import { describe, expect, it } from "vitest";

import { assetNameWords, logoAssetNamesQuery, logoNameRefusal } from "./logoAssetNames.js";

describe("assetNameWords", () => {
  it("splits camelCase, kebab, snake and digit runs into lower-case whole words", () => {
    expect([...assetNameWords("ManHoldingPhone")].sort()).toEqual(["holding", "man", "phone"]);
    expect([...assetNameWords("woman-with_laptop 2")].sort()).toEqual(["2", "laptop", "with", "woman"]);
    expect([...assetNameWords("PORTRAITPhoto")].sort()).toEqual(["photo", "portrait"]);
  });

  it("matches whole words, never substrings: demand-gen-logo holds 'man' only inside 'demand'", () => {
    expect([...assetNameWords("demand-gen-logo")].sort()).toEqual(["demand", "gen", "logo"]);
  });

  it("returns no words for an empty or missing name", () => {
    expect(assetNameWords("").size).toBe(0);
    expect(assetNameWords(undefined).size).toBe(0);
  });
});

describe("logoAssetNamesQuery", () => {
  it("reads id, name and type for exactly the requested asset ids", () => {
    const q = logoAssetNamesQuery(["111", "222"]);
    expect(q).toMatch(/^SELECT asset\.id, asset\.name, asset\.type FROM asset WHERE asset\.id IN \(111, 222\)$/);
  });

  it("refuses an id that is not digits, before any read", () => {
    expect(() => logoAssetNamesQuery(["111", "222) OR (1=1"])).toThrow(/logo_image_asset_ids\[1\] must be a numeric id/);
  });
});

describe("logoNameRefusal", () => {
  const row = (id: number | string, name: string) => ({ asset: { id, name, type: "IMAGE" } });

  it("passes brand-logo names", () => {
    expect(
      logoNameRefusal(["1", "2"], [row(1, "Example-Logo-Square"), row(2, "demand-gen-logo")]),
    ).toBeNull();
  });

  it("refuses a logo whose name reads as a photo of a person, naming the asset and the words", () => {
    const refusal = logoNameRefusal(["1", "2"], [row(1, "Example-Logo-Square"), row(2, "ManHoldingPhone")]);
    expect(refusal).toMatch(/^Demand Gen ad not created: /);
    expect(refusal).toMatch(/'ManHoldingPhone' \(id 2\): holding, man, phone/);
    expect(refusal).not.toMatch(/Example-Logo-Square/);
    expect(refusal).toMatch(/allow_person_photo_logos=true/);
  });

  it("lists every flagged logo, in the order given", () => {
    const refusal = logoNameRefusal(["3", "1"], [row(1, "woman-with-laptop"), row(3, "Portrait of a person")]);
    expect(refusal).toMatch(/'Portrait of a person' \(id 3\): person, portrait; 'woman-with-laptop' \(id 1\): woman/);
  });

  it("refuses when a requested logo id did not come back, since its name could not be checked", () => {
    const refusal = logoNameRefusal(["1", "2"], [row(1, "Example-Logo-Square")]);
    expect(refusal).toMatch(/^Demand Gen ad not created: logo asset id 2 was not found/);
  });

  it("matches ids whether the API returns them as numbers or strings", () => {
    expect(logoNameRefusal(["1"], [row("1", "Example-Logo-Square")])).toBeNull();
    expect(logoNameRefusal(["1"], [row(1, "Example-Logo-Square")])).toBeNull();
  });
});
