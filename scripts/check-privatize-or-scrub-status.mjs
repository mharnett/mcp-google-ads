#!/usr/bin/env node
// ============================================
// Verdict logic for the "privatize or scrub mharnett/mcp-google-ads" decision
// task's Acceptance section. Two independent read-only checks feed this:
//
//   Check A (privatize path): `gh repo view mharnett/mcp-google-ads --json visibility`
//   Check B (scrub path):     `git ... rev-parse origin/main` + scan-history-secrets.mjs
//
// This module only computes the verdict from their results — it never
// calls `gh` or `git` itself, so it stays a pure, unit-testable decision
// table instead of a live-effect script.
// ============================================

export const BASELINE_MAIN_SHA = "a119d358782aac8a8ba3b2a05951088479cda861";

// Returns one of:
//   "PASS"       — privatized, or scrubbed with the scanner at literal:0
//   "FAIL"       — neither path executed (still public, still at baseline)
//   "INCOMPLETE" — some progress (history moved, or literals dropped) but
//                  the pass conditions aren't fully met yet
export function evaluateComplianceStatus({ visibility, originMainSha, literalCount, baselineSha = BASELINE_MAIN_SHA }) {
  if (visibility === "PRIVATE") return "PASS";

  const historyMoved = originMainSha != null && originMainSha !== baselineSha;

  if (historyMoved && literalCount === 0) return "PASS";
  if (!historyMoved && literalCount > 0) return "FAIL";
  return "INCOMPLETE";
}
