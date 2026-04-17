import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

// Regression: v1.1.0 shipped with an isMain check that failed when auth-cli.js
// was invoked via the .bin symlink created by npm / npx. The symlink path did
// not match import.meta.url (resolved real path), so run() never executed and
// the CLI exited silently — no browser opened, no error. Compare real paths.
describe("auth-cli entrypoint", () => {
  it("runs when invoked via a symlink (npx / .bin shim)", () => {
    const dist = resolve(__dirname, "..", "dist", "auth-cli.js");
    const tmp = mkdtempSync(join(tmpdir(), "mcp-ga-auth-"));
    const link = join(tmp, "mcp-google-ads-auth");
    try {
      symlinkSync(dist, link);
      const out = execFileSync("node", [link, "--help"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(out).toContain("authorize Claude to access your Google Ads account");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
