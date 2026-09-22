// ============================================
// run-mcp.sh Keychain account selection.
// ============================================
// run-mcp.sh is Mark's private launcher (never shipped — see
// no-local-paths.guard.test.mjs). It must default to the READ-ONLY
// google-ads-ro-drak Keychain account for GOOGLE_ADS_REFRESH_TOKEN, and only
// source the elevated google-ads-admin-drak account when the caller
// explicitly opts into writes via GOOGLE_ADS_MCP_WRITE=true. Any other value
// (unset, empty, "1", "false", garbage) must fall back to the RO account —
// the default posture is read-only.
//
// We can't invoke the real `security` binary or the real `node dist/index.js`
// server in a test, so we run the actual script under bash with a stub PATH:
// a fake `security` that echoes back the -a account name it was asked to
// look up (only for the GOOGLE_ADS_REFRESH_TOKEN service, so we can observe
// which account run-mcp.sh selected), and a fake `node` that prints the
// resulting GOOGLE_ADS_REFRESH_TOKEN env var instead of starting a server.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "run-mcp.sh");
// run-mcp.sh now sources the shared drak_ops keychain_get.sh helper via a
// `python3 -c '...keychain_shell_helper_path...'` one-liner (mcp-google-ads#43).
// CI runners here have no real drak_ops install (would need a new
// deploy-key/secret per repo, out of scope for a test-only need), so the
// `python3` stub below resolves it to this hermetic fixture instead.
const FIXTURE_HELPER = path.join(__dirname, "tests", "fixtures", "keychain_get.sh");

let binDir;

beforeAll(() => {
  binDir = mkdtempSync(path.join(tmpdir(), "run-mcp-stub-bin-"));

  writeFileSync(
    path.join(binDir, "python3"),
    `#!/bin/bash\necho "${FIXTURE_HELPER}"\n`
  );
  chmodSync(path.join(binDir, "python3"), 0o755);

  writeFileSync(
    path.join(binDir, "security"),
    `#!/bin/bash
account=""
service=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) account="$2"; shift 2;;
    -s) service="$2"; shift 2;;
    *) shift;;
  esac
done
case "$service" in
  GOOGLE_ADS_REFRESH_TOKEN|GOOGLE_ADS_REFRESH_TOKEN_AUTOMATION) echo "$service|$account";;
  *) echo "stub-value";;
esac
`
  );
  chmodSync(path.join(binDir, "security"), 0o755);

  writeFileSync(
    path.join(binDir, "node"),
    `#!/bin/bash
echo "$GOOGLE_ADS_REFRESH_TOKEN"
`
  );
  chmodSync(path.join(binDir, "node"), 0o755);
});

afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
});

function runWithWriteFlag(value) {
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };
  if (value === undefined) {
    delete env.GOOGLE_ADS_MCP_WRITE;
  } else {
    env.GOOGLE_ADS_MCP_WRITE = value;
  }
  const result = spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
  return result.stdout.trim();
}

describe("run-mcp.sh Keychain item selection", () => {
  it("GOOGLE_ADS_MCP_WRITE unset -> sources the read-only item", () => {
    expect(runWithWriteFlag(undefined)).toBe(
      "GOOGLE_ADS_REFRESH_TOKEN|google-ads-ro-drak"
    );
  });

  it("GOOGLE_ADS_MCP_WRITE=garbage -> falls back to the read-only item", () => {
    expect(runWithWriteFlag("garbage")).toBe(
      "GOOGLE_ADS_REFRESH_TOKEN|google-ads-ro-drak"
    );
  });

  // The write branch moved OFF google-ads-admin-drak (which holds a token
  // byte-identical to mark@'s own admin login) and onto ads-automation@'s
  // dedicated STANDARD-role credential. That credential was already on the
  // Keychain under a DIFFERENT SERVICE name, so the write branch varies the
  // service as well as the account — asserting the account alone would pass
  // against the wrong item.
  it("GOOGLE_ADS_MCP_WRITE=true -> sources the ads-automation@ item, service and all", () => {
    expect(runWithWriteFlag("true")).toBe(
      "GOOGLE_ADS_REFRESH_TOKEN_AUTOMATION|google-ads-automation"
    );
  });

  it("write branch never resolves to the admin-drak item", () => {
    expect(runWithWriteFlag("true")).not.toContain("google-ads-admin-drak");
  });
});

