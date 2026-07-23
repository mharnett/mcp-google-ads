/**
 * Query-time guard for the campaign_shared_set REMOVED-link trap.
 *
 * GAQL's `campaign_shared_set` resource returns links in every status, including
 * REMOVED. A query that lists a shared list's campaigns WITHOUT filtering
 * `campaign_shared_set.status = 'ENABLED'` therefore shows campaigns the list was
 * UNLINKED from as if it were still attached.
 *
 * Origin: 2026-07-23 — a verify agent read `FROM campaign_shared_set` without the
 * status filter, saw a REMOVED "Compliance Negatives" link, and reported a
 * completed shared-set swap as "incomplete" (nearly triggering 5 needless unlinks).
 * Memory alone can't help a subagent; this warning rides in the tool result every
 * caller sees. Scoped tightly to campaign_shared_set to avoid warning-fatigue.
 *
 * Returns a warning string when the trap is possible, else null. Never blocks —
 * some queries legitimately want removed rows.
 */
export function sharedSetLinkWarning(query: string): string | null {
  const q = (query || "").toLowerCase();

  // Only fires for a query that actually reads the link resource.
  if (!/\bfrom\s+campaign_shared_set\b/.test(q)) return null;

  // Any ENABLED / not-REMOVED constraint on the link status clears the warning.
  const filtersStatus =
    /\bstatus\s*=\s*'enabled'/.test(q) ||
    /\bstatus\s*!=\s*'removed'/.test(q) ||
    /\bstatus\s+in\s*\([^)]*'enabled'/.test(q);
  if (filtersStatus) return null;

  return (
    "⚠ campaign_shared_set returns REMOVED links too — this query has no " +
    "ENABLED-status filter, so lists that were UNLINKED still appear as if " +
    "attached (this caused a false 'swap incomplete' verdict on 2026-07-23). " +
    "If you're checking whether a shared set is CURRENTLY attached, add: " +
    "AND campaign_shared_set.status = 'ENABLED'."
  );
}
