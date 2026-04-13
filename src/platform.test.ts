import { describe, it, expect } from "vitest";
import {
  configDir,
  credentialsFilePath,
  findFreeLoopbackPort,
  currentPlatform,
  isMac,
  isWindows,
} from "./platform.js";
import path from "path";
import { createServer } from "net";

describe("platform.ts", () => {
  describe("configDir + credentialsFilePath", () => {
    it("returns a non-empty absolute path for configDir", () => {
      expect(configDir).toBeTruthy();
      expect(path.isAbsolute(configDir)).toBe(true);
    });

    it("credentialsFilePath lives inside configDir", () => {
      expect(credentialsFilePath.startsWith(configDir)).toBe(true);
      expect(credentialsFilePath.endsWith("credentials.json")).toBe(true);
    });

    it("configDir path is platform-appropriate", () => {
      // Just a sanity check — env-paths handles the precise locations
      if (isMac()) {
        expect(configDir.toLowerCase()).toMatch(/library|preferences/);
      } else if (isWindows()) {
        expect(configDir).toMatch(/AppData|Roaming/i);
      } else {
        // Linux/other
        expect(configDir).toMatch(/config|\./i);
      }
    });
  });

  describe("currentPlatform / isMac / isWindows", () => {
    it("currentPlatform returns a known value", () => {
      const p = currentPlatform();
      expect(["darwin", "win32", "linux", "other"]).toContain(p);
    });

    it("isMac and isWindows agree with currentPlatform", () => {
      const p = currentPlatform();
      expect(isMac()).toBe(p === "darwin");
      expect(isWindows()).toBe(p === "win32");
    });
  });

  describe("findFreeLoopbackPort", () => {
    it("returns a port in the declared range", async () => {
      const port = await findFreeLoopbackPort();
      expect(port).toBeGreaterThanOrEqual(8085);
      expect(port).toBeLessThanOrEqual(8199);
    });

    it("returns a port that is actually bindable", async () => {
      const port = await findFreeLoopbackPort();
      // Confirm we can bind to it (would fail otherwise)
      await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.close(() => resolve());
        });
      });
    });

    it("skips a port that is already in use", async () => {
      // Bind to 8085 manually, then ask the scanner — it should pick something >= 8086
      const blocker = createServer();
      await new Promise<void>((resolve) =>
        blocker.listen(8085, "127.0.0.1", () => resolve()),
      );
      try {
        const port = await findFreeLoopbackPort();
        expect(port).not.toBe(8085);
        expect(port).toBeGreaterThanOrEqual(8086);
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    });
  });
});
