// ============================================
// GAQL INPUT SANITIZATION
// ============================================
//
// Every caller-supplied value that is interpolated into a GAQL string goes
// through one of these. The require* functions refuse bad input outright:
// stripping "1 OR 1=1" to "111" would silently read (or write) a different
// campaign, so on any path that targets one entity a malformed value is an
// error, never a best guess.

/** Strip non-numeric characters from IDs used in GAQL WHERE clauses. */
export function sanitizeNumericId(id: string): string {
  return id.replace(/[^0-9]/g, "");
}

/** Escape single quotes and backslashes in strings used in GAQL WHERE clauses. */
export function escapeGaqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * A Google Ads numeric id (campaign, ad group, ad, asset, experiment),
 * returned as a digits-only string. Accepts a string of 1-20 digits
 * (surrounding whitespace ignored) or a positive safe integer; refuses
 * anything else, naming the field.
 */
export function requireNumericId(value: unknown, field: string): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d{1,20}$/.test(text)) {
    throw new Error(
      `${field} must be a numeric id (digits only), got ${JSON.stringify(value)}. Nothing was read or changed.`,
    );
  }
  return text;
}

/** A GAQL date literal: YYYY-MM-DD, refused otherwise, naming the field. */
export function requireGaqlDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `${field} must be a date in YYYY-MM-DD form, got ${JSON.stringify(value)}. Nothing was read or changed.`,
    );
  }
  return value;
}

/** One of a fixed set of enum names, refused otherwise, listing the allowed values. */
export function requireOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${field} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}. Nothing was read or changed.`,
    );
  }
  return value as T;
}
