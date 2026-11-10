import { describe, it, expect } from "vitest";
import {
  buildNetworkSettingsCampaignUpdate,
  buildNetworkSettingsCampaignUpdates,
} from "./networkSettingsUpdate.js";

const RN = "customers/9876543210/campaigns/24272168149";
const RN2 = "customers/9876543210/campaigns/24272168150";

describe("buildNetworkSettingsCampaignUpdate", () => {
  it("search_partners only sets just target_search_network", () => {
    const u = buildNetworkSettingsCampaignUpdate(RN, { search_partners: false });
    expect(u).toEqual({ resource_name: RN, network_settings: { target_search_network: false } });
  });

  it("display_network only sets just target_content_network", () => {
    const u = buildNetworkSettingsCampaignUpdate(RN, { display_network: false });
    expect(u).toEqual({ resource_name: RN, network_settings: { target_content_network: false } });
  });

  it("both given sets exactly the two leaves and never target_google_search", () => {
    const u = buildNetworkSettingsCampaignUpdate(RN, { search_partners: false, display_network: true });
    expect(Object.keys(u.network_settings).sort()).toEqual(["target_content_network", "target_search_network"]);
    expect(u.network_settings.target_content_network).toBe(true);
    expect(u.network_settings).not.toHaveProperty("target_google_search");
    expect(u.network_settings).not.toHaveProperty("target_partner_search_network");
  });

  it("throws when neither flag is given", () => {
    expect(() => buildNetworkSettingsCampaignUpdate(RN, {})).toThrow(/at least one/i);
  });

  it("throws on a non-boolean flag", () => {
    expect(() => buildNetworkSettingsCampaignUpdate(RN, { search_partners: "false" as any })).toThrow(/boolean/i);
  });

  it("maps over many campaigns", () => {
    const us = buildNetworkSettingsCampaignUpdates([RN, RN2], { display_network: false });
    expect(us.map((u) => u.resource_name)).toEqual([RN, RN2]);
  });
});
