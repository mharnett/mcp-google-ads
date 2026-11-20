// Pure helpers for campaign end-date updates.
//
// Google Ads API v24 field: Campaign.end_date_time, "yyyy-MM-dd HH:mm:ss" in
// the customer's time zone; a whole day ends at 23:59:59 (same convention as
// campaignBuilder's create path). Older campaigns can carry the pre-v24 "run
// indefinitely" sentinel 2037-12-30, which reads as no end date.
//
// Clearing an end date is out of scope: the API clears it by sending the field
// in update_mask with no value, and the client library drops unset fields from
// the mask. Extend a campaign by setting a later date instead.

const NO_END_SENTINEL = "2037-12-30";

function requireCalendarDate(value: string): string {
  const m = (value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return value;
    }
  }
  throw new Error(`end_date must be a real calendar date in YYYY-MM-DD form, got "${value}"`);
}

export function buildCampaignEndDateUpdates(
  resourceNames: string[],
  endDate: string
): { resource_name: string; end_date_time: string }[] {
  const endDateTime = `${requireCalendarDate(endDate)} 23:59:59`;
  return resourceNames.map((rn) => ({ resource_name: rn, end_date_time: endDateTime }));
}

// "NONE" when the campaign runs indefinitely, else its last day (YYYY-MM-DD).
export function normalizeEndDate(raw: string | null | undefined): string {
  const day = (raw ?? "").trim().slice(0, 10);
  if (!day || day === NO_END_SENTINEL) return "NONE";
  return day;
}
