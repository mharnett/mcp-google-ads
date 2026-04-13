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

// Customizer tokens like {CUSTOMIZER.foo} render much shorter than their
// literal text in descriptions. Conservative estimate used for length check.
const CUSTOMIZER_PATTERN = /\{CUSTOMIZER\.[^}]+\}/g;
const CUSTOMIZER_RENDER_LEN = 16;

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
    if (h.length > MAX_HEADLINE_LENGTH) {
      errors.push(`Headline ${i + 1} too long (${h.length}/${MAX_HEADLINE_LENGTH}): "${h}"`);
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
    const effectiveLen = effectiveDescriptionLength(d);
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

  // ── Path 1 (NEW: required, ≤15 chars) ──
  if (!isNonEmpty(ad.path1)) {
    errors.push("path1 is required (display URL path segment)");
  } else if (ad.path1!.length > MAX_PATH_LENGTH) {
    errors.push(`path1 too long (${ad.path1!.length}/${MAX_PATH_LENGTH}): "${ad.path1}"`);
  }

  // ── Path 2 (NEW: required, ≤15 chars) ──
  if (!isNonEmpty(ad.path2)) {
    errors.push("path2 is required (display URL path segment)");
  } else if (ad.path2!.length > MAX_PATH_LENGTH) {
    errors.push(`path2 too long (${ad.path2!.length}/${MAX_PATH_LENGTH}): "${ad.path2}"`);
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

function effectiveDescriptionLength(desc: string): number {
  let effectiveLen = desc.length;
  const matches = desc.match(CUSTOMIZER_PATTERN);
  if (matches) {
    for (const m of matches) {
      effectiveLen -= m.length;
      effectiveLen += CUSTOMIZER_RENDER_LEN;
    }
  }
  return effectiveLen;
}
