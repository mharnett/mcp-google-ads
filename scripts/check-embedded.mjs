#!/usr/bin/env node
// Abort `npm publish` if the required embedded OAuth creds aren't set in env.
// scripts/release.sh (or the GitHub Actions publish workflow) populates these
// from Keychain / repo secrets before invoking npm. A bare `npm publish` from
// a plain shell has none set, and would ship a build that refuses to auth
// with "This build of mcp-google-ads was published without embedded OAuth
// credentials." (v1.2.1 accident). Fail fast before esbuild --define can
// bake in empty strings.

const required = ["EMBEDDED_CLIENT_ID", "EMBEDDED_CLIENT_SECRET", "EMBEDDED_DEVELOPER_TOKEN"];
const missing = required.filter((k) => !process.env[k]);

if (missing.length > 0) {
  process.stderr.write(
    [
      "",
      "❌ Refusing to publish without embedded OAuth credentials.",
      "",
      "Missing env vars: " + missing.join(", "),
      "",
      "To publish correctly, run:",
      "    ./scripts/release.sh",
      "",
      "That pulls the values from macOS Keychain (service=google-ads-mcp) and",
      "injects them via esbuild --define. See scripts/release.sh for one-time",
      "Keychain setup.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write("✓ Embedded credential env vars present.\n");
