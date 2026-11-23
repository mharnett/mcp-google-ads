// Search-term insight category ids are int64, often 19 digits: past
// Number.MAX_SAFE_INTEGER. google-ads-api's REST parser turns every INT64
// field into a Number, so campaign_search_term_insight.id comes back with its
// low digits rounded (...299648 -> ...300000) and a drill-down on it matches
// nothing. The resource name is a STRING field and carries the exact id:
//   customers/{customer_id}/campaignSearchTermInsights/{campaign_id}~{category_id}

const INSIGHT_RESOURCE = /\/campaignSearchTermInsights\/\d+~(\d+)$/;

/**
 * The exact category id of one campaign_search_term_insight row, as a string.
 * Prefers the resource name; falls back to `id` only when it is a string or a
 * safe integer. Returns null rather than a rounded id.
 */
export function exactInsightId(insight: { resource_name?: unknown; id?: unknown } | null | undefined): string | null {
  const rn = insight?.resource_name;
  if (typeof rn === "string") {
    const m = rn.match(INSIGHT_RESOURCE);
    if (m) return m[1];
  }
  const id = insight?.id;
  if (typeof id === "string" && /^\d+$/.test(id)) return id;
  if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) return String(id);
  return null;
}
