import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("google-ads-api dependency version", () => {
  it("resolves an installed google-ads-api whose googleAdsVersion is v24 or higher", () => {
    // This reads the *runtime* constant baked into the installed package
    // (node_modules/google-ads-api/build/src/version.js), not the package.json
    // semver range or npm registry README, which can lag the shipped code.
    const { googleAdsVersion } = require("google-ads-api/build/src/version.js");

    expect(googleAdsVersion).toMatch(/^v\d+$/);
    const majorVersion = Number(googleAdsVersion.slice(1));
    expect(majorVersion).toBeGreaterThanOrEqual(24);
  });
});
