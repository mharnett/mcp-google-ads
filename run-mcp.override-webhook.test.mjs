// ============================================
// run-mcp.sh override-webhook wiring.
// ============================================
// run-mcp.sh exports GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL from the Keychain
// item (SLACK_WEBHOOK_DRAK_AUTOMATION, drak-ops) so confirm_large_change
// overrides post to the Drak automation Slack channel (src/overrideLog.ts).
// The webhook is optional: a Keychain miss must leave the variable empty and
// still launch the server, never fail startup.
//
// Same stub-PATH approach as run-mcp.wrapper.test.mjs: a fake `security`
// echoes "service|account" for the webhook item (or misses with exit 44),
// and a fake `node` prints the resulting env var instead of starting a server.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "run-mcp.sh");
const FIXTURE_HELPER = path.join(__dirname, "tests", "fixtures", "keychain_get.sh");

let binDir;

beforeAll(() => {
  binDir = mkdtempSync(path.join(tmpdir(), "run-mcp-webhook-stub-bin-"));
  writeFileSync(path.join(binDir, "python3"), `#!/bin/bash\necho "${FIXTURE_HELPER}"\n`);
  writeFileSync(
    path.join(binDir, "security"),
    `#!/bin/bash
account=""; service=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) account="$2"; shift 2;;
    -s) service="$2"; shift 2;;
    *) shift;;
  esac
done
if [ "$service" = "SLACK_WEBHOOK_DRAK_AUTOMATION" ]; then
  [ "$WEBHOOK_MISS" = "1" ] && exit 44
  echo "$service|$account"
else
  echo "stub-value"
fi
`
  );
  writeFileSync(path.join(binDir, "node"), `#!/bin/bash\necho "webhook=[$GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL]"\n`);
  for (const f of ["python3", "security", "node"]) chmodSync(path.join(binDir, f), 0o755);
});

afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
});

function run(extraEnv = {}) {
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...extraEnv };
  delete env.GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL;
  return spawnSync("bash", [SCRIPT], { env, encoding: "utf8" });
}

describe("run-mcp.sh override webhook", () => {
  it("exports the webhook from the SLACK_WEBHOOK_DRAK_AUTOMATION / drak-ops Keychain item", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("webhook=[SLACK_WEBHOOK_DRAK_AUTOMATION|drak-ops]");
  });

  it("a Keychain miss leaves the webhook empty and still launches the server", () => {
    const r = run({ WEBHOOK_MISS: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("webhook=[]");
  });
});
