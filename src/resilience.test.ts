import { describe, it, expect, beforeEach } from "vitest";
import { withResilience, safeResponse, logger } from "../src/resilience";

describe("Resilience", () => {
  describe("safeResponse", () => {
    it("should return data unchanged if under size limit", () => {
      const data = { name: "test", count: 100 };
      const result = safeResponse(data, "test");
      expect(result).toEqual(data);
    });

    it("should return a small top-level array unchanged (still a bare array)", () => {
      const small = [{ id: 1 }, { id: 2 }];
      const result = safeResponse(small, "test");
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(small);
    });

    it("should wrap a truncated top-level array (>200KB) with a truncation marker and counts", () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        description: "x".repeat(100),
      }));
      expect(Buffer.byteLength(JSON.stringify(largeArray), "utf-8")).toBeGreaterThan(200_000);
      const result = safeResponse(largeArray, "test") as any;
      // A bare array has nowhere to carry a marker, so a cut array must come
      // back wrapped -- otherwise a partial GAQL result looks complete.
      expect(Array.isArray(result)).toBe(false);
      expect(Object.keys(result).sort()).toEqual(["original_count", "returned_count", "rows", "truncated"]);
      expect(result.truncated).toBe(true);
      expect(result.original_count).toBe(10000);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.returned_count).toBe(result.rows.length);
      expect(result.returned_count).toBeLessThan(result.original_count);
      expect(result.returned_count).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(result), "utf-8")).toBeLessThanOrEqual(200_000);
      // Truncation keeps the first N entries (slice from 0)
      expect(result.rows[0].id).toBe(0);
      // Input is not mutated
      expect(largeArray.length).toBe(10000);
    });

    it("should truncate large objects with items array", () => {
      const largeObj = {
        items: Array.from({ length: 5000 }, (_, i) => ({
          id: i,
          data: "x".repeat(200),
        })),
      };
      const result = safeResponse(largeObj, "test") as any;
      expect(result.items.length).toBeLessThan(5000);
      expect(result.items.length).toBeGreaterThan(0);
      // Truncation must set the `truncated` marker so downstream consumers
      // can tell the response was cut.
      expect(result.truncated).toBe(true);
      // Items kept are the first N (slice from 0)
      expect(result.items[0].id).toBe(0);
      expect(Buffer.byteLength(JSON.stringify(result), "utf-8")).toBeLessThanOrEqual(200_000);
    });
  });

  describe("withResilience", () => {
    it("should execute successfully on first attempt", async () => {
      const fn = async () => ({ success: true });
      const result = await withResilience(fn, "test-op");
      expect(result).toEqual({ success: true });
    });

    it("should retry on transient failures", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) throw new Error("Temporary failure");
        return { success: true };
      };

      const result = await withResilience(fn, "test-op");
      expect(result).toEqual({ success: true });
      // Exact retry count: first attempt throws, second succeeds.
      expect(attempts).toBe(2);
    });

    it("should fail after max retry attempts", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error("Persistent failure");
      };

      await expect(() => withResilience(fn, "test-op")).rejects.toThrow(
        "Persistent failure"
      );
      // Cockatiel's `retry(..., { maxAttempts: 3 })` means 3 retries AFTER
      // the initial attempt = 4 total invocations. Pin the cap so an impl
      // that gives up after 1 attempt OR retries forever both fail.
      expect(attempts).toBe(4);
    });
  });
});
