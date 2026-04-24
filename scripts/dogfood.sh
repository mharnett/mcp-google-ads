#!/usr/bin/env bash
# ============================================
# dogfood.sh  —  pre-release smoke test against a real install
# ============================================
# Builds the package, packs a tarball, installs it in a throwaway sandbox,
# and invokes every published bin to prove they launch without import-time
# errors. This is the gap `npm test` doesn't cover: `npm test` runs the
# source tree, but teammates install the PACKAGED tarball — esbuild output,
# embedded secrets, file-glob patterns, Node resolution rules, shebang
# lines, and all. Bugs that only surface post-pack slip through unit tests
# and blow up on the teammate's machine (a.k.a. "the Kellie incident").
#
# Run this manually before ./scripts/release.sh so you catch packaging
# regressions locally, not in a teammate's Slack DM.
#
# Usage:
#   ./scripts/dogfood.sh
#
# Exit codes:
#   0  all checks passed; safe to release
#   1  a check failed; do NOT release
#
# What this does NOT cover (still manual):
#   - Full Claude Desktop integration (no headless MCP harness)
#   - OAuth flow (requires browser interaction)
#   - Real Google Ads API calls (requires valid creds)
# For those, follow up with a manual Claude Desktop session against the
# packed tarball installed globally.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# Colored status output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1" >&2; }
info() { printf "${YELLOW}→${NC} %s\n" "$1"; }

# Sandbox lives in the system temp dir so nothing leaks into the repo.
SANDBOX="$(mktemp -d -t mcp-google-ads-dogfood-XXXXXX)"
trap "rm -rf '${SANDBOX}'" EXIT

info "Sandbox: ${SANDBOX}"

# ----- 1. Clean build --------------------------------------------------
info "Clean build (npm run build)..."
rm -rf dist
npm run build >/dev/null
if [[ ! -f dist/index.js ]]; then
  fail "dist/index.js missing after build"
  exit 1
fi
ok "build produced dist/"

# ----- 2. Unit tests ---------------------------------------------------
info "Unit tests (npm test)..."
if ! npm test >/dev/null 2>&1; then
  fail "npm test failed — fix before dogfooding"
  exit 1
fi
ok "unit tests pass"

# ----- 3. Pack tarball -------------------------------------------------
info "Pack tarball (npm pack)..."
TARBALL_NAME="$(npm pack --silent)"
TARBALL_PATH="${REPO_ROOT}/${TARBALL_NAME}"
if [[ ! -f "${TARBALL_PATH}" ]]; then
  fail "npm pack did not produce ${TARBALL_NAME}"
  exit 1
fi
# Clean up tarball on exit too
trap "rm -rf '${SANDBOX}' '${TARBALL_PATH}'" EXIT
ok "packed ${TARBALL_NAME}"

# ----- 4. Install into sandbox ----------------------------------------
info "Install tarball into sandbox..."
pushd "${SANDBOX}" >/dev/null
npm init -y >/dev/null
if ! npm install "${TARBALL_PATH}" >/dev/null 2>&1; then
  fail "tarball install failed — check package.json files[] glob"
  exit 1
fi
popd >/dev/null
ok "tarball installed cleanly"

# ----- 5. Each bin launches -------------------------------------------
# Every bin entry in package.json must start and exit cleanly when asked
# for help. This catches shebang issues, missing shebangs, missing
# executable bit, import-time crashes, and ESM resolution failures.
BINS=(
  "mcp-google-ads-auth"
  "mcp-google-ads-install"
  "mcp-google-ads-doctor"
)

