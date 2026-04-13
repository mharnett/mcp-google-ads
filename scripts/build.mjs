#!/usr/bin/env node
// ============================================
// BUILD: TS -> dist/ JS + .d.ts
// ============================================
// Replaces the previous single `tsc` invocation with a two-step build:
//
//   1. esbuild compiles src/**.ts -> dist/**.js, with build-time substitution
//      of process.env.EMBEDDED_CLIENT_ID / CLIENT_SECRET / DEVELOPER_TOKEN
//      via --define. At dev-time (`npm run dev` / tsx), no substitution
//      happens and the source falls back to runtime GOOGLE_ADS_* env vars.
//
//   2. tsc --emitDeclarationOnly generates the .d.ts files only.
//      esbuild doesn't produce type declarations, so we still need tsc for this.
//
// Secrets live ONLY in the build environment (populated by scripts/release.sh
// from macOS Keychain on release) — never in git, never in the source tree.
// If EMBEDDED_* env vars are not set at build time, the compiled package still
// works but requires end users to set GOOGLE_ADS_* env vars themselves.

import { build } from "esbuild";
import { execSync } from "child_process";
import { writeFileSync, readdirSync, statSync, rmSync, existsSync } from "fs";
import { join } from "path";

const SRC = "src";
const OUT = "dist";

// ============================================
// 1. Clean
// ============================================
if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}

// ============================================
// 2. Collect source entry points
// ============================================
// We emit one .js per .ts (no bundling) so debugging + stack traces remain sane
// and node_modules resolution stays at runtime (matching the old tsc behavior).

function walkTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const entryPoints = walkTs(SRC);

// ============================================
// 3. Build-time secret injection via --define
// ============================================
// esbuild rewrites `process.env.EMBEDDED_X` as the literal string value
// at build time. Missing values become `""` and the code falls through
// to runtime env var resolution.

function defineFromEnv(key) {
  const val = process.env[key] || "";
  return JSON.stringify(val);
}

const define = {
  "process.env.EMBEDDED_CLIENT_ID": defineFromEnv("EMBEDDED_CLIENT_ID"),
  "process.env.EMBEDDED_CLIENT_SECRET": defineFromEnv("EMBEDDED_CLIENT_SECRET"),
  "process.env.EMBEDDED_DEVELOPER_TOKEN": defineFromEnv("EMBEDDED_DEVELOPER_TOKEN"),
};

const missingEmbedded = Object.entries(define)
  .filter(([, v]) => v === '""')
  .map(([k]) => k.replace("process.env.", ""));

if (missingEmbedded.length > 0) {
  process.stderr.write(
    `⚠️  Build-time secrets missing: ${missingEmbedded.join(", ")}\n` +
      `⚠️  End users of the published package will need to set GOOGLE_ADS_* env vars themselves.\n` +
      `⚠️  Use scripts/release.sh to inject from macOS Keychain for npm releases.\n`,
  );
}

// ============================================
// 4. esbuild JS
// ============================================

await build({
  entryPoints,
  outdir: OUT,
  outbase: SRC,
  platform: "node",
  format: "esm",
  target: "node18",
  bundle: false, // one-to-one .ts -> .js, deps resolved at runtime
  sourcemap: true,
  logLevel: "info",
  define,
});

// ============================================
// 5. tsc --emitDeclarationOnly for .d.ts
// ============================================
// Use a separate tsconfig fragment to avoid overriding `outDir` or rootDir
execSync("tsc --emitDeclarationOnly --declaration --outDir dist", {
  stdio: "inherit",
});

// ============================================
// 6. Build-info footprint
// ============================================

let sha = "unknown";
try {
  sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {
  // not in a git tree or git unavailable
}

writeFileSync(
  join(OUT, "build-info.json"),
  JSON.stringify(
    {
      sha,
      builtAt: new Date().toISOString(),
      embeddedSecrets: missingEmbedded.length === 0,
    },
    null,
    2,
  ),
);

process.stdout.write(`✅ Build complete (${entryPoints.length} files, sha=${sha}, embedded=${missingEmbedded.length === 0})\n`);
