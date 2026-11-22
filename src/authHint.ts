// What a GoogleAdsAuthError response tells the user to do.
//
// A launcher that reads the refresh token from the macOS Keychain (this
// repo's run-mcp.sh) exports the item it read as
// GOOGLE_ADS_REFRESH_TOKEN_SERVICE and GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT, so
// the hint names that item rather than a fixed one. Without both, the token
// came from somewhere else (env var, stored credentials) and the hint is
// generic. The suggested `security` command omits `-w`: it confirms the item
// exists without printing the token.

/** Characters a Keychain service or account name may have here; anything else is not echoed. */
const SAFE_NAME = /^[A-Za-z0-9._@-]+$/;

export function authErrorHint(env: Record<string, string | undefined> = process.env): {
  action_required: string;
  hint: string;
} {
  const service = env.GOOGLE_ADS_REFRESH_TOKEN_SERVICE ?? "";
  const account = env.GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT ?? "";
  if (SAFE_NAME.test(service) && SAFE_NAME.test(account)) {
    return {
      action_required: "Re-authenticate: the refresh token from the macOS Keychain was rejected. It may be expired or revoked.",
      hint:
        `The server read Keychain item service ${service}, account ${account}. ` +
        `Check it exists: security find-generic-password -s ${service} -a ${account} ` +
        "(shows the item, not the token). Store a fresh token under that item, then restart the server.",
    };
  }
  return {
    action_required: "Re-authenticate: the refresh token was rejected. It may be expired or revoked.",
    hint:
      "Run npx mcp-google-ads-auth to re-authorize, or set GOOGLE_ADS_REFRESH_TOKEN to a fresh token, then restart the server. " +
      "npx mcp-google-ads-doctor checks the credentials.",
  };
}
