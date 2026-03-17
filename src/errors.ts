// ============================================
// TYPED ERRORS (mirrors motion-mcp pattern)
// ============================================

export class GoogleAdsAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GoogleAdsAuthError";
  }
}

export class GoogleAdsRateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    cause?: unknown,
  ) {
    super(`Rate limited, retry after ${retryAfterMs}ms`);
    this.name = "GoogleAdsRateLimitError";
    this.cause = cause;
  }
}

export class GoogleAdsServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GoogleAdsServiceError";
  }
}

// ============================================
// STARTUP CREDENTIAL VALIDATION
// ============================================

export function validateCredentials(): { valid: boolean; missing: string[] } {
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ];
  const missing = required.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === "",
  );
  return { valid: missing.length === 0, missing };
}

/**
 * Extract a human-readable message from a Google Ads API / gRPC error.
 * The google-ads-api library throws objects where the real message lives
 * in `error.errors[0].message`, not on the top-level `.message` property.
 */
function extractErrorMessage(error: any): string {
  // 1. Nested errors array (google-ads-api gRPC errors)
  if (Array.isArray(error?.errors) && error.errors.length > 0) {
    const nested = error.errors[0];
    if (typeof nested?.message === "string" && nested.message) {
      return nested.message;
    }
    // Some errors have error_code as an object like { query_error: 'UNRECOGNIZED_FIELD' }
    if (nested?.error_code) {
      const codeEntries = Object.entries(nested.error_code).filter(([, v]) => v !== 0 && v !== "UNSPECIFIED");
      if (codeEntries.length > 0) {
        return codeEntries.map(([k, v]) => `${k}: ${v}`).join(", ");
      }
    }
  }
  // 2. Top-level message (if it's a real string, not "[object Object]")
  if (typeof error?.message === "string" && error.message && !error.message.includes("[object Object]")) {
    return error.message;
  }
  // 3. Fallback: try JSON serialization for useful output
  try {
    const json = JSON.stringify(error, null, 0);
    if (json && json !== "{}" && json.length < 500) {
      return json;
    }
  } catch {
    // ignore
  }
  return String(error);
}

export function classifyError(error: any): Error {
  const message = extractErrorMessage(error);
  const code = error?.errors?.[0]?.error_code;
  const status = error?.status;

  // Auth failures: expired tokens, invalid credentials, permission denied
  if (
    status === 401 ||
    status === 403 ||
    message.includes("AUTHENTICATION_ERROR") ||
    message.includes("AUTHORIZATION_ERROR") ||
    message.includes("invalid_grant") ||
    message.includes("Token has been expired") ||
    message.includes("refresh token") ||
    code?.authentication_error ||
    code?.authorization_error
  ) {
    return new GoogleAdsAuthError(
      `Auth failed: ${message}. Check refresh token in Keychain (security find-generic-password -a google-ads-drak -s GOOGLE_ADS_REFRESH_TOKEN -w)`,
      error,
    );
  }

  // Rate limiting
  if (
    status === 429 ||
    message.includes("RESOURCE_EXHAUSTED") ||
    code?.quota_error
  ) {
    const retryMs = error?.retryAfter ? error.retryAfter * 1000 : 60_000;
    return new GoogleAdsRateLimitError(retryMs, error);
  }

  // Server errors
  if (status >= 500 || message.includes("INTERNAL_ERROR")) {
    return new GoogleAdsServiceError(
      `Google Ads API server error: ${message}`,
      error,
    );
  }

  // Unclassified: wrap in a proper Error so .message is always a string
  if (!(error instanceof Error)) {
    const wrapped = new Error(message);
    wrapped.name = "GoogleAdsError";
    (wrapped as any).cause = error;
    return wrapped;
  }
  // If original error.message was "[object Object]", replace it
  if (error.message.includes("[object Object]")) {
    error.message = message;
  }
  return error;
}
