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

// The Ad resource itself (as opposed to the adGroupAd link) is
// `customers/{cid}/ads/{adId}` -- no adGroupId component. An Ad can be
// linked into MORE THAN ONE ad_group_ad (confirmed live on the Neon CRM
// account), so this resource name is what AdService.MutateAds needs to
// edit the ad's content in place; it is NOT the same resource as
// buildAdGroupAdResourceName above.
export function buildAdResourceName(
  cleanCustomerId: string,
  adId: string | number
): string {
  return `customers/${cleanCustomerId}/ads/${adId}`;
}
