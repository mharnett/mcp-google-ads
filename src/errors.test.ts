import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsServiceError,
  classifyError,
  validateCredentials,
} from "./errors.js";

describe("classifyError", () => {
  it("classifies 401 status as GoogleAdsAuthError", () => {
    const error = { status: 401, message: "Unauthorized" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsAuthError);
    expect(result.message).toContain("Auth failed");
  });

  it("classifies 403 status as GoogleAdsAuthError", () => {
    const error = { status: 403, message: "Forbidden" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsAuthError);
  });

  it("classifies AUTHENTICATION_ERROR message as GoogleAdsAuthError", () => {
    const error = { message: "AUTHENTICATION_ERROR: bad token" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsAuthError);
  });

  it("classifies 429 status as GoogleAdsRateLimitError", () => {
    const error = { status: 429, message: "Too many requests" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsRateLimitError);
    expect((result as GoogleAdsRateLimitError).retryAfterMs).toBe(60_000);
  });

  it("classifies RESOURCE_EXHAUSTED message as GoogleAdsRateLimitError", () => {
    const error = { message: "RESOURCE_EXHAUSTED: quota exceeded" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsRateLimitError);
  });

  it("uses retryAfter from error when available", () => {
    const error = { status: 429, message: "Rate limited", retryAfter: 30 };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsRateLimitError);
    expect((result as GoogleAdsRateLimitError).retryAfterMs).toBe(30_000);
  });

  it("classifies 500 status as GoogleAdsServiceError", () => {
    const error = { status: 500, message: "Internal server error" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsServiceError);
    expect(result.message).toContain("server error");
  });

  it("classifies 503 status as GoogleAdsServiceError", () => {
    const error = { status: 503, message: "Service unavailable" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(GoogleAdsServiceError);
  });

  it("passes through generic errors unchanged", () => {
    const error = new Error("Something else went wrong");
    const result = classifyError(error);
    expect(result).toBe(error);
    expect(result).not.toBeInstanceOf(GoogleAdsAuthError);
    expect(result).not.toBeInstanceOf(GoogleAdsRateLimitError);
    expect(result).not.toBeInstanceOf(GoogleAdsServiceError);
  });

  it("wraps non-Error objects with non-matching status codes in GoogleAdsError", () => {
    const error = { status: 400, message: "Bad request" };
    const result = classifyError(error);
    expect(result).toBeInstanceOf(Error);
    expect(result.name).toBe("GoogleAdsError");
    expect(result.message).toBe("Bad request");
    expect((result as any).cause).toBe(error);
  });
});

describe("validateCredentials", () => {
  const envKeys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ];

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("returns valid when all env vars are set", () => {
    for (const key of envKeys) {
      process.env[key] = "test-value";
    }
    const result = validateCredentials();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("detects missing env vars", () => {
    for (const key of envKeys) {
      delete process.env[key];
    }
    const result = validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(envKeys);
  });

  it("detects empty string env vars", () => {
    for (const key of envKeys) {
      process.env[key] = "  ";
    }
    const result = validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(envKeys);
  });

  it("detects a single missing env var", () => {
    for (const key of envKeys) {
      process.env[key] = "test-value";
    }
    delete process.env["GOOGLE_ADS_REFRESH_TOKEN"];
    const result = validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["GOOGLE_ADS_REFRESH_TOKEN"]);
  });
});
