// ============================================
// CI guard: exactly one publish path is documented as canonical, and it's
// CI OIDC (.github/workflows/publish.yml), not the local Keychain script.
// ============================================
// This locks in the fix for the mislabelled comment in publish.yml that
// claimed `scripts/release.sh` was the "canonical publish path" — it's
// actually the non-canonical, interactive-passkey-required fallback.
//
// Two assertions:
//   1. publish.yml no longer asserts scripts/release.sh is canonical, and
//      names CI/OIDC as canonical somewhere in its "canonical" sentence.
//   2. scripts/release.sh still exists, still bakes the OAuth client from
//      Keychain (never a developer token), still runs `npm publish`, and
//      carries a header comment (within its first 25 lines) stating it is
//      NOT the canonical publish path and requires an interactive WebAuthn
//      passkey.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;

describe("publish.yml names CI/OIDC as the canonical publish path", () => {
  const publishYmlPath = path.join(REPO, ".github/workflows/publish.yml");
  const publishYml = readFileSync(publishYmlPath, "utf-8");
  const canonicalLines = publishYml
    .split("\n")
    .filter((line) => /anonical/.test(line));

  it("has at least one line mentioning 'canonical'", () => {
    expect(canonicalLines.length).toBeGreaterThan(0);
  });

  it("does not claim scripts/release.sh is the canonical publish path", () => {
    const claimsScriptCanonical = canonicalLines.some((line) =>
      /canonical publish path is scripts\/release\.sh/i.test(line),
    );
    expect(claimsScriptCanonical).toBe(false);
  });

  it("names CI/OIDC (not the script) as canonical", () => {
    const namesCiCanonical = canonicalLines.some(
      (line) => /anonical/.test(line) && /(CI|OIDC|this workflow|GitHub Actions)/i.test(line),
    );
    expect(namesCiCanonical).toBe(true);
  });
});

describe("no build, publish or release path names EMBEDDED_DEVELOPER_TOKEN", () => {
  const walk = (dir) =>
    readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
  const files = [...[".github", "scripts", "src"].flatMap(walk), "package.json", "run-mcp.sh", "setup.sh"].filter(
    (file) => !/\.test\.(m?[jt]s)$/.test(file),
  );

  it("scans the paths that could (not vacuous)", () => {
    const seen = files.map((file) => file.split(path.sep).join("/"));
    expect(seen).toEqual(
      expect.arrayContaining([".github/workflows/publish.yml", "scripts/build.mjs", "scripts/check-embedded.mjs", "scripts/release.sh", "src/embedded-secrets.ts"]),
    );
    const naming = (text) => files.filter((file) => readFileSync(path.join(REPO, file), "utf-8").includes(text));
    expect(naming("EMBEDDED_CLIENT_SECRET").length).toBeGreaterThanOrEqual(5);
    expect(naming("EMBEDDED_DEVELOPER_TOKEN")).toEqual([]);
  });
});

describe("scripts/release.sh is retained, unchanged in function, and annotated non-canonical", () => {
  const releaseShPath = path.join(REPO, "scripts/release.sh");

  it("still exists", () => {
    expect(existsSync(releaseShPath)).toBe(true);
  });

  const releaseSh = readFileSync(releaseShPath, "utf-8");
  const firstLines = releaseSh.split("\n").slice(0, 25).join("\n");

  it("carries a non-canonical header naming the interactive WebAuthn passkey requirement, in its first 25 lines", () => {
    expect(firstLines).toMatch(/not the canonical|non-canonical/i);
    expect(firstLines).toMatch(/WebAuthn/i);
    expect(firstLines).toMatch(/passkey/i);
  });

  it("still bakes credentials from Keychain (function unchanged)", () => {
    expect(releaseSh).toMatch(/keychain_get/);
    expect(releaseSh).toMatch(/EMBEDDED_CLIENT_ID/);
    expect(releaseSh).toMatch(/EMBEDDED_CLIENT_SECRET/);
  });

  // release.sh reads the live Keychain and publishes, so it is never run by a
  // test. What the build does with the variable is exercised in
  // scripts/build.embedded.test.mjs.
  it("reads no developer token", () => {
    expect(releaseSh).not.toMatch(/DEVELOPER_TOKEN/i);
  });

  it("still runs npm publish (publish step retained, function unchanged)", () => {
    expect(releaseSh).toMatch(/npm publish/);
  });
});
