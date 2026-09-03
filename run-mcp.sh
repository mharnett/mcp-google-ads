#!/bin/bash
# Wrapper to launch Google Ads MCP with ALL credentials from Keychain.
# Never put tokens, client IDs, or secrets in this file — it is tracked in git.
#
# Shared Keychain helper (drak-ops): resolves through the installed package
# location, not a vendored copy — see drak_ops.keychain.keychain_shell_helper_path().
HELPER="$(python3 -c 'from drak_ops.keychain import keychain_shell_helper_path as p; print(p())')"
source "$HELPER"

export GOOGLE_ADS_DEVELOPER_TOKEN=$(keychain_get "GOOGLE_ADS_DEVELOPER_TOKEN" "google-ads-mcp" 2>/dev/null)
export GOOGLE_ADS_CLIENT_ID=$(keychain_get "GOOGLE_ADS_CLIENT_ID" "google-ads-mcp" 2>/dev/null)
export GOOGLE_ADS_CLIENT_SECRET=$(keychain_get "GOOGLE_ADS_CLIENT_SECRET" "google-ads-mcp" 2>/dev/null)
if [ "$GOOGLE_ADS_MCP_WRITE" = "true" ]; then
  GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT=google-ads-admin-drak
else
  GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT=google-ads-ro-drak
fi
export GOOGLE_ADS_REFRESH_TOKEN=$(keychain_get "GOOGLE_ADS_REFRESH_TOKEN" "$GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT" 2>/dev/null)
export GOOGLE_ADS_REFRESH_TOKEN_FLOWSPACE=$(keychain_get "GOOGLE_ADS_REFRESH_TOKEN_FLOWSPACE" "google-ads-flowspace" 2>/dev/null)

# Fail fast if any required Keychain lookup returned empty
for var in GOOGLE_ADS_DEVELOPER_TOKEN GOOGLE_ADS_CLIENT_ID GOOGLE_ADS_CLIENT_SECRET GOOGLE_ADS_REFRESH_TOKEN; do
  if [ -z "${!var}" ]; then
    echo "[FATAL] $var is empty — Keychain lookup failed." >&2
    echo "  Fix: security add-generic-password -U -a google-ads-mcp -s $var -w 'YOUR_VALUE'" >&2
    exit 1
  fi
done

exec node /Users/mark/claude-code/mcps/mcp-google-ads/dist/index.js
