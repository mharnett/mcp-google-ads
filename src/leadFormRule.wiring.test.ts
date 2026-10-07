/**
 * Lead form rule wiring (2026-10-07).
 *
 * The guard in campaignBuilder.ts only protects anything if both lead-form
 * entry points call it before touching the API. This reads index.ts and
 * checks each handler's case block, so removing the call fails here even
 * though every unit test of the guard itself still passes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "./tools.js";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

function caseBlock(name: string): string {
  const start = SRC.indexOf(`case "${name}":`);
  expect(start, `no case for ${name}`).toBeGreaterThan(-1);
  const next = SRC.indexOf('case "google_ads_', start + 10);
  return SRC.slice(start, next === -1 ? undefined : next);
}

describe("lead form rule is wired into every lead-form entry point", () => {
  it("create_lead_form_asset checks the flag before calling the API", () => {
    const block = caseBlock("google_ads_create_lead_form_asset");
    const guard = block.indexOf("assertLeadFormExplicitlyRequested(");
    const api = block.indexOf("createLeadFormAsset(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(api);
  });

  it("link_asset_to_campaign checks the flag for LEAD_FORM before the dry run and the API", () => {
    const block = caseBlock("google_ads_link_asset_to_campaign");
    const guard = block.indexOf("assertLeadFormExplicitlyRequested(");
    expect(guard).toBeGreaterThan(-1);
    expect(block.indexOf("isLeadFormFieldType(")).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(block.indexOf("dry_run"));
    expect(guard).toBeLessThan(block.indexOf("linkAssetToCampaign("));
  });

  it("both tools expose explicit_lead_form_request and say why", () => {
    for (const name of ["google_ads_create_lead_form_asset", "google_ads_link_asset_to_campaign"]) {
      const tool = tools.find((t) => t.name === name)!;
      const prop = (tool.inputSchema as any).properties.explicit_lead_form_request;
      expect(prop?.type, name).toBe("boolean");
      expect(prop.description).toMatch(/explicitly asked/i);
    }
  });
});
