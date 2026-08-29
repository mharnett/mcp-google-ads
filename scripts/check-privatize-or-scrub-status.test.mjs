// ============================================
// Unit tests for evaluateComplianceStatus (scripts/check-privatize-or-scrub-status.mjs).
//
// Context: the "privatize or scrub" decision task can't be verified by a
// single boolean — the Acceptance section defines two independent pass
// routes (repo went PRIVATE, or history was scrubbed AND the scanner shows
// zero literals) plus an explicit "neither path executed" failure shape.
// These tests pin down that decision table so a human (or the trusted
// poller) can run the two read-only Acceptance checks (`gh repo view
// --json visibility` and `scan-history-secrets.mjs`) and get an
// unambiguous verdict back, without re-deriving the rules by hand.
//
// `historyRewritten` must come from an ancestry check (are the commits
// that carried the literal secrets still reachable from origin/main?),
// NOT from a bare tip-SHA comparison — an ordinary forward merge moves the
// tip SHA without removing anything, and treating that as "history moved"
// mislabels zero remediation progress as partial progress. See
// computeHistoryRewritten below for how a caller derives that boolean from
// real `git merge-base --is-ancestor` results.
// ============================================

import { describe, it, expect } from "vitest";
import {
  evaluateComplianceStatus,
  computeHistoryRewritten,
  BASELINE_MAIN_SHA,
  BASELINE_LITERAL_COMMIT_SHAS,
} from "./check-privatize-or-scrub-status.mjs";

describe("evaluateComplianceStatus", () => {
  it("passes when the repo visibility is PRIVATE, regardless of history state", () => {
    const result = evaluateComplianceStatus({
      visibility: "PRIVATE",
      historyRewritten: false,
      literalCount: 15,
    });
    expect(result).toBe("PASS");
  });

  it("passes when history was rewritten and the scanner reports zero literals", () => {
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      historyRewritten: true,
      literalCount: 0,
    });
    expect(result).toBe("PASS");
  });

  it("fails when visibility is still PUBLIC and history was never rewritten", () => {
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      historyRewritten: false,
      literalCount: 15,
    });
    expect(result).toBe("FAIL");
  });

  it("fails — not INCOMPLETE — when an unrelated commit lands after baseline but the known literal-bearing commits are still in ancestry (ordinary merge, zero remediation)", () => {
    // This is the exact bug: a naive `originMainSha !== baselineSha` check
    // would see the tip move and call this "history moved" -> INCOMPLETE.
    // Nothing was actually scrubbed, so it must be FAIL.
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      historyRewritten: false, // ancestry check found the old literal commits still reachable
      literalCount: 15,
    });
    expect(result).toBe("FAIL");
  });

  it("reports incomplete when history was genuinely rewritten but literals remain (scrub started, not finished)", () => {
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      historyRewritten: true,
      literalCount: 3,
    });
    expect(result).toBe("INCOMPLETE");
  });

  it("exposes today's baseline main SHA (a119d358782aac8a8ba3b2a05951088479cda861) as a named constant", () => {
    expect(BASELINE_MAIN_SHA).toBe("a119d358782aac8a8ba3b2a05951088479cda861");
  });
});

describe("computeHistoryRewritten", () => {
  it("returns false when every baseline literal commit is still an ancestor of origin/main (ordinary forward merge)", () => {
    const result = computeHistoryRewritten(BASELINE_LITERAL_COMMIT_SHAS, {
      [BASELINE_LITERAL_COMMIT_SHAS[0]]: true,
      [BASELINE_LITERAL_COMMIT_SHAS[1]]: true,
    });
    expect(result).toBe(false);
  });

  it("returns false when only SOME baseline literal commits were dropped (partial/incomplete rewrite)", () => {
    const isAncestorResults = Object.fromEntries(BASELINE_LITERAL_COMMIT_SHAS.map((sha) => [sha, false]));
    isAncestorResults[BASELINE_LITERAL_COMMIT_SHAS[0]] = true; // one commit still reachable
    const result = computeHistoryRewritten(BASELINE_LITERAL_COMMIT_SHAS, isAncestorResults);
    expect(result).toBe(false);
  });

  it("returns true only when NONE of the baseline literal commits are reachable from origin/main anymore", () => {
    const isAncestorResults = Object.fromEntries(BASELINE_LITERAL_COMMIT_SHAS.map((sha) => [sha, false]));
    const result = computeHistoryRewritten(BASELINE_LITERAL_COMMIT_SHAS, isAncestorResults);
    expect(result).toBe(true);
  });

  it("returns false (fail-closed) when given an empty baseline commit list — never claim a rewrite happened with nothing to check", () => {
    expect(computeHistoryRewritten([], {})).toBe(false);
  });
});
