import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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
  "google_ads_create_image_asset",
  "google_ads_enable_items",
  "google_ads_pause_items",
  "google_ads_pause_keywords",
  "google_ads_enable_keywords",
  "google_ads_pause_asset_links",
  "google_ads_remove_items",
  "google_ads_remove_shared_negatives",
  "google_ads_remove_campaign_negatives",
  "google_ads_remove_adgroup_negatives",
  "google_ads_add_shared_negatives",
  "google_ads_add_campaign_negatives",
  "google_ads_link_shared_set",
  "google_ads_unlink_shared_set",
  "google_ads_apply_label",
  "google_ads_update_campaign_tracking",
  "google_ads_update_campaign_budget",
  "google_ads_update_campaign_bidding",
  "google_ads_update_asset_urls",
  "google_ads_create_sitelink",
  "google_ads_replace_sitelink_url",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.GOOGLE_ADS_MCP_WRITE || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function filterTools(
  allTools: readonly Tool[],
  env: NodeJS.ProcessEnv = process.env,
): Tool[] {
  if (isWriteEnabled(env)) return [...allTools];
  return allTools.filter((t) => !WRITE_TOOLS.has(t.name));
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
  if (!isWriteTool(toolName)) return;
  if (isWriteEnabled(env)) return;
  throw new Error(
    `Tool "${toolName}" is a write operation. ${WRITE_DISABLED_MESSAGE}`,
  );
}
