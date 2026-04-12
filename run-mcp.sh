#!/bin/bash
# Wrapper to launch Google Ads MCP with ALL credentials from Keychain.
# Never put tokens, client IDs, or secrets in this file — it is tracked in git.
export GOOGLE_ADS_DEVELOPER_TOKEN=$(security find-generic-password -a google-ads-mcp -s GOOGLE_ADS_DEVELOPER_TOKEN -w 2>/dev/null)
export GOOGLE_ADS_CLIENT_ID=$(security find-generic-password -a google-ads-mcp -s GOOGLE_ADS_CLIENT_ID -w 2>/dev/null)
export GOOGLE_ADS_CLIENT_SECRET=$(security find-generic-password -a google-ads-mcp -s GOOGLE_ADS_CLIENT_SECRET -w 2>/dev/null)
export GOOGLE_ADS_REFRESH_TOKEN=$(security find-generic-password -a google-ads-drak -s GOOGLE_ADS_REFRESH_TOKEN -w 2>/dev/null)
export GOOGLE_ADS_REFRESH_TOKEN_FLOWSPACE=$(security find-generic-password -a google-ads-flowspace -s GOOGLE_ADS_REFRESH_TOKEN_FLOWSPACE -w 2>/dev/null)

# Fail fast if any required Keychain lookup returned empty
for var in GOOGLE_ADS_DEVELOPER_TOKEN GOOGLE_ADS_CLIENT_ID GOOGLE_ADS_CLIENT_SECRET GOOGLE_ADS_REFRESH_TOKEN; do
  if [ -z "${!var}" ]; then
    echo "[FATAL] $var is empty — Keychain lookup failed." >&2
    echo "  Fix: security add-generic-password -U -a google-ads-mcp -s $var -w 'YOUR_VALUE'" >&2
    exit 1
  fi
done

exec node /Users/mark/claude-code/mcps/mcp-google-ads/dist/index.js
