/**
 * Opt-in for tests that run the real `security` binary and so read real
 * credentials from the login Keychain. A plain `npm test` must read none:
 *
 *   MCP_GOOGLE_ADS_TEST_REAL_KEYCHAIN=1 npx vitest run run-mcp.wrapper.test.mjs
 */
export const REAL_KEYCHAIN_ENV_VAR = "MCP_GOOGLE_ADS_TEST_REAL_KEYCHAIN";

export const realKeychainTestsEnabled = (env, platform) => platform === "darwin" && env[REAL_KEYCHAIN_ENV_VAR] === "1";
