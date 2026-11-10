// Pure builder for campaign network_settings mutate payloads.
//
// Only the leaves the caller names are emitted. The field mask is derived from
// the resource keys, so sending the whole network_settings message would also
// write target_google_search and wipe it. Keep this to the two leaves.
export interface NetworkSettingsInput {
  /** network_settings.target_search_network (search partners) */
  search_partners?: boolean;
  /** network_settings.target_content_network (Display Network) */
  display_network?: boolean;
}

export function buildNetworkSettingsCampaignUpdate(
  resourceName: string,
  input: NetworkSettingsInput
): Record<string, any> {
  const { search_partners, display_network } = input;
  for (const [k, v] of Object.entries({ search_partners, display_network })) {
    if (v !== undefined && typeof v !== "boolean") {
      throw new Error(`${k} must be a boolean, got ${typeof v}`);
    }
  }
  if (search_partners === undefined && display_network === undefined) {
    throw new Error("At least one of search_partners or display_network is required.");
  }
  const network_settings: Record<string, boolean> = {};
  if (search_partners !== undefined) network_settings.target_search_network = search_partners;
  if (display_network !== undefined) network_settings.target_content_network = display_network;
  return { resource_name: resourceName, network_settings };
}

export function buildNetworkSettingsCampaignUpdates(
  resourceNames: string[],
  input: NetworkSettingsInput
): Record<string, any>[] {
  return resourceNames.map((rn) => buildNetworkSettingsCampaignUpdate(rn, input));
}
