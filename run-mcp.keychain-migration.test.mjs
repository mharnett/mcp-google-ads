// ============================================
// run-mcp.sh / scripts/release.sh Keychain migration.
// ============================================
// Both files must source the shared drak_ops keychain_get.sh helper
// (resolved via keychain_shell_helper_path()) instead of shelling out to
// `security find-generic-password` inline. run-mcp.wrapper.test.mjs already
// covers run-mcp.sh's account-selection BEHAVIOR against a stubbed
// `security` and needed no ASSERTION changes -- it only asserts on the
// resolved env var, not on which command produced it. It did need a fake
// `python3` added to its own sandbox (see its own file), since CI runners
// have no real drak_ops install for the HELPER resolution line to find.
// This file adds: (1) the wiring check for both scripts, (2) a repo-wide
// ratchet so no tracked .sh file regresses to the inline call, and (3) a
// behavioral test of release.sh's own `lookup()` failure path (extracted
// and sourced in isolation, so this test never runs the real npm
// ci/build/publish side effects that follow it in the real script).

import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const RUN_MCP = path.join(REPO_ROOT, "run-mcp.sh");
const RELEASE = path.join(REPO_ROOT, "scripts", "release.sh");
const FIXTURE_HELPER = path.join(REPO_ROOT, "tests", "fixtures", "keychain_get.sh");

// Files legitimately allowed to still contain the raw literal, and why --
// an allowance WITH a reason, not a blanket skip, so the set can only
// shrink. tests/fixtures/keychain_get.sh is a hermetic double of the real
// shared helper, which itself contains the literal as its own
// implementation (exactly like the real drak_ops/keychain_get.sh does) --
// this is the one place the string is SUPPOSED to live, not an inline
// caller.
const ALLOWED_LITERAL_FILES = new Set(["tests/fixtures/keychain_get.sh"]);

function sourcesSharedHelper(scriptPath) {
  const text = readFileSync(scriptPath, "utf8");
  return text.includes("keychain_shell_helper_path") && /^source "\$HELPER"/m.test(text);
}

describe("run-mcp.sh sources the shared drak_ops helper", () => {
  it("resolves+sources keychain_get.sh via keychain_shell_helper_path()", () => {
    expect(sourcesSharedHelper(RUN_MCP)).toBe(true);
  });
});

describe("scripts/release.sh sources the shared drak_ops helper", () => {
  it("resolves+sources keychain_get.sh via keychain_shell_helper_path()", () => {
    expect(sourcesSharedHelper(RELEASE)).toBe(true);
  });
});

describe("ratchet: no unexcused tracked .sh file still shells out to security find-generic-password", () => {
  it("finds zero unexcused offenders", () => {
    const files = execSync("git ls-files '*.sh'", { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const offenders = files.filter(
      (rel) =>
        !ALLOWED_LITERAL_FILES.has(rel) &&
        readFileSync(path.join(REPO_ROOT, rel), "utf8").includes("find-generic-password")
    );
    expect(offenders).toEqual([]);
  });
});

// ============================================
// release.sh's lookup() failure path, hermetically.
// ============================================
// Extract just the `KEYCHAIN_ACCOUNT=` + `lookup() { ... }` block (everything
// before "Pulling OAuth credentials") and source it under a fake `security`
// on PATH -- never touching npm ci/build/publish, which follow in the real
// script and are out of scope for a Keychain-resolution test.

function extractLookupBlock() {
  const text = readFileSync(RELEASE, "utf8");
  // Start at the HELPER= line (which sources keychain_get) so the extracted
  // snippet is self-contained -- lookup() calls keychain_get internally.
  const start = text.indexOf("HELPER=");
  const end = text.indexOf("echo \"==> Pulling");
  if (start === -1 || end === -1) {
    throw new Error("release.sh shape changed -- update extractLookupBlock()");
  }
  return "set -euo pipefail\n" + text.slice(start, end);
}

function runLookup(service, keychainRows) {
  const sandbox = mkdtempSync(path.join(tmpdir(), "release-sh-lookup-"));
  writeFileSync(
    path.join(sandbox, "security"),
    `#!/bin/bash
acct=""; svc=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) acct="$2"; shift 2 ;;
    -s) svc="$2";  shift 2 ;;
    *)  shift ;;
  esac
done
while IFS= read -r row; do
  [ -z "$row" ] && continue
  racct="\${row%%|*}"; rest="\${row#*|}"; rsvc="\${rest%%|*}"
  [ "$rsvc" = "$svc" ] || continue
  if [ -z "$acct" ] || [ "$racct" = "$acct" ]; then
    printf '%s' "\${row##*|}"; exit 0
  fi
done <<< "$KEYCHAIN"
exit 44
`
  );
  chmodSync(path.join(sandbox, "security"), 0o755);

  // release.sh's lookup() now resolves HELPER via
  // `python3 -c '...keychain_shell_helper_path...'`. No real drak_ops
  // install exists on these CI runners (see ALLOWED_LITERAL_FILES comment
  // above) -- resolve it to the hermetic fixture instead.
  writeFileSync(
    path.join(sandbox, "python3"),
    `#!/bin/bash\necho "${FIXTURE_HELPER}"\n`
  );
  chmodSync(path.join(sandbox, "python3"), 0o755);

  const script = extractLookupBlock() + `\nlookup "${service}"\necho "EXIT:$?"\n`;
  const scriptPath = path.join(sandbox, "snippet.sh");
  writeFileSync(scriptPath, script);

  const env = { ...process.env, PATH: `${sandbox}:${process.env.PATH}`, KEYCHAIN: keychainRows };
  const result = spawnSync("bash", [scriptPath], { env, encoding: "utf8" });
  rmSync(sandbox, { recursive: true, force: true });
  return result;
}

describe("release.sh's lookup() against the shared helper (post-migration behavior)", () => {
  it("present credential resolves and prints it", () => {
    const result = runLookup(
      "GOOGLE_ADS_CLIENT_ID",
      "google-ads-mcp|GOOGLE_ADS_CLIENT_ID|cid123"
    );
    expect(result.stdout).toContain("cid123");
    expect(result.status).toBe(0);
  });

  it("missing credential is fatal with the documented fix message", () => {
    const result = runLookup("GOOGLE_ADS_CLIENT_ID", "");
    expect(result.stderr).toContain("Keychain entry missing");
    expect(result.status).toBe(1);
  });
});
