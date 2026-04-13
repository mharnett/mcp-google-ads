import { describe, it, expect } from "vitest";

import { effectiveTextLength, validateRsa } from "./validateRsa.js";

const BASE_VALID_AD = {
  headlines: ["Headline 1", "Headline 2", "Headline 3"],
  descriptions: ["Description 1", "Description 2"],
  final_urls: ["https://example.com/"],
  path1: "nonprofit",
  path2: "crm",
  labels: ["claude-2026-04-12"],
};

describe("validateRsa", () => {
  describe("base cases", () => {
    it("accepts a fully-valid ad", () => {
      const result = validateRsa(BASE_VALID_AD);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("headlines", () => {
    it("requires at least 3 headlines", () => {
      const result = validateRsa({
        ...BASE_VALID_AD,
        headlines: ["Only two", "headlines"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /at least 3 headlines/i.test(e))).toBe(true);
    });

    it("rejects more than 15 headlines", () => {
      const result = validateRsa({
        ...BASE_VALID_AD,
        headlines: Array.from({ length: 16 }, (_, i) => `Headline ${i}`),
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /Maximum 15 headlines/.test(e))).toBe(true);
    });

    it("rejects headlines longer than 30 chars", () => {
      const result = validateRsa({
        ...BASE_VALID_AD,
        headlines: [
          "This headline is exactly 31 chars long!!",
          "Headline 2",
          "Headline 3",
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /Headline 1 too long/.test(e))).toBe(true);
    });
  });

  describe("descriptions", () => {
    it("requires at least 2 descriptions", () => {
      const result = validateRsa({
        ...BASE_VALID_AD,
        descriptions: ["Only one"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /at least 2 descriptions/i.test(e))).toBe(true);
    });

    it("rejects descriptions longer than 90 chars", () => {
      const longDesc = "x".repeat(91);
      const result = validateRsa({
        ...BASE_VALID_AD,
        descriptions: [longDesc, "Description 2"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /Description 1 too long/.test(e))).toBe(true);
    });
  });

  describe("final_urls", () => {
    it("requires at least one final_url", () => {
      const result = validateRsa({ ...BASE_VALID_AD, final_urls: [] });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /final URL/i.test(e))).toBe(true);
    });
  });

  // ──────── NEW REQUIREMENTS ────────

  describe("path1 (NEW: required, ≤15 chars, non-empty)", () => {
    it("rejects missing path1", () => {
      const { path1: _p1, ...ad } = BASE_VALID_AD;
      const result = validateRsa(ad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path1.*required/i.test(e))).toBe(true);
    });

    it("rejects empty path1", () => {
      const result = validateRsa({ ...BASE_VALID_AD, path1: "" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path1.*required/i.test(e))).toBe(true);
    });

    it("rejects whitespace-only path1", () => {
      const result = validateRsa({ ...BASE_VALID_AD, path1: "   " });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path1.*required/i.test(e))).toBe(true);
    });

    it("rejects path1 longer than 15 chars", () => {
      const result = validateRsa({ ...BASE_VALID_AD, path1: "this-is-sixteen0" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path1 too long/i.test(e))).toBe(true);
    });

    it("accepts path1 at exactly 15 chars", () => {
      const result = validateRsa({ ...BASE_VALID_AD, path1: "fifteen-chars12" });
      expect(result.valid).toBe(true);
    });
  });

  describe("path2 (NEW: required, ≤15 chars, non-empty)", () => {
    it("rejects missing path2", () => {
      const { path2: _p2, ...ad } = BASE_VALID_AD;
      const result = validateRsa(ad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path2.*required/i.test(e))).toBe(true);
    });

    it("rejects empty path2", () => {
      const result = validateRsa({ ...BASE_VALID_AD, path2: "" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path2.*required/i.test(e))).toBe(true);
    });

    it("rejects path2 longer than 15 chars", () => {
      const result = validateRsa({ ...BASE_VALID_AD, path2: "this-is-sixteen0" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path2 too long/i.test(e))).toBe(true);
    });
  });

  describe("labels (NEW: at least 1 required)", () => {
    it("rejects missing labels", () => {
      const { labels: _labels, ...ad } = BASE_VALID_AD;
      const result = validateRsa(ad);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /label/i.test(e))).toBe(true);
    });

    it("rejects empty labels array", () => {
      const result = validateRsa({ ...BASE_VALID_AD, labels: [] });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /at least 1 label/i.test(e))).toBe(true);
    });

    it("accepts one label", () => {
      const result = validateRsa({ ...BASE_VALID_AD, labels: ["claude-2026-04-12"] });
      expect(result.valid).toBe(true);
    });

    it("accepts multiple labels", () => {
      const result = validateRsa({
        ...BASE_VALID_AD,
        labels: ["claude-2026-04-12", "brand-campaign"],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects labels array with only whitespace entries", () => {
      const result = validateRsa({ ...BASE_VALID_AD, labels: ["  "] });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /at least 1 label/i.test(e))).toBe(true);
    });
  });

  describe("effectiveTextLength — keyword insertion + customizer rendering", () => {
    it("treats {KeyWord:default} as the default text length", () => {
      // Literal 35, default "FDA Compliant Fulfillment" = 25
      expect(effectiveTextLength("{Keyword:FDA Compliant Fulfillment}")).toBe(25);
      expect(effectiveTextLength("{KeyWord:Fulfillment Services}")).toBe(20);
      expect(effectiveTextLength("{keyword:3pl}")).toBe(3);
      expect(effectiveTextLength("{KEYWORD:pet products}")).toBe(12);
    });

    it("treats {CUSTOMIZER.Name:default} as the default text length", () => {
      expect(effectiveTextLength("{CUSTOMIZER.CurrentDate:Today}")).toBe(5);
    });

    it("treats bare {CUSTOMIZER.Name} as a conservative estimate", () => {
      // "foo " + CUSTOMIZER_RENDER_LEN (16)
      expect(effectiveTextLength("foo {CUSTOMIZER.Bar}")).toBe(4 + 16);
    });

    it("returns plain length when no tokens present", () => {
      expect(effectiveTextLength("Hello world")).toBe(11);
    });
  });

  describe("keyword insertion in ad fields", () => {
    it("accepts a headline whose literal exceeds 30 but default fits", () => {
      // Literal 35, default 25 — must pass.
      const result = validateRsa({
        ...BASE_VALID_AD,
        headlines: [
          "{Keyword:FDA Compliant Fulfillment}",
          "Headline 2",
          "Headline 3",
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects a headline whose default text exceeds 30", () => {
      // Default "This default text is thirty-one!!" = 33 chars
      const result = validateRsa({
        ...BASE_VALID_AD,
        headlines: [
          "{Keyword:This default text is thirty-one!!}",
          "Headline 2",
          "Headline 3",
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /Headline 1 too long/.test(e))).toBe(true);
    });

    it("accepts a description containing {KeyWord:default} whose literal exceeds 90", () => {
      // 70-char prefix + {KeyWord:short} => literal >90, rendered ~76 ≤ 90
      const result = validateRsa({
        ...BASE_VALID_AD,
        descriptions: [
          "x".repeat(70) + " {KeyWord:short}",
          "Description 2",
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("accepts a path containing a short keyword insertion", () => {
      // Literal "{KeyWord:3pl}" = 13 chars, rendered "3pl" = 3 chars
      const result = validateRsa({ ...BASE_VALID_AD, path1: "{KeyWord:3pl}" });
      expect(result.valid).toBe(true);
    });

    it("rejects a path whose rendered form exceeds 15 chars", () => {
      // Default "sixteen-char-paths" = 18 chars
      const result = validateRsa({
        ...BASE_VALID_AD,
        path1: "{KeyWord:sixteen-char-paths}",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /path1 too long/i.test(e))).toBe(true);
    });
  });

  describe("accumulates multiple errors", () => {
    it("reports all failures, not just the first", () => {
      const result = validateRsa({
        headlines: ["only one"],
        descriptions: ["only one"],
        final_urls: [],
        path1: "",
        path2: "way-too-long-path-here",
        labels: [],
      });
      expect(result.valid).toBe(false);
      // At least: headlines count, descriptions count, final_url, path1 missing,
      // path2 too long, labels missing
      expect(result.errors.length).toBeGreaterThanOrEqual(6);
    });
  });
});