for bin in "${BINS[@]}"; do
  info "Launching ${bin}..."
  # Doctor has no --help but runs to completion with no args.
  # Auth + install support --help.
  if [[ "${bin}" == "mcp-google-ads-doctor" ]]; then
    # Doctor may exit non-zero if the user has no config yet (expected on
    # a fresh sandbox). We only care that it prints SOMETHING and didn't
    # crash at import time.
    output="$(cd "${SANDBOX}" && node "node_modules/.bin/${bin}" 2>&1 || true)"
    if [[ -z "${output}" ]]; then
      fail "${bin} produced no output — probable import-time crash"
      exit 1
    fi
    # Import-time crashes show up as a Node stack trace on line 1. Real
    # doctor output starts with "mcp-google-ads doctor" or similar check
    # names. Heuristic: fail if Node error markers appear AT THE TOP.
    first_line="$(echo "${output}" | head -1)"
    if echo "${first_line}" | grep -qiE "^(Error|SyntaxError|TypeError|ReferenceError|MODULE_NOT_FOUND)"; then
      fail "${bin} crashed at launch:"
      echo "${output}" >&2
      exit 1
    fi
    ok "${bin} ran to completion"
  else
    # --help bins should exit 0.
    if ! (cd "${SANDBOX}" && node "node_modules/.bin/${bin}" --help >/dev/null 2>&1); then
      fail "${bin} --help failed"
      cd "${SANDBOX}" && node "node_modules/.bin/${bin}" --help || true
      exit 1
    fi
    ok "${bin} --help exited 0"
  fi
done

# ----- 6. MCP server responds to a list_tools JSON-RPC request --------
# The MCP server speaks JSON-RPC over stdio (line-delimited). Bash pipes
# are unreliable for bidirectional stdio — Node may not flush before the
# pipe closes — so we spawn from a small Node helper that can hold stdin
# open and read the response cleanly.
info "MCP server responds to list_tools..."

MCP_BIN="${SANDBOX}/node_modules/.bin/mcp-google-ads"
# Write the helper to the sandbox so it can require the installed tarball
# (we don't actually need to import anything, just child_process).
cat > "${SANDBOX}/mcp_probe.mjs" <<'PROBE_EOF'
import { spawn } from "node:child_process";

const bin = process.argv[2];
// Server requires client_id / client_secret / developer_token — normally
// injected at build time via release.sh's esbuild --define. For dogfood
// against a plain `npm run build`, inject test values via env. We never
// authenticate (tools/list is pre-auth), so the values can be stubs.
const env = {
  ...process.env,
  GOOGLE_ADS_CLIENT_ID: "dogfood-stub-client-id.apps.googleusercontent.com",
  GOOGLE_ADS_CLIENT_SECRET: "dogfood-stub-client-secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dogfood-stub-developer-token",
};
const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"], env });

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => { stdout += d.toString(); });
child.stderr.on("data", (d) => { stderr += d.toString(); });
child.on("error", (e) => { stderr += `spawn error: ${e.message}\n`; });

const initReq = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {},
            clientInfo: { name: "dogfood", version: "0.0.0" } },
});
const listReq = JSON.stringify({
  jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
});

child.stdin.write(initReq + "\n");
setTimeout(() => child.stdin.write(listReq + "\n"), 200);

// Give the server 3 seconds to respond; then dump what we saw and exit.
setTimeout(() => {
  child.kill();
  if (!stdout.includes("google_ads_get_client_context")) {
    process.stderr.write("=== STDOUT ===\n" + stdout + "\n=== STDERR ===\n" + stderr + "\n");
    process.exit(1);
  }
  process.stdout.write(stdout);
  process.exit(0);
}, 3000);
PROBE_EOF

if ! node "${SANDBOX}/mcp_probe.mjs" "${MCP_BIN}" >"${SANDBOX}/mcp_probe.out" 2>&1; then
  fail "MCP server did not advertise google_ads_get_client_context in list_tools response"
  echo "--- first 20 lines of server output ---" >&2
  head -20 "${SANDBOX}/mcp_probe.out" >&2
  exit 1
fi
ok "MCP server advertises tools correctly"

# ----- Done ------------------------------------------------------------
echo
ok "Dogfood complete — tarball is safe to release."
echo "Next: ./scripts/release.sh"
