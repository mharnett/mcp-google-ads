/**
 * Pure RSA validation logic. Called from both:
 *   - GoogleAdsManager.validateAd() (google_ads_validate_ad tool)
 *   - GoogleAdsManager.createResponsiveSearchAd() (pre-creation check)
 *
 * Kept as a standalone module so unit tests don't have to instantiate the
 * full manager / mock customer. All rules are synchronous and data-only.
 */

export interface RsaInput {
  headlines: string[];
  descriptions: string[];
  final_urls: string[];
  /** Path 1 shown in display URL. Required. Max 15 chars. */
  path1?: string;
  /** Path 2 shown in display URL. Required. Max 15 chars. */
  path2?: string;
  /** At least 1 label (string) required. Empty/whitespace entries don't count. */
  labels?: string[];
  /**
   * When false, path1/path2 are treated as genuinely optional (length limits
   * still apply to whichever is provided). Defaults to true -- the "always
   * required" rule is house hygiene policy for callers AUTHORING a new ad
   * (google_ads_create_responsive_search_ad), not a real Google Ads API
   * constraint (the API only requires path2 ⇒ path1, not both). Cloning
   * tools that reproduce a pre-existing ad's exact content (e.g.
   * updateAdFinalUrls' clone-and-swap) must pass false so an ad that never
   * had a display path isn't blocked from being faithfully replicated.
   */
  requirePathSegments?: boolean;
}

export interface RsaValidationResult {
  valid: boolean;
  errors: string[];
}

// Google Ads constraints (as of API v23)
const MIN_HEADLINES = 3;
const MAX_HEADLINES = 15;
const MAX_HEADLINE_LENGTH = 30;
const MIN_DESCRIPTIONS = 2;
const MAX_DESCRIPTIONS = 4;
const MAX_DESCRIPTION_LENGTH = 90;
const MAX_PATH_LENGTH = 15;

// Dynamic insertions in ad text render shorter than their literal form.
// Google Ads validates against the rendered length (default text for keyword
// insertions and customizers-with-default; a conservative estimate for bare
// customizer tokens). Applies to headlines, descriptions, and display paths.
const KEYWORD_INSERT_PATTERN = /\{(?:KeyWord|Keyword|keyword|KEYWORD):([^}]*)\}/g;
const CUSTOMIZER_WITH_DEFAULT = /\{CUSTOMIZER\.[^:}]+:([^}]*)\}/g;
const CUSTOMIZER_NO_DEFAULT = /\{CUSTOMIZER\.[^:}]+\}/g;
const CUSTOMIZER_RENDER_LEN = 16;
// Location insertion, e.g. {LOCATION(City):See Your Data} or {LOCATION(City, State):...}.
// Google counts the default (fallback) text, identical to customizers. A bare
// {LOCATION(City)} with no default renders as a real place name, so estimate
// conservatively (city/state strings run longer than the 16-char customizer guess).
const LOCATION_WITH_DEFAULT = /\{LOCATION\s*\([^(){}]*\)\s*:([^}]*)\}/gi;
const LOCATION_NO_DEFAULT = /\{LOCATION\s*\([^(){}]*\)\}/gi;
const LOCATION_RENDER_LEN = 20;

