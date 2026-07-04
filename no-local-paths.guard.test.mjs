// ============================================
// CI guard: the SHIPPED surface must contain no absolute /Users/mark path
// and no gcp-oauth (shared OAuth-client) reference.
// ============================================
// "Shipped surface" = exactly what npm publishes (package.json `files`) plus
// the standalone onboarding helper: get-refresh-token.cjs, src/** (excluding
// tests), README.md, config.example.json.
//
// Deliberately EXCLUDED: node_modules, .git, dist (build output — verified via
// src), *.test.* / *.guard.* files, and Mark's PRIVATE launcher scripts
// (run-mcp.sh, scripts/healthcheck.sh) which are NOT in package.json `files`
// and therefore never ship. Those carry a /Users/mark path by design; the
// guard asserts separately that they are not in the publish allowlist.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;

const FORBIDDEN = [/\/Users\/mark/, /gcp-oauth/];

// Directories never scanned.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "backlog", "helpers", "scripts", ".github"]);

function isTestOrGuard(file) {
  return /\.(test|guard)\.(m?[jt]s|cjs)$/.test(file);
}

// Walk only files that are part of the shipped surface.
function shippedFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(REPO, full);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      out.push(...shippedFiles(full));
      continue;
    }
    if (isTestOrGuard(entry)) continue;
    // config.json is gitignored/per-user — not shipped; config.example.json is.
    if (entry === "config.json") continue;
    // Only scan source-like + docs + the helper + the example config.
    const shippable =
      full === path.join(REPO, "get-refresh-token.cjs") ||
      full === path.join(REPO, "README.md") ||
      full === path.join(REPO, "config.example.json") ||
      rel.startsWith("src" + path.sep);
    if (shippable) out.push(full);
  }
  return out;
}

describe("shipped surface has no local /Users/mark paths or gcp-oauth references", () => {
  const files = shippedFiles(REPO);

  it("scans a non-trivial set of files (guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(5);
    // Sanity: the helper and README are in scope.
    expect(files.some((f) => f.endsWith("get-refresh-token.cjs"))).toBe(true);
    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
  });

  it("contains no forbidden string in any shipped file", () => {
    const hits = [];
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      src.split("\n").forEach((line, i) => {
        for (const re of FORBIDDEN) {
          if (re.test(line)) {
            hits.push(`${path.relative(REPO, file)}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }
    expect(hits, `Forbidden strings in shipped surface:\n${hits.join("\n")}`).toEqual([]);
  });

  it("private launcher scripts carrying /Users/mark are NOT in the npm publish allowlist", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf-8"));
    const allow = (pkg.files || []).join("\n");
    // These files exist and legitimately reference /Users/mark, but must never ship.
    for (const priv of ["run-mcp.sh", "scripts/healthcheck.sh"]) {
      if (existsSync(path.join(REPO, priv))) {
        expect(allow).not.toContain(priv);
      }
    }
    // Belt-and-braces: no top-level *.sh is in the allowlist.
    expect(allow).not.toMatch(/\.sh(\s|$)/);
  });
});
