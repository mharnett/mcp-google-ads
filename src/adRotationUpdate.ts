// Pure builder for campaign ad-rotation (ad_serving_optimization_status) mutate payloads.
//
// ROTATE self-reverts to OPTIMIZE after 90 days (Google-managed timeout, confirmed
// live in this account: a 2026-03-03 test on this same campaign was back to
// OPTIMIZE by 2026-07-29 with no manual revert). ROTATE_INDEFINITELY does not
// revert on its own — a campaign left there stays there until someone changes it
// back, which is why the tool requires an explicit mode with no default.

export const AD_SERVING_OPTIMIZATION_STATUS: Record<string, number> = {
  OPTIMIZE: 2,
  CONVERSION_OPTIMIZE: 3,
  ROTATE: 4,
  ROTATE_INDEFINITELY: 5,
};

export const AD_SERVING_OPTIMIZATION_STATUS_ENUM_TO_NAME: Record<number, string> = {
  2: "OPTIMIZE",
  3: "CONVERSION_OPTIMIZE",
  4: "ROTATE",
  5: "ROTATE_INDEFINITELY",
};

export function buildAdRotationCampaignUpdate(
  resourceName: string,
  mode: string
): Record<string, any> {
  const statusEnum = AD_SERVING_OPTIMIZATION_STATUS[mode];
  if (statusEnum === undefined) {
    throw new Error(
      `Unsupported ad rotation mode: ${mode}. Expected one of ${Object.keys(AD_SERVING_OPTIMIZATION_STATUS).join(", ")}`
    );
  }

  return {
    resource_name: resourceName,
    ad_serving_optimization_status: statusEnum,
  };
}