// Some insertions render to text whose length we can't reliably predict from
// the literal form: countdown timers ({COUNTDOWN(...)} / {GLOBAL_COUNTDOWN(...)})
// render to "3 days"-style strings, and IF functions ({=IF(cond, text):default})
// pick the longer of two branches. Rather than guess a reserve length and risk a
// false reject (or worse, a false accept), we skip the length check entirely for
// any field containing one of these — Google's API remains the source of truth at
// create time. Detection is presence-only; we don't try to parse their arguments.
const COUNTDOWN_PATTERN = /\{\s*(?:GLOBAL_)?COUNTDOWN\s*\(/i;
const IF_FUNCTION_PATTERN = /\{\s*=/;

export function validateRsa(ad: RsaInput): RsaValidationResult {
  const errors: string[] = [];

  // ── Headlines ──
  if (!ad.headlines || ad.headlines.length < MIN_HEADLINES) {
    errors.push(`Need at least ${MIN_HEADLINES} headlines, got ${ad.headlines?.length ?? 0}`);
  }
  if (ad.headlines && ad.headlines.length > MAX_HEADLINES) {
    errors.push(`Maximum ${MAX_HEADLINES} headlines, got ${ad.headlines.length}`);
  }
  (ad.headlines ?? []).forEach((h, i) => {
    if (hasUncountableToken(h)) return;
    const effectiveLen = effectiveTextLength(h);
    if (effectiveLen > MAX_HEADLINE_LENGTH) {
      errors.push(`Headline ${i + 1} too long (${effectiveLen}/${MAX_HEADLINE_LENGTH}): "${h}"`);
    }
  });

  // ── Descriptions ──
  if (!ad.descriptions || ad.descriptions.length < MIN_DESCRIPTIONS) {
    errors.push(
      `Need at least ${MIN_DESCRIPTIONS} descriptions, got ${ad.descriptions?.length ?? 0}`
    );
  }
  if (ad.descriptions && ad.descriptions.length > MAX_DESCRIPTIONS) {
    errors.push(`Maximum ${MAX_DESCRIPTIONS} descriptions, got ${ad.descriptions.length}`);
  }
  (ad.descriptions ?? []).forEach((d, i) => {
    if (hasUncountableToken(d)) return;
    const effectiveLen = effectiveTextLength(d);
    if (effectiveLen > MAX_DESCRIPTION_LENGTH) {
      errors.push(
        `Description ${i + 1} too long (${effectiveLen}/${MAX_DESCRIPTION_LENGTH}): "${d}"`
      );
    }
  });

  // ── Final URLs ──
  if (!ad.final_urls || ad.final_urls.length === 0) {
    errors.push("At least one final URL is required");
  }

  // ── Path 1 (required by default, ≤15 chars; see requirePathSegments) ──
  const requirePaths = ad.requirePathSegments !== false;
  if (!isNonEmpty(ad.path1)) {
    if (requirePaths) errors.push("path1 is required (display URL path segment)");
  } else {
    const effectiveLen = effectiveTextLength(ad.path1!);
    if (!hasUncountableToken(ad.path1!) && effectiveLen > MAX_PATH_LENGTH) {
      errors.push(`path1 too long (${effectiveLen}/${MAX_PATH_LENGTH}): "${ad.path1}"`);
    }
  }

  // ── Path 2 (required by default, ≤15 chars; see requirePathSegments) ──
  if (!isNonEmpty(ad.path2)) {
    if (requirePaths) errors.push("path2 is required (display URL path segment)");
  } else {
    const effectiveLen = effectiveTextLength(ad.path2!);
    if (!hasUncountableToken(ad.path2!) && effectiveLen > MAX_PATH_LENGTH) {
      errors.push(`path2 too long (${effectiveLen}/${MAX_PATH_LENGTH}): "${ad.path2}"`);
    }
  }

  // ── Labels (NEW: at least 1 required) ──
  const nonEmptyLabels = (ad.labels ?? []).filter((l) => isNonEmpty(l));
  if (nonEmptyLabels.length === 0) {
    errors.push("At least 1 label is required (e.g. 'claude-YYYY-MM-DD' for versioning)");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function isNonEmpty(s: string | undefined | null): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * True if the text contains an insertion whose rendered length can't be reliably
 * predicted from the literal form — countdown timers or IF functions. Callers
 * skip the character-length check for such fields and defer to the Google Ads API.
 */
export function hasUncountableToken(text: string): boolean {
  return COUNTDOWN_PATTERN.test(text) || IF_FUNCTION_PATTERN.test(text);
}

/**
 * Compute the length Google Ads will actually validate against, after
 * substituting dynamic insertions:
 *   - {KeyWord:default} / {Keyword:default} / {keyword:default} / {KEYWORD:default}
 *     → rendered as the default text
 *   - {CUSTOMIZER.Name:default} → rendered as the default text
 *   - {CUSTOMIZER.Name}        → rendered as a conservative estimate
 *   - {LOCATION(City):default} → rendered as the default text
 *   - {LOCATION(City)}         → rendered as a conservative estimate
 *
 * Applies to headlines, descriptions, and display paths alike.
 */
export function effectiveTextLength(text: string): number {
  let rendered = text.replace(KEYWORD_INSERT_PATTERN, "$1");
  rendered = rendered.replace(CUSTOMIZER_WITH_DEFAULT, "$1");
  rendered = rendered.replace(CUSTOMIZER_NO_DEFAULT, " ".repeat(CUSTOMIZER_RENDER_LEN));
  rendered = rendered.replace(LOCATION_WITH_DEFAULT, "$1");
  rendered = rendered.replace(LOCATION_NO_DEFAULT, " ".repeat(LOCATION_RENDER_LEN));
  return rendered.length;
}
