#!/usr/bin/env node
// ============================================
// Verdict logic for the "privatize or scrub mharnett/mcp-google-ads" decision
// task's Acceptance section. Two independent read-only checks feed this:
//
//   Check A (privatize path): `gh repo view mharnett/mcp-google-ads --json visibility`
//   Check B (scrub path):     ancestry check on the commits that carried the
//                              literal secrets (see computeHistoryRewritten)
//                              + scan-history-secrets.mjs
//
// This module only computes the verdict from their results — it never
// calls `gh` or `git` itself, so it stays a pure, unit-testable decision
// table instead of a live-effect script.
// ============================================

export const BASELINE_MAIN_SHA = "a119d358782aac8a8ba3b2a05951088479cda861";

// Commit SHAs identified (2026-08-28 audit) as carrying literal-looking
// secret values in pushed history. A real scrub (force-push rewrite) drops
// these from origin/main's ancestry; an ordinary forward merge does not —
// it only advances the tip SHA while every old commit, these included,
// stays reachable. Do NOT infer "history moved" from tip-SHA drift alone;
// that conflates the two and reports zero remediation progress as partial
// progress (see evaluateComplianceStatus's INCOMPLETE branch below).
export const BASELINE_LITERAL_COMMIT_SHAS = [
  "52c71610b2863e9d756478d7f5b074eb8b92e591",
  "7dbac725c1f2437c28ccc7ed688642f7cea89ea4",
  "a78df84e8e9850ef781812d1894e225453eed9c1",
  "9c64fb330fee670b213e741b184f20f32297b0a5",
  "908c0fe21cff25bd72e05407f840d2227e35c8b8",
  "0f1f098e69d47a3eb274e13b6dcca1d5f9d07fde",
  "4d8300bc3fd68a1baf12634ab93f87a8199bbe9e",
  "c43cdf15205b18b65f102c23019e2e7292d665b1",
  "d2d6c92891685f3909c890737c70d0dac969982d",
  "3ec356d5f117a96e20e8fe13f7a0bfb8b24ac000",
  "ce4f271361ecec95f28c1045d227887aaca43d17",
];

// Derives whether history was genuinely rewritten from real ancestry-check
// results, one per baseline literal commit — e.g. from running
// `git merge-base --is-ancestor <sha> origin/main` for each SHA in
// BASELINE_LITERAL_COMMIT_SHAS and recording true/false per SHA (this
// function stays pure/unit-testable; the caller does the actual `git`
// calls). Returns true only when NONE of the baseline literal commits are
// still reachable from origin/main — i.e. every commit that carried a
// leaked secret was actually dropped by a force-push rewrite, not just
// left behind by an unrelated merge advancing the tip.
export function computeHistoryRewritten(baselineLiteralCommitShas, isAncestorResults) {
  if (!baselineLiteralCommitShas || baselineLiteralCommitShas.length === 0) return false;
  return baselineLiteralCommitShas.every((sha) => isAncestorResults[sha] === false);
}

// Returns one of:
//   "PASS"       — privatized, or scrubbed (historyRewritten) with the
//                  scanner at literal:0
//   "FAIL"       — neither path executed: still public AND history was
//                  never actually rewritten (regardless of tip-SHA drift
//                  from unrelated merges)
//   "INCOMPLETE" — history was genuinely rewritten but literals remain
export function evaluateComplianceStatus({ visibility, historyRewritten, literalCount }) {
  if (visibility === "PRIVATE") return "PASS";

  if (historyRewritten && literalCount === 0) return "PASS";
  if (!historyRewritten) return "FAIL";
  return "INCOMPLETE";
}
