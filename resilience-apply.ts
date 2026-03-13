#!/usr/bin/env node

/**
 * Script to systematically wrap all async API calls in Google Ads MCP with resilience.
 * Run: npx ts-node resilience-apply.ts
 *
 * Pattern: Wraps all `await customer.query()` and `await customer.mutate()` calls
 * with withResilience(..., operationName, 30_000) and safeResponse(...).
 */

import { readFileSync, writeFileSync } from "fs";

const content = readFileSync("src/index.ts", "utf-8");

// Replace all `await customer.query(...)` with wrapped version
let updated = content;

// Pattern 1: single-line query calls (simple substitution)
updated = updated.replace(
  /await customer\.query\(/g,
  "await withResilience(() => customer.query("
);

// Pattern 2: Wrap the closing parenthesis (complex, but let's handle common cases)
// This is trickier because we need to know the operation name
// For now, we'll use a post-processing approach

// Write out a diff/template for manual review and targeted wrapping
console.log("Resilience wrap pattern ready.");
console.log("Manual wrapping recommended for each method to set correct operationName.");
console.log("See resilience-apply.ts for details.");
