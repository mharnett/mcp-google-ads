import { describe, expect, it } from "vitest";

import {
  escapeGaqlString,
  requireGaqlDate,
  requireNumericId,
  requireOneOf,
  sanitizeNumericId,
} from "./gaqlSanitize.js";

describe("sanitizeNumericId", () => {
  it("strips every non-digit", () => {
    expect(sanitizeNumericId("123-456-7890")).toBe("1234567890");
  });

  it("turns an injection attempt into a different id, which is why write paths refuse instead", () => {
    expect(sanitizeNumericId("1 OR 1=1")).toBe("111");
  });
});

describe("escapeGaqlString", () => {
  it("escapes single quotes so a value cannot close the string literal", () => {
    expect(escapeGaqlString("x' OR campaign.id > '0")).toBe("x\\' OR campaign.id > \\'0");
  });

  it("escapes backslashes before quotes, so a trailing backslash cannot eat the closing quote", () => {
    expect(escapeGaqlString("a\\")).toBe("a\\\\");
    expect(escapeGaqlString("\\'")).toBe("\\\\\\'");
  });
});

describe("requireNumericId", () => {
  it.each<[unknown, string]>([
    ["123", "123"],
    ["  987654321 ", "987654321"],
    [42, "42"],
  ])("accepts %j as %s", (value, expected) => {
    expect(requireNumericId(value, "campaign_id")).toBe(expected);
  });

  it.each<unknown>([
    "1 OR 1=1",
    "1; DROP",
    "123'",
    "12a",
    "-1",
    "1.5",
    1.5,
    -3,
    "",
    "   ",
    undefined,
    null,
    ["1"],
    "1".repeat(21),
  ])("refuses %j and names the field", (value) => {
    expect(() => requireNumericId(value, "campaign_id")).toThrow(/campaign_id must be a numeric id/);
  });
});

describe("requireGaqlDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(requireGaqlDate("2026-01-31", "start_date")).toBe("2026-01-31");
  });

  it.each<unknown>(["2026-01-01' OR '1'='1", "2026/01/01", "20260101", "2026-1-1", "", undefined, 20260101])(
    "refuses %j and names the field",
    (value) => {
      expect(() => requireGaqlDate(value, "start_date")).toThrow(/start_date must be a date in YYYY-MM-DD form/);
    },
  );
});

describe("requireOneOf", () => {
  const STATUSES = ["SETUP", "ENABLED"] as const;

  it("accepts a listed value", () => {
    expect(requireOneOf("ENABLED", "status_filter", STATUSES)).toBe("ENABLED");
  });

  it.each<unknown>(["ENABLED' OR '1'='1", "enabled", "", undefined, 2])("refuses %j and lists the allowed values", (value) => {
    expect(() => requireOneOf(value, "status_filter", STATUSES)).toThrow(/status_filter must be one of SETUP, ENABLED/);
  });
});
