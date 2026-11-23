/**
 * Logo name check for the Demand Gen multi-asset ad create.
 *
 * A common mistake is a photo of a person ("ManHoldingPhone") picked as one of
 * an ad's logos. The tool input carries logo asset ids only, so a PreToolUse
 * hook can't see the names; the create reads them here, before it creates
 * anything, and refuses a logo whose name reads as a photo of a person.
 *
 * The word list and the whole-word split match the client-side Demand Gen
 * quality linter this check stands in for (PORTRAIT_TERMS and name_words() in
 * google_ads_dg_quality_linter.py), so the two agree on what is flagged. The
 * caller can skip the check with allow_person_photo_logos=true.
 */

import { requireNumericId } from "./gaqlSanitize.js";

/** Words in an asset name that mark a photo of a person, not a brand mark. */
export const PERSON_PHOTO_TERMS: ReadonlySet<string> = new Set([
  "man",
  "woman",
  "person",
  "holding",
  "phone",
  "portrait",
]);

// camelCase humps, ALLCAPS runs and digit runs, so "ManHoldingPhone" and
// "man-holding-phone" both split into words.
const NAME_WORD_RE = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g;

/**
 * Lower-cased words of an asset name. Whole words, never substrings:
 * "demand-gen-logo" holds "man" only inside "demand", and is not flagged.
 */
export function assetNameWords(name: string | null | undefined): Set<string> {
  return new Set((String(name ?? "").match(NAME_WORD_RE) ?? []).map((w) => w.toLowerCase()));
}

/**
 * GAQL that reads the name of each logo asset id. Every id must be digits only
 * (requireNumericId), so nothing else can reach the WHERE clause.
 */
export function logoAssetNamesQuery(ids: readonly string[]): string {
  const clean = ids.map((id, i) => requireNumericId(id, `logo_image_asset_ids[${i}]`));
  return "SELECT asset.id, asset.name, asset.type FROM asset WHERE asset.id IN (" + clean.join(", ") + ")";
}

/** The tail every refusal ends with. */
const SKIP_HINT =
  "Nothing was created. Pick brand-mark logo assets, or pass allow_person_photo_logos=true " +
  "if these logos are right.";

/**
 * Decide from the asset rows whether the create goes ahead. Returns the refusal,
 * or null when every requested logo was found and none is named like a photo
 * of a person. A logo id with no row is refused: its name could not be checked
 * (and Google would reject the create for it anyway).
 */
export function logoNameRefusal(
  requestedIds: readonly string[],
  rows: ReadonlyArray<{ asset?: { id?: number | string | null; name?: string | null } }>,
): string | null {
  const nameById = new Map<string, string>();
  for (const row of rows) {
    const id = row.asset?.id;
    if (id !== undefined && id !== null) nameById.set(String(id), String(row.asset?.name ?? ""));
  }

  const ids = requestedIds.map((id) => String(id).trim());
  const missing = ids.filter((id) => !nameById.has(id));
  if (missing.length) {
    const list = missing.join(", ");
    return (
      `Demand Gen ad not created: logo asset id${missing.length > 1 ? "s" : ""} ${list} ` +
      `${missing.length > 1 ? "were" : "was"} not found in this account, so ` +
      `${missing.length > 1 ? "their names" : "its name"} could not be checked. ${SKIP_HINT}`
    );
  }

  const flagged = ids.flatMap((id) => {
    const name = nameById.get(id) ?? "";
    const hits = [...assetNameWords(name)].filter((w) => PERSON_PHOTO_TERMS.has(w)).sort();
    return hits.length ? [`'${name}' (id ${id}): ${hits.join(", ")}`] : [];
  });
  if (!flagged.length) return null;
  return (
    `Demand Gen ad not created: ${flagged.length === 1 ? "a logo is" : `${flagged.length} logos are`} ` +
    `named like a photo of a person, not a brand mark: ${flagged.join("; ")}. ${SKIP_HINT}`
  );
}
