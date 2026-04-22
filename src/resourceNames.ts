// Resource name builders for Google Ads API.
//
// The adGroupAd resource is identified by the COMPOSITE
// `customers/{cid}/adGroupAds/{adGroupId}~{adId}`. Using just `{adId}`
// (a past bug) produces "part of the resource name is invalid" API errors
// on label attach, update, and remove — any operation touching the
// adGroupAd resource.
export function buildAdGroupAdResourceName(
  cleanCustomerId: string,
  adGroupId: string | number,
  adId: string | number
): string {
  return `customers/${cleanCustomerId}/adGroupAds/${adGroupId}~${adId}`;
}
