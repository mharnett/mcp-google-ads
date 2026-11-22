/**
 * google_ads_link_asset_to_ad_group (2026-10-23).
 *
 * Ad-group asset links had no MCP path: link_asset_to_campaign is
 * campaign-only, link_asset_to_customer is account-only, and
 * replace_sitelink_url re-links every attachment of the old asset. The
 * 2026-10-07 client brand-sitelink change went through a one-off Python
 * script instead. These tests pin the replacement tool's contract.
 *
 * The rule worth encoding: once an ad group has ANY enabled ad-group
 * sitelink, its campaign-level sitelinks stop serving there. So linking the
 * first ad-group sitelink to an ad group can silently cut it from (say) 6
 * sitelinks to 1. The tool warns whenever the resulting ad-group count is
 * below 4.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizeLinkAssetToAdGroupArgs,
  assessAdGroupAssetCoverage,
  runLinkAssetToAdGroup,
  MIN_AD_GROUP_SITELINKS,
  type AdGroupAssetState,
} from "./adGroupAssetLink.js";
import { parseAssetLinkResourceName } from "./assetHelpers.js";
import { isValidClaudeLabel } from "./claudeLabel.js";
import { tools } from "./tools.js";
import { WRITE_TOOLS } from "./writeGate.js";

const TOOL = "google_ads_link_asset_to_ad_group";

function state(over: Partial<AdGroupAssetState> = {}): AdGroupAssetState {
  return {
    ad_group_id: "40",
    ad_group_name: "Example ad group",
    campaign_name: "Example campaign",
    enabled_asset_ids: [],
    paused_asset_ids: [],
    ...over,
  };
}

describe("normalizeLinkAssetToAdGroupArgs", () => {
  it("defaults to dry-run", () => {
    const r = normalizeLinkAssetToAdGroupArgs({ asset_id: "999", ad_group_ids: ["40"], field_type: "SITELINK" });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.confirm).toBe(false);
    expect(r.field_type).toBe("SITELINK");
    expect(r.ad_group_ids).toEqual(["40"]);
  });

  it("confirm: true applies", () => {
    const r = normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["2"], field_type: "callout", confirm: true });
    if ("error" in r) throw new Error(r.error);
    expect(r.confirm).toBe(true);
    expect(r.field_type).toBe("CALLOUT");
  });

  it("rejects non-numeric ids, empty ad_group_ids and unknown field types", () => {
    expect("error" in normalizeLinkAssetToAdGroupArgs({ asset_id: "abc", ad_group_ids: ["2"], field_type: "SITELINK" })).toBe(true);
    expect("error" in normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: [], field_type: "SITELINK" })).toBe(true);
    expect("error" in normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["x"], field_type: "SITELINK" })).toBe(true);
    expect("error" in normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["2"], field_type: "IMAGE" })).toBe(true);
  });

  it("refuses LEAD_FORM unless explicit_lead_form_request is true", () => {
    for (const v of [undefined, false, "true", 1]) {
      const r = normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["2"], field_type: "LEAD_FORM", explicit_lead_form_request: v });
      expect("error" in r, String(v)).toBe(true);
      if ("error" in r) expect(r.error).toMatch(/explicit_lead_form_request/);
    }
    const ok = normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["2"], field_type: "LEAD_FORM", explicit_lead_form_request: true });
    expect("error" in ok).toBe(false);
  });

  it("accepts a valid audit_label and rejects a malformed one", () => {
    const ok = normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["2"], field_type: "SITELINK", audit_label: "claude-10-23-26-brand-sitelinks" });
    if ("error" in ok) throw new Error(ok.error);
    expect(ok.audit_label).toBe("claude-10-23-26-brand-sitelinks");
    expect("error" in normalizeLinkAssetToAdGroupArgs({ asset_id: "1", ad_group_ids: ["2"], field_type: "SITELINK", audit_label: "my label" })).toBe(true);
  });
});

describe("assessAdGroupAssetCoverage", () => {
  it("the minimum is 4", () => {
    expect(MIN_AD_GROUP_SITELINKS).toBe(4);
  });

  it("first ad-group sitelink: resulting 1, warns that campaign sitelinks stop serving", () => {
    const [a] = assessAdGroupAssetCoverage("999", "SITELINK", [state()]);
    expect(a.current_enabled_count).toBe(0);
    expect(a.resulting_enabled_count).toBe(1);
    expect(a.warning).toMatch(/fewer than 4/);
    expect(a.warning).toMatch(/campaign-level sitelinks/);
    expect(a.warning).toMatch(/Example ad group/);
  });

  it("3 existing + 1 new = 4: no warning", () => {
    const [a] = assessAdGroupAssetCoverage("999", "SITELINK", [state({ enabled_asset_ids: ["1", "2", "3"] })]);
    expect(a.resulting_enabled_count).toBe(4);
    expect(a.warning).toBeUndefined();
  });

  it("2 existing + 1 new = 3: warns, without the campaign-switch-off clause", () => {
    const [a] = assessAdGroupAssetCoverage("999", "SITELINK", [state({ enabled_asset_ids: ["1", "2"] })]);
    expect(a.resulting_enabled_count).toBe(3);
    expect(a.warning).toMatch(/3 enabled ad-group sitelinks/);
    expect(a.warning).not.toMatch(/campaign-level sitelinks/);
  });

  it("an asset already linked is not double-counted and is flagged", () => {
    const [a] = assessAdGroupAssetCoverage("999", "SITELINK", [state({ enabled_asset_ids: ["1", "2", "3", "999"] })]);
    expect(a.already_linked).toBe(true);
    expect(a.existing_link_status).toBe("ENABLED");
    expect(a.resulting_enabled_count).toBe(4);
  });

  it("an asset already linked PAUSED is flagged with its status and counted once it is enabled", () => {
    const [a] = assessAdGroupAssetCoverage("999", "SITELINK", [
      state({ enabled_asset_ids: ["1", "2"], paused_asset_ids: ["7", "999"] }),
    ]);
    expect(a.already_linked).toBe(true);
    expect(a.existing_link_status).toBe("PAUSED");
    // Other PAUSED links (7) do not serve, so they are not counted.
    expect(a.current_enabled_count).toBe(2);
    expect(a.resulting_enabled_count).toBe(3);
    expect(a.warning).toMatch(/3 enabled ad-group sitelinks/);
  });

  it("an asset not linked has no existing_link_status", () => {
    const [a] = assessAdGroupAssetCoverage("999", "CALLOUT", [state({ paused_asset_ids: ["7"] })]);
    expect(a.already_linked).toBe(false);
    expect(a.existing_link_status).toBeUndefined();
    expect(a.current_enabled_count).toBe(0);
  });

  it("no sitelink warning for CALLOUT", () => {
    const [a] = assessAdGroupAssetCoverage("999", "CALLOUT", [state()]);
    expect(a.resulting_enabled_count).toBe(1);
    expect(a.warning).toBeUndefined();
  });

  it("an ad group id the read did not return is reported, not silently dropped", () => {
    const out = assessAdGroupAssetCoverage("999", "SITELINK", [], ["123"]);
    expect(out).toHaveLength(1);
    expect(out[0].ad_group_id).toBe("123");
    expect(out[0].error).toMatch(/not found/);
  });
});

describe("runLinkAssetToAdGroup", () => {
  function deps(before: AdGroupAssetState[], after: AdGroupAssetState[] = before) {
    const getState = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    // The manager labels the ad groups it linked and returns the label it attached.
    const link = vi.fn().mockImplementation(async (a: { audit_label: string }) => ({
      resource_names: ["customers/9876543210/adGroupAssets/40~999~SITELINK"],
      audit_label: a.audit_label,
    }));
    return { getState, link, now: () => new Date("2026-10-23T19:00:00Z") };
  }

  it("dry run reads state, lists the ad group by name, never links", async () => {
    const d = deps([state()]);
    const out: any = await runLinkAssetToAdGroup(
      { customer_id: "9876543210", asset_id: "999", ad_group_ids: ["40"], field_type: "SITELINK", confirm: false },
      d,
    );
    expect(d.link).not.toHaveBeenCalled();
    expect(out.dry_run).toBe(true);
    expect(out.ad_groups[0].ad_group_name).toBe("Example ad group");
    expect(out.ad_groups[0].resulting_enabled_count).toBe(1);
    expect(out.warnings).toHaveLength(1);
    expect(out.pause_path).toMatch(/google_ads_pause_asset_links/);
    // The link it would create is PAUSED: the count is what the ad group
    // has once google_ads_enable_asset_links turns it on.
    expect(out.message).toMatch(/PAUSED/);
    expect(out.enable_path).toMatch(/google_ads_enable_asset_links/);
    expect(out.warnings[0]).toMatch(/once .*enabled/);
  });

  it("confirm links only the ad groups not already linked, PAUSED, and reports what enabling would leave", async () => {
    const d = deps([state(), state({ ad_group_id: "2", ad_group_name: "Other", enabled_asset_ids: ["999", "1", "2", "3"] })]);
    const out: any = await runLinkAssetToAdGroup(
      { customer_id: "9876543210", asset_id: "999", ad_group_ids: ["40", "2"], field_type: "SITELINK", confirm: true },
      d,
    );
    expect(d.link).toHaveBeenCalledTimes(1);
    // The label goes on the ad groups it links: today's Pacific claude-MM-DD-YY.
    expect(d.link.mock.calls[0][0]).toEqual({
      asset_id: "999", ad_group_ids: ["40"], field_type: "SITELINK", audit_label: "claude-10-23-26",
    });
    // A read-back of ENABLED links cannot see a PAUSED link, so there is none.
    expect(d.getState).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
    expect(out.status).toBe("PAUSED");
    expect(out.linked).toBe(1);
    expect(out.skipped_already_linked).toEqual(["2"]);
    const linked = out.ad_groups.find((a: any) => a.ad_group_id === "40");
    expect(linked.link_status).toBe("PAUSED");
    expect(linked.current_enabled_count).toBe(0);
    expect(linked.resulting_enabled_count).toBe(1);
    expect(out.ad_groups.find((a: any) => a.ad_group_id === "2").link_status).toBe("ENABLED");
    // The under-4 warning still fires, for the moment the link is enabled.
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/once .*enabled/);
    expect(out.enable_path).toMatch(/google_ads_enable_asset_links/);
    // Every returned link can be enabled or paused by resource name.
    for (const rn of out.resource_names) {
      const p = parseAssetLinkResourceName(rn);
      expect("error" in p ? p.error : p.level).toBe("ad_group_asset");
    }
    // An ad-group asset link carries no label, so its ad group does.
    expect(isValidClaudeLabel(out.audit_label)).toBe(true);
    expect(out.audit_label).toBe("claude-10-23-26");
    expect(out.audit_label_note).toMatch(/ad group/);
    expect(out.ad_groups.find((a: any) => a.ad_group_id === "2").existing_link_status).toBe("ENABLED");
  });

  it("confirm passes the caller's audit_label to the link, and reports the label the link attached", async () => {
    const d = deps([state({ ad_group_id: "41" })]);
    d.link.mockResolvedValueOnce({ resource_names: [], audit_label: null });
    const out: any = await runLinkAssetToAdGroup(
      { asset_id: "999", ad_group_ids: ["41"], field_type: "SITELINK", audit_label: "claude-10-23-26-brand-sitelinks", confirm: true },
      d,
    );
    expect(d.link.mock.calls[0][0].audit_label).toBe("claude-10-23-26-brand-sitelinks");
    // The attach failed (null): the result says so instead of echoing the name.
    expect(out.audit_label).toBeNull();
  });

  it("confirm skips an ad group whose link already exists PAUSED", async () => {
    const d = deps([state({ ad_group_id: "41", paused_asset_ids: ["999"] }), state({ ad_group_id: "42", ad_group_name: "Other" })]);
    const out: any = await runLinkAssetToAdGroup(
      { asset_id: "999", ad_group_ids: ["41", "42"], field_type: "CALLOUT", confirm: true },
      d,
    );
    expect(d.link.mock.calls[0][0].ad_group_ids).toEqual(["42"]);
    expect(out.skipped_already_linked).toEqual(["41"]);
    expect(out.ad_groups.find((a: any) => a.ad_group_id === "41")).toMatchObject({
      already_linked: true, existing_link_status: "PAUSED", link_status: "PAUSED",
    });
  });

  it("confirm with nothing to link does not call the API", async () => {
    const d = deps([state({ enabled_asset_ids: ["999", "1", "2", "3"] })]);
    const out: any = await runLinkAssetToAdGroup(
      { asset_id: "999", ad_group_ids: ["40"], field_type: "SITELINK", confirm: true },
      d,
    );
    expect(d.link).not.toHaveBeenCalled();
    expect(out.linked).toBe(0);
    // Nothing changed, so nothing was labeled.
    expect(out.audit_label).toBeNull();
  });

  it("confirm refuses when an ad group id was not found", async () => {
    const d = deps([]);
    const out: any = await runLinkAssetToAdGroup(
      { asset_id: "999", ad_group_ids: ["123"], field_type: "SITELINK", confirm: true },
      d,
    );
    expect(d.link).not.toHaveBeenCalled();
    expect(out.error).toMatch(/123/);
  });
});

describe("wiring", () => {
  const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

  it("is declared, write-gated and documents the pause path", () => {
    const tool = tools.find((t) => t.name === TOOL);
    expect(tool).toBeDefined();
    expect(WRITE_TOOLS.has(TOOL)).toBe(true);
    const props = (tool!.inputSchema as any).properties;
    expect(props.field_type.enum).toEqual(["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "LEAD_FORM"]);
    expect(props.explicit_lead_form_request.type).toBe("boolean");
    expect(props.explicit_lead_form_request.description).toMatch(/explicitly asked/i);
    expect(tool!.description).toMatch(/google_ads_pause_asset_links/);
    const pause = tools.find((t) => t.name === "google_ads_pause_asset_links")!;
    expect(pause.description).toMatch(new RegExp(TOOL));
  });

  it("the handler normalizes (lead-form gate) before running, and uses the real manager methods", () => {
    const start = SRC.indexOf(`case "${TOOL}":`);
    expect(start).toBeGreaterThan(-1);
    const next = SRC.indexOf('case "google_ads_', start + 10);
    const block = SRC.slice(start, next);
    const norm = block.indexOf("normalizeLinkAssetToAdGroupArgs(");
    const run = block.indexOf("runLinkAssetToAdGroup(");
    expect(norm).toBeGreaterThan(-1);
    expect(norm).toBeLessThan(run);
    expect(block).toMatch(/getAdGroupAssetState\(/);
    expect(block).toMatch(/linkAssetToAdGroup\(/);
  });
});
