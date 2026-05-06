#!/usr/bin/env node
import { run } from "mcp-google-ads/doctor-cli";

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`\n❌ ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  });
