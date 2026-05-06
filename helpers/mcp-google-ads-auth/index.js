#!/usr/bin/env node
// Thin delegating wrapper so `npx mcp-google-ads-auth` resolves as a package
// name. The real logic lives in mcp-google-ads/dist/auth-cli.js — this file
// imports its `run` export and invokes it directly, bypassing any entry-point
// detection. That insulates us from earlier isMain / symlink bugs and keeps
// the stub trivially small.

import { run } from "mcp-google-ads/auth-cli";

run().catch((err) => {
  process.stderr.write(`\n❌ ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
