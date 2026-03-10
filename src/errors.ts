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

export function classifyError(error: any): Error {
  const message = error?.message || String(error);
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

  return error;
}
