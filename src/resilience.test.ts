import { describe, it, expect, beforeEach } from "vitest";
import { withResilience, safeResponse, logger } from "../src/resilience";

describe("Resilience", () => {
  describe("safeResponse", () => {
    it("should return data unchanged if under size limit", () => {
      const data = { name: "test", count: 100 };
      const result = safeResponse(data, "test");
      expect(result).toEqual(data);
    });

    it("should truncate large arrays", () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        description: "x".repeat(100),
      }));
      const result = safeResponse(largeArray, "test");
      expect(Array.isArray(result)).toBe(true);
      // Truncation halves each pass; result must be strictly smaller AND
      // the serialized form must fit under the documented 200KB cap.
      const resultArr = result as any[];
      expect(resultArr.length).toBeLessThan(largeArray.length);
      expect(resultArr.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(resultArr), "utf-8")).toBeLessThanOrEqual(200_000);
      // Truncation keeps the first N entries (slice from 0)
      expect(resultArr[0].id).toBe(0);
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