// ============================================
// Keychain RESOLUTION (integration — real `security`).
// ============================================
// The selection tests above stub `security`, so they assert only which account
// NAME each branch picks. By construction they cannot detect that the named
// account is absent from the Keychain — which is exactly what happened: the RO
// branch shipped pointing at google-ads-ro-drak two days before that item
// existed, all three tests green, and every read-only session died at runtime
// with "[FATAL] GOOGLE_ADS_REFRESH_TOKEN is empty".
//
// This block runs the real script against the REAL `security` binary and
// asserts run-mcp.sh's own fail-fast loop passes for BOTH branches. The `node`
// stub is silent (never echoes the token) so no secret can reach test output.
//
// Local-only by design: run-mcp.sh is Mark's private launcher and the Keychain
// items exist only on his machine.
//
// Gating on "is darwin && has security" was WRONG — GitHub's macos-latest
// runners satisfy both, but their Keychain is empty, so the script fail-fasts
// on the very first lookup (GOOGLE_ADS_DEVELOPER_TOKEN) and the test failed on
// all three macOS jobs. The real prerequisite is "is this the machine whose
// Keychain is supposed to hold these items", which CI never is.
//
// Deliberately NOT gated on whether the items exist. That check would skip
// precisely when the bug this test exists to catch is present — a guard that
// disables itself on failure is worse than no guard.

const IS_LOCAL_DEV_MACHINE =
  !process.env.CI &&
  process.platform === "darwin" &&
  spawnSync("command", ["-v", "security"], { shell: true }).status === 0;

describe.skipIf(!IS_LOCAL_DEV_MACHINE)(
  "run-mcp.sh Keychain accounts resolve to real secrets",
  () => {
    let silentBinDir;

    beforeAll(() => {
      silentBinDir = mkdtempSync(path.join(tmpdir(), "run-mcp-silent-bin-"));
      // Stops the real server from launching. Prints NOTHING — the real
      // GOOGLE_ADS_REFRESH_TOKEN is in this env and must not be echoed.
      writeFileSync(path.join(silentBinDir, "node"), "#!/bin/bash\nexit 0\n");
      chmodSync(path.join(silentBinDir, "node"), 0o755);
    });

    afterAll(() => {
      rmSync(silentBinDir, { recursive: true, force: true });
    });

    function resolveWithWriteFlag(value) {
      const env = { ...process.env, PATH: `${silentBinDir}:${process.env.PATH}` };
      if (value === undefined) {
        delete env.GOOGLE_ADS_MCP_WRITE;
      } else {
        env.GOOGLE_ADS_MCP_WRITE = value;
      }
      const result = spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
      return { status: result.status, stderr: result.stderr ?? "" };
    }

    it("read-only branch: every required credential resolves non-empty", () => {
      const { status, stderr } = resolveWithWriteFlag(undefined);
      expect(stderr).not.toMatch(/\[FATAL\]/);
      expect(status).toBe(0);
    });

    it("write branch: every required credential resolves non-empty", () => {
      const { status, stderr } = resolveWithWriteFlag("true");
      expect(stderr).not.toMatch(/\[FATAL\]/);
      expect(status).toBe(0);
    });
  }
);

// ============================================
// PER-CLIENT refresh tokens.
// ============================================
// Some accounts are not reachable from the default RO/write identities at all
// — they are granted directly to a different Google login, so neither the Drak
// MCC hierarchy nor the manager header helps. src/index.ts handles these via
// ClientConfig.refresh_token_env: config.json names an env var per client, and
// getCustomer() swaps in that token when the customer id matches.
//
// That only works if run-mcp.sh actually EXPORTS the named var. The launcher is
// the sole place these reach the process, so a missing export degrades silently
// — getCustomer() falls back to the default token and the query 403s, which
// looks identical to a permissions problem on the account.
//
// Informian (Tracers + IRBsearch) is the first such client: read access sits on
// mark@drakmarketing.com, whose consent is NOT the google-ads-ro-drak token.

const INFORMIAN_ENV = "GOOGLE_ADS_REFRESH_TOKEN_INFORMIAN";
const INFORMIAN_SERVICE = "GOOGLE_ADS_REFRESH_TOKEN_INFORMIAN";
const INFORMIAN_ACCOUNT = "google-ads-informian";

