import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createWriteGate } from "mcp-write-gate";

/**
 * Tools that mutate Google Ads state. These are hidden from the tool list
 * and refused at call time unless GOOGLE_ADS_MCP_WRITE=true.
 *
 * Adding a new tool? Put it in this set if it creates, modifies, pauses,
 * enables, removes, links, unlinks, or applies anything.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "google_ads_create_campaign",
  "google_ads_create_ad_group",
  "google_ads_create_responsive_search_ad",
  "google_ads_create_keywords",
  "google_ads_create_shared_set",
  "google_ads_create_demand_gen_multi_asset_ad",
  "google_ads_update_demand_gen_multi_asset_ad",
  "google_ads_create_image_asset",
  "google_ads_create_lead_form_asset",
  "google_ads_enable_items",
  "google_ads_pause_items",
  "google_ads_pause_keywords",
  "google_ads_enable_keywords",
  "google_ads_pause_asset_links",
  "google_ads_remove_items",
  "google_ads_remove_shared_negatives",
  "google_ads_remove_campaign_negatives",
  "google_ads_remove_adgroup_negatives",
  "google_ads_add_adgroup_negatives",
  "google_ads_add_shared_negatives",
  "google_ads_add_campaign_negatives",
  "google_ads_link_shared_set",
  "google_ads_unlink_shared_set",
  "google_ads_apply_label",
  "google_ads_update_campaign_tracking",
  "google_ads_update_campaign_budget",
  "google_ads_update_campaign_bidding",
  "google_ads_update_ad_asset_automation",
  "google_ads_update_asset_urls",
  "google_ads_create_sitelink",
  "google_ads_replace_sitelink_url",
  "google_ads_create_page_feed",
  "google_ads_create_experiment",
  "google_ads_schedule_experiment",
  "google_ads_end_experiment",
  "google_ads_promote_experiment",
  "google_ads_remove_experiment",
  "google_ads_update_campaign_ad_urls",
  "google_ads_update_ad_final_urls",
  "google_ads_rename_ad_group",
  "google_ads_rename_campaign",
  "google_ads_link_asset_to_campaign",
  "google_ads_set_ad_group_location_targeting",
  "google_ads_set_campaign_location_targeting",
  "google_ads_attach_user_list_audience",
  "google_ads_create_and_attach_audience_bundle",
]);

const gate = createWriteGate({
  writeTools: WRITE_TOOLS,
  envPrefix: "GOOGLE_ADS",
});

export function isWriteTool(name: string): boolean {
  return gate.isWriteTool(name);
}

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return gate.isWriteEnabled(env);
}

export function filterTools(
  allTools: readonly Tool[],
  env: NodeJS.ProcessEnv = process.env,
): Tool[] {
  return gate.filterTools(allTools, env);
}

export const WRITE_DISABLED_MESSAGE =
  "Write operations are disabled. Set GOOGLE_ADS_MCP_WRITE=true in the MCP server environment to enable mutating tools (create/update/pause/enable/remove/apply).";

/**
 * Assert that a tool call is allowed under the current write-mode setting.
 * Throws a clear Error if the tool mutates state and writes are disabled.
 */
export function assertWriteAllowed(
  toolName: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    gate.assertWriteAllowed(toolName, env);
  } catch (e) {
    throw new Error(
      `Tool "${toolName}" is a write operation. ${WRITE_DISABLED_MESSAGE}`,
    );
  }
}
