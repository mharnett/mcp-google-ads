/**
 * Canonical Claude audit-label format for Google Ads entities.
 *
 * GLOBAL rule: every Claude-created/edited campaign, ad group, ad group ad, or
 * ad group criterion is stamped with an audit label so a batch can be found and
 * rolled back. (Only those four resource types have a label surface — budgets,
 * bidding, tracking edits, shared-set negatives and assets do NOT, so a
 * "label every mutation" invariant is unbuildable; this module governs only the
 * label STRING.)
 *
 * Format (locked 2026-07-23): `claude-MM-DD-YY` optionally followed by a
 * kebab-case description — `claude-MM-DD-YY-<desc>`:
 *   - `claude-` prefix keeps the `label.name LIKE 'claude-%'` rollback filter,
 *   - the 2-digit date isolates a day's batch,
 *   - the description (recommended) says what the change was.
 *
 * Single source of truth: the generator, the validator, and the recognizer
 * (used to avoid double-adding the auto label) all agree here, so the format
 * can't drift between the apply path and the rollback queries.
 */

// month 01-12, day 01-31 (a light range check — not a full calendar), 2-digit
// year, optional kebab description with no leading/trailing/repeated hyphens.
const DATE = "(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])-\\d{2}";
const DESC = "(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?";

const VALID_LABEL_RE = new RegExp(`^claude-${DATE}${DESC}$`);

/** True iff `label` matches the canonical `claude-MM-DD-YY[-desc]` format. */
export function isValidClaudeLabel(label: string): boolean {
  return VALID_LABEL_RE.test(label);
}

/**
 * Recognizer for the auto-applied label (any date, any/no description). Used to
 * strip it from a caller's extra labels so it isn't added twice. Deliberately
 * looser than the validator on the description (matches any suffix) so it still
 * recognizes a label even if an older/newer descriptor convention was used.
 */
export const AUTO_CLAUDE_LABEL_RE = new RegExp(`^claude-${DATE}(?:-.+)?$`, "i");

// Max Google Ads label name length is 80 chars. We bound the DESCRIPTOR (never
// the date/prefix) and only ever cut on a hyphen boundary — no mid-token slice
// (the very antipattern the ad-copy no-truncation rule forbids).
const MAX_LABEL_LEN = 80;

function slugify(descriptor: string): string {
  const slug = descriptor
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-kebab chars -> single hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
  return slug;
}

function boundDescriptor(slug: string, budget: number): string {
  if (slug.length <= budget) return slug;
  // Cut at the last hyphen within budget so we never split a word.
  const clipped = slug.slice(0, budget);
  const lastHyphen = clipped.lastIndexOf("-");
  const kept = lastHyphen > 0 ? clipped.slice(0, lastHyphen) : clipped;
  return kept.replace(/-+$/g, "");
}

/**
 * Build the canonical audit label for `date`, optionally with a `descriptor`.
 * The descriptor is slugged to kebab-case and dropped if it slugs to empty.
 * The output is always a string `isValidClaudeLabel` accepts.
 */
export function claudeAuditLabel(date: Date, descriptor?: string): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  const base = `claude-${mm}-${dd}-${yy}`;

  if (!descriptor) return base;
  let slug = slugify(descriptor);
  if (!slug) return base;

  const budget = MAX_LABEL_LEN - base.length - 1; // -1 for the joining hyphen
  slug = boundDescriptor(slug, budget);
  return slug ? `${base}-${slug}` : base;
}
