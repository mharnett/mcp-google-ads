// Pure builder for campaign geo_target_type_setting.positive_geo_target_type
// mutate payloads.
//
// Only PRESENCE and PRESENCE_OR_INTEREST are supported. SEARCH_INTEREST is a
// valid API enum value but is deliberately excluded here — it only applies
// to Search campaigns targeting via search terms and isn't part of this
// tool's scope, so an unmapped value fails loudly rather than being silently
// accepted.
export const POSITIVE_GEO_TARGET_TYPE: Record<string, number> = {
  PRESENCE: 7,
  PRESENCE_OR_INTEREST: 5,
};

export function buildGeoTargetTypeCampaignUpdate(
  resourceName: string,
  mode: string
): Record<string, any> {
  const typeEnum = POSITIVE_GEO_TARGET_TYPE[mode];
  if (typeEnum === undefined) {
    throw new Error(
      `Unsupported positive geo target type: ${mode}. Expected one of ${Object.keys(POSITIVE_GEO_TARGET_TYPE).join(", ")}`
    );
  }

  return {
    resource_name: resourceName,
    geo_target_type_setting: {
      positive_geo_target_type: typeEnum,
    },
  };
}

export function buildGeoTargetTypeCampaignUpdates(
  resourceNames: string[],
  mode: string
): Record<string, any>[] {
  return resourceNames.map((rn) => buildGeoTargetTypeCampaignUpdate(rn, mode));
}
