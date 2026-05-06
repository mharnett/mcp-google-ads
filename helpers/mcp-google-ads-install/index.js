#!/usr/bin/env node
import { run } from "mcp-google-ads/install-cli";

run().catch((err) => {
  process.stderr.write(`\n❌ ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
