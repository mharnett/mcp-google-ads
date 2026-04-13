#!/usr/bin/env bash
# ============================================
# release.sh  —  local npm publish with Keychain-sourced OAuth creds
# ============================================
# Builds + publishes mcp-google-ads to npm with the OAuth client ID, client
# secret, and Google Ads developer token pulled from macOS Keychain and
# injected into dist/ at build time via esbuild --define.
#
# This is the Mac-local alternative to the GitHub Actions publish workflow
# (.github/workflows/publish.yml), which reads the same values from GitHub
# repository secrets.
#
# Usage:
#   ./scripts/release.sh [--dry-run]
#
# Prerequisites (one-time setup on this Mac):
#   security add-generic-password -a google-ads-mcp -s GOOGLE_ADS_CLIENT_ID     -w "<value>"
#   security add-generic-password -a google-ads-mcp -s GOOGLE_ADS_CLIENT_SECRET -w "<value>"
#   security add-generic-password -a google-ads-mcp -s GOOGLE_ADS_DEVELOPER_TOKEN -w "<value>"
#   npm login   (must be run once so `npm publish` has a valid token)

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

KEYCHAIN_ACCOUNT="google-ads-mcp"

lookup() {
  local service="$1"
  local value
  if ! value=$(security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${service}" -w 2>/dev/null); then
    echo "❌ Keychain entry missing: service=${service}, account=${KEYCHAIN_ACCOUNT}" >&2
    echo "   Add with: security add-generic-password -a ${KEYCHAIN_ACCOUNT} -s ${service} -w '<value>'" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

echo "==> Pulling OAuth credentials from macOS Keychain..."
EMBEDDED_CLIENT_ID="$(lookup GOOGLE_ADS_CLIENT_ID)"
EMBEDDED_CLIENT_SECRET="$(lookup GOOGLE_ADS_CLIENT_SECRET)"
EMBEDDED_DEVELOPER_TOKEN="$(lookup GOOGLE_ADS_DEVELOPER_TOKEN)"
export EMBEDDED_CLIENT_ID EMBEDDED_CLIENT_SECRET EMBEDDED_DEVELOPER_TOKEN

echo "==> Running npm ci..."
npm ci

echo "==> Running full test suite (including portability checks)..."
npm test

echo "==> Building with embedded credentials (esbuild --define)..."
npm run build

echo "==> Verifying embedded-secrets.js contains baked-in values..."
if grep -q '""' dist/embedded-secrets.js 2>/dev/null && \
   ! grep -q "EMBEDDED_CLIENT_ID = \"557" dist/embedded-secrets.js 2>/dev/null; then
  echo "⚠️  Warning: dist/embedded-secrets.js appears to contain empty strings."
  echo "    Inspect manually:"
  echo "      cat dist/embedded-secrets.js"
fi

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "==> Dry run: skipping npm publish"
  echo "    Build artifacts ready in dist/"
  echo "    To actually publish: rerun without --dry-run"
  exit 0
fi

echo "==> Publishing to npm (public)..."
# --provenance only works from CI providers with OIDC (e.g. GitHub Actions).
# Local Mac publishes can't generate provenance; omit the flag to succeed.
npm publish --access public

echo "✅ Published."
