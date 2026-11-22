/**
 * google_ads_link_asset_to_campaign reads before it links (2026-11-21).
 *
 * The campaign tool sent one CampaignAsset create per campaign with no read.
 * Since #104 every link lands PAUSED, so re-running a link that already
 * exists PAUSED (the normal state of a staged link) failed the whole atomic
 * create as a duplicate. The ad-group tool already reads ENABLED and PAUSED
 * links first (#105); these tests pin the same contract for campaigns.
 *
 * Pure: the read and the write are injected, so nothing here can reach
 * Google Ads. Every id is made up.
 */
import { describe, it, expect, vi } from "vitest";
import {
  normalizeLinkAssetToCampaignArgs,
  assessCampaignAssetLinks,
  runLinkAssetToCampaign,
  type CampaignAssetState,
} from "./campaignAssetLink.js";

function state(over: Partial<CampaignAssetState> = {}): CampaignAssetState {
  return {
    campaign_id: "31",
    campaign_name: "Example campaign",
    enabled_asset_ids: [],
    paused_asset_ids: [],
    ...over,
  };
}

describe("normalizeLinkAssetToCampaignArgs", () => {
  it("defaults to dry-run and upper-cases the field type", () => {
    const r = normalizeLinkAssetToCampaignArgs({ asset_id: "501", campaign_ids: ["31"], field_type: "sitelink" });
    if ("error" in r) throw new Error(r.error);
    expect(r).toMatchObject({ asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK", confirm: false });
  });

  it("confirm: true applies; duplicate campaign ids are sent once", () => {
    const r = normalizeLinkAssetToCampaignArgs({ asset_id: "501", campaign_ids: ["31", "31", "32"], field_type: "CALLOUT", confirm: true });
    if ("error" in r) throw new Error(r.error);
    expect(r.confirm).toBe(true);
    expect(r.campaign_ids).toEqual(["31", "32"]);
  });

  it("rejects non-numeric ids, empty campaign_ids and unknown field types", () => {
    expect("error" in normalizeLinkAssetToCampaignArgs({ asset_id: "abc", campaign_ids: ["31"], field_type: "SITELINK" })).toBe(true);
    expect("error" in normalizeLinkAssetToCampaignArgs({ asset_id: "501", campaign_ids: [], field_type: "SITELINK" })).toBe(true);
    expect("error" in normalizeLinkAssetToCampaignArgs({ asset_id: "501", campaign_ids: ["31' OR '1'='1"], field_type: "SITELINK" })).toBe(true);
    expect("error" in normalizeLinkAssetToCampaignArgs({ asset_id: "501", campaign_ids: ["31"], field_type: "IMAGE" })).toBe(true);
  });

  it("refuses LEAD_FORM unless explicit_lead_form_request is true", () => {
    for (const v of [undefined, false, "true", 1]) {
      const r = normalizeLinkAssetToCampaignArgs({ asset_id: "507", campaign_ids: ["31"], field_type: "LEAD_FORM", explicit_lead_form_request: v });
      expect("error" in r, String(v)).toBe(true);
      if ("error" in r) expect(r.error).toMatch(/explicit_lead_form_request/);
    }
    const ok = normalizeLinkAssetToCampaignArgs({ asset_id: "507", campaign_ids: ["31"], field_type: "LEAD_FORM", explicit_lead_form_request: true });
    expect("error" in ok).toBe(false);
  });
});

describe("assessCampaignAssetLinks", () => {
  it("an asset linked PAUSED is already linked, with its status", () => {
    const [c] = assessCampaignAssetLinks("501", [state({ paused_asset_ids: ["7", "501"] })]);
    expect(c).toMatchObject({ campaign_id: "31", campaign_name: "Example campaign", already_linked: true, existing_link_status: "PAUSED" });
  });

  it("an asset linked ENABLED is already linked, with its status", () => {
    const [c] = assessCampaignAssetLinks("501", [state({ enabled_asset_ids: ["501"] })]);
    expect(c).toMatchObject({ already_linked: true, existing_link_status: "ENABLED" });
  });

  it("other assets' links do not count", () => {
    const [c] = assessCampaignAssetLinks("501", [state({ enabled_asset_ids: ["7"], paused_asset_ids: ["8"] })]);
    expect(c.already_linked).toBe(false);
    expect(c.existing_link_status).toBeUndefined();
  });

  it("a campaign id the read did not return is reported, not silently dropped", () => {
    const out = assessCampaignAssetLinks("501", [state()], ["31", "33"]);
    expect(out.map((c) => c.campaign_id)).toEqual(["31", "33"]);
    expect(out[1].error).toMatch(/campaign 33 not found/);
  });
});

describe("runLinkAssetToCampaign", () => {
  function deps(before: CampaignAssetState[]) {
    const getState = vi.fn().mockResolvedValue(before);
    const link = vi.fn().mockImplementation(async (a: { campaign_ids: string[] }) => ({
      asset_resource_name: "customers/1234567890/assets/501",
      resource_names: a.campaign_ids.map((id) => `customers/1234567890/campaignAssets/${id}~501~SITELINK`),
      audit_label: "claude-11-21-26",
    }));
    return { getState, link };
  }

  it("dry run reads, names each campaign, counts only the links it would create, never links", async () => {
    const d = deps([state(), state({ campaign_id: "32", campaign_name: "Second campaign", paused_asset_ids: ["501"] })]);
    const out: any = await runLinkAssetToCampaign(
      { customer_id: "1234567890", asset_id: "501", campaign_ids: ["31", "32"], field_type: "SITELINK", confirm: false },
      d,
    );
    expect(d.getState).toHaveBeenCalledWith(["31", "32"], "SITELINK");
    expect(d.link).not.toHaveBeenCalled();
    expect(out.dry_run).toBe(true);
    expect(out.campaigns_to_link).toBe(1);
    expect(out.campaigns.map((c: any) => c.campaign_name)).toEqual(["Example campaign", "Second campaign"]);
    expect(out.campaigns[1]).toMatchObject({ already_linked: true, existing_link_status: "PAUSED" });
    expect(out.message).toMatch(/PAUSED/);
    expect(out.enable_path).toMatch(/google_ads_enable_asset_links/);
  });

  it("confirm links only the campaigns not already linked, and reports each link's status", async () => {
    const d = deps([
      state(),
      state({ campaign_id: "32", paused_asset_ids: ["501"] }),
      state({ campaign_id: "33", enabled_asset_ids: ["501"] }),
    ]);
    const out: any = await runLinkAssetToCampaign(
      { customer_id: "1234567890", asset_id: "501", campaign_ids: ["31", "32", "33"], field_type: "SITELINK", confirm: true },
      d,
    );
    expect(d.link).toHaveBeenCalledTimes(1);
    expect(d.link.mock.calls[0][0]).toEqual({ asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK" });
    expect(out).toMatchObject({
      success: true,
      status: "PAUSED",
      linked: 1,
      campaigns_linked: 1,
      skipped_already_linked: ["32", "33"],
      resource_names: ["customers/1234567890/campaignAssets/31~501~SITELINK"],
      audit_label: "claude-11-21-26",
    });
    expect(out.audit_label_note).toMatch(/campaign or ad group/);
    expect(out.campaigns.map((c: any) => [c.campaign_id, c.link_status])).toEqual([
      ["31", "PAUSED"],
      ["32", "PAUSED"],
      ["33", "ENABLED"],
    ]);
  });

  it("confirm with every campaign already linked makes no write and labels nothing", async () => {
    const d = deps([state({ paused_asset_ids: ["501"] })]);
    const out: any = await runLinkAssetToCampaign(
      { asset_id: "501", campaign_ids: ["31"], field_type: "SITELINK", confirm: true },
      d,
    );
    expect(d.link).not.toHaveBeenCalled();
    expect(out.success).toBe(true);
    expect(out.linked).toBe(0);
    expect(out.resource_names).toEqual([]);
    expect(out.audit_label).toBeNull();
  });

  it("confirm refuses, before any write, when a campaign was not found", async () => {
    const d = deps([state()]);
    const out: any = await runLinkAssetToCampaign(
      { asset_id: "501", campaign_ids: ["31", "33"], field_type: "SITELINK", confirm: true },
      d,
    );
    expect(d.link).not.toHaveBeenCalled();
    expect(out.error).toMatch(/campaign 33 not found/);
  });
});
