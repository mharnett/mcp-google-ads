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
// Users installing via `npx mcp-google-ads` get the baked-in OAuth client
// without configuring one.
//
// SECURITY: Google Desktop OAuth client ID/secret are NOT true secrets —
// Google's own docs acknowledge they are embedded in distributed apps.
// Nothing else is embedded: the developer token comes from the user's own
// GOOGLE_ADS_DEVELOPER_TOKEN (scripts/build.embedded.test.mjs).

export const EMBEDDED_CLIENT_ID: string = process.env.EMBEDDED_CLIENT_ID || "";
export const EMBEDDED_CLIENT_SECRET: string = process.env.EMBEDDED_CLIENT_SECRET || "";

export function hasEmbeddedSecrets(): boolean {
  return EMBEDDED_CLIENT_ID.length > 10 && EMBEDDED_CLIENT_SECRET.length > 10;
}
