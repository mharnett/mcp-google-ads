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
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "run-mcp.sh");

let binDir;

beforeAll(() => {
  binDir = mkdtempSync(path.join(tmpdir(), "run-mcp-stub-bin-"));

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
if [ "$service" = "GOOGLE_ADS_REFRESH_TOKEN" ]; then
  echo "$account"
else
  echo "stub-value"
fi
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

describe("run-mcp.sh Keychain account selection", () => {
  it("GOOGLE_ADS_MCP_WRITE unset -> sources the read-only account", () => {
    expect(runWithWriteFlag(undefined)).toBe("google-ads-ro-drak");
  });

  it("GOOGLE_ADS_MCP_WRITE=garbage -> falls back to the read-only account", () => {
    expect(runWithWriteFlag("garbage")).toBe("google-ads-ro-drak");
  });

  it("GOOGLE_ADS_MCP_WRITE=true -> sources the admin account", () => {
    expect(runWithWriteFlag("true")).toBe("google-ads-admin-drak");
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
// items exist only on his machine, so this skips off-darwin / without
// `security`. The skip is loud — it must never read as a pass.

const HAS_KEYCHAIN =
  process.platform === "darwin" &&
  spawnSync("command", ["-v", "security"], { shell: true }).status === 0;

describe.skipIf(!HAS_KEYCHAIN)(
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