describe("run-mcp.sh per-client refresh tokens", () => {
  let echoBinDir;

  beforeAll(() => {
    echoBinDir = mkdtempSync(path.join(tmpdir(), "run-mcp-percli-bin-"));

    writeFileSync(
      path.join(echoBinDir, "python3"),
      `#!/bin/bash\necho "${FIXTURE_HELPER}"\n`
    );
    chmodSync(path.join(echoBinDir, "python3"), 0o755);

    // Echo back "service|account" for EVERY lookup, so we can assert exactly
    // which Keychain item each per-client export was asked for.
    writeFileSync(
      path.join(echoBinDir, "security"),
      `#!/bin/bash
account=""
service=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) account="$2"; shift 2;;
    -s) service="$2"; shift 2;;
    *) shift;;
  esac
done
echo "$service|$account"
`
    );
    chmodSync(path.join(echoBinDir, "security"), 0o755);

    writeFileSync(
      path.join(echoBinDir, "node"),
      `#!/bin/bash\necho "${INFORMIAN_ENV}=\${${INFORMIAN_ENV}}"\n`
    );
    chmodSync(path.join(echoBinDir, "node"), 0o755);
  });

  afterAll(() => {
    rmSync(echoBinDir, { recursive: true, force: true });
  });

  function runEcho(writeFlag) {
    const env = { ...process.env, PATH: `${echoBinDir}:${process.env.PATH}` };
    delete env[INFORMIAN_ENV];
    if (writeFlag === undefined) {
      delete env.GOOGLE_ADS_MCP_WRITE;
    } else {
      env.GOOGLE_ADS_MCP_WRITE = writeFlag;
    }
    const result = spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
    return { stdout: (result.stdout ?? "").trim(), stderr: result.stderr ?? "", status: result.status };
  }

  it("exports the Informian token from its own Keychain item (read-only branch)", () => {
    expect(runEcho(undefined).stdout).toBe(
      `${INFORMIAN_ENV}=${INFORMIAN_SERVICE}|${INFORMIAN_ACCOUNT}`
    );
  });

  it("exports the Informian token on the write branch too", () => {
    expect(runEcho("true").stdout).toBe(
      `${INFORMIAN_ENV}=${INFORMIAN_SERVICE}|${INFORMIAN_ACCOUNT}`
    );
  });

  it("does not reuse the default RO item for the Informian token", () => {
    expect(runEcho(undefined).stdout).not.toContain("google-ads-ro-drak");
  });

  // A per-client token is OPTIONAL: an absent item must leave every other
  // client working, not fail-fast the whole launcher. Simulated by a `security`
  // that returns empty for the Informian service only.
  it("a missing Informian item does not trip the fail-fast loop", () => {
    const missingBinDir = mkdtempSync(path.join(tmpdir(), "run-mcp-missing-bin-"));
    writeFileSync(
      path.join(missingBinDir, "python3"),
      `#!/bin/bash\necho "${FIXTURE_HELPER}"\n`
    );
    chmodSync(path.join(missingBinDir, "python3"), 0o755);
    writeFileSync(
      path.join(missingBinDir, "security"),
      `#!/bin/bash
service=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s) service="$2"; shift 2;;
    *) shift;;
  esac
done
if [ "$service" = "${INFORMIAN_SERVICE}" ]; then exit 1; fi
echo "stub-value"
`
    );
    chmodSync(path.join(missingBinDir, "security"), 0o755);
    writeFileSync(path.join(missingBinDir, "node"), "#!/bin/bash\nexit 0\n");
    chmodSync(path.join(missingBinDir, "node"), 0o755);

    const env = { ...process.env, PATH: `${missingBinDir}:${process.env.PATH}` };
    delete env.GOOGLE_ADS_MCP_WRITE;
    const result = spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
    rmSync(missingBinDir, { recursive: true, force: true });

    expect(result.stderr ?? "").not.toMatch(/\[FATAL\]/);
    expect(result.status).toBe(0);
  });
});

// ============================================
// THE JOIN: config.json's refresh_token_env <-> run-mcp.sh's exports.
// ============================================
// Each half is individually correct-looking and they are reviewed separately:
// config.json names an env var, run-mcp.sh exports a set of env vars, and
// nothing checks that the first set is a subset of the second. A typo or a new
// client added to config.json without touching the launcher yields a SILENT
// fallback to the default token — a 403 that reads as an account-permissions
// problem, not as a wiring bug.
//
// config.json is gitignored (local multi-client setup), so this can only run
// where it exists. Skipping when absent is acceptable HERE — the file is the
// input, not the thing under test — but the assertion is unconditional wherever
// it does exist.
describe("config.json refresh_token_env names are exported by run-mcp.sh", () => {
  const CONFIG_PATH = path.join(__dirname, "config.json");
  const hasConfig = existsSync(CONFIG_PATH);

  it.skipIf(!hasConfig)("every refresh_token_env has a matching export line", () => {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    const launcher = readFileSync(SCRIPT, "utf8");

    const named = Object.entries(config.clients ?? {})
      .filter(([, c]) => c.refresh_token_env)
      .map(([key, c]) => [key, c.refresh_token_env]);

    const missing = named.filter(
      ([, envVar]) => !new RegExp(`^\\s*export\\s+${envVar}=`, "m").test(launcher)
    );

    expect(
      missing,
      `config.json names refresh_token_env values that run-mcp.sh never exports: ` +
        missing.map(([k, v]) => `${k} -> ${v}`).join(", ") +
        `. Add an export line to run-mcp.sh, or the client silently falls back ` +
        `to the default token and 403s.`
    ).toEqual([]);
  });
});
