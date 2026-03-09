#!/bin/bash
# Wrapper to launch Google Ads MCP with tokens from Keychain
export GOOGLE_ADS_DEVELOPER_TOKEN=xQjWTuRLCJ_1UFpX1xLWlA
export GOOGLE_ADS_CLIENT_ID=557294086068-o7rb5neg65g28uf65j85q0h60cop40j9.apps.googleusercontent.com
export GOOGLE_ADS_CLIENT_SECRET=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
export GOOGLE_ADS_REFRESH_TOKEN=$(security find-generic-password -a google-ads-drak -s GOOGLE_ADS_REFRESH_TOKEN -w 2>/dev/null)
export GOOGLE_ADS_REFRESH_TOKEN_FLOWSPACE=$(security find-generic-password -a google-ads-flowspace -s GOOGLE_ADS_REFRESH_TOKEN_FLOWSPACE -w 2>/dev/null)

# Fail fast if Keychain lookup returned empty
if [ -z "$GOOGLE_ADS_REFRESH_TOKEN" ]; then
  echo "[FATAL] GOOGLE_ADS_REFRESH_TOKEN is empty — Keychain lookup failed." >&2
  echo "  Fix: security add-generic-password -a google-ads-drak -s GOOGLE_ADS_REFRESH_TOKEN -w 'YOUR_TOKEN'" >&2
  exit 1
fi

exec node /Users/mark/claude-code/mcps/mcp-google-ads/dist/index.js
