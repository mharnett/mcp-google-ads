// ============================================
// BUILD-TIME INJECTED SECRETS
// ============================================
// These `process.env.*` references are replaced by esbuild --define at
// build time with literal string values pulled from the build environment.
//
// In source (dev mode via tsx), process.env lookups return whatever is in
// the runtime environment — usually empty, in which case the package falls
// back to runtime GOOGLE_ADS_* env vars (see src/credentials.ts).
//
// In compiled dist/, these become literal strings baked into the JS.
// Users installing via `npx mcp-google-ads` get the baked-in values with
// no configuration required on their end.
//
// SECURITY: Google Desktop OAuth client ID/secret are NOT true secrets —
// Google's own docs acknowledge they are embedded in distributed apps.
// The developer token IS somewhat sensitive but is scoped to the API Center
// it was issued for; without a valid refresh token for an authorized Google
// account, it cannot be used to access any Google Ads data.

export const EMBEDDED_CLIENT_ID: string = process.env.EMBEDDED_CLIENT_ID || "";
export const EMBEDDED_CLIENT_SECRET: string = process.env.EMBEDDED_CLIENT_SECRET || "";
export const EMBEDDED_DEVELOPER_TOKEN: string = process.env.EMBEDDED_DEVELOPER_TOKEN || "";

export function hasEmbeddedSecrets(): boolean {
  return (
    EMBEDDED_CLIENT_ID.length > 10 &&
    EMBEDDED_CLIENT_SECRET.length > 10 &&
    EMBEDDED_DEVELOPER_TOKEN.length > 10
  );
}
