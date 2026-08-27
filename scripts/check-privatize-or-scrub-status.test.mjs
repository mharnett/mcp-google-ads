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
// ============================================

import { describe, it, expect } from "vitest";
import { evaluateComplianceStatus, BASELINE_MAIN_SHA } from "./check-privatize-or-scrub-status.mjs";

describe("evaluateComplianceStatus", () => {
  it("passes when the repo visibility is PRIVATE, regardless of history state", () => {
    const result = evaluateComplianceStatus({
      visibility: "PRIVATE",
      originMainSha: BASELINE_MAIN_SHA,
      literalCount: 15,
    });
    expect(result).toBe("PASS");
  });

  it("passes when origin/main has moved off baseline and the scanner reports zero literals", () => {
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      originMainSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      literalCount: 0,
    });
    expect(result).toBe("PASS");
  });

  it("fails when visibility is still PUBLIC and origin/main is unchanged at the baseline SHA", () => {
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      originMainSha: BASELINE_MAIN_SHA,
      literalCount: 15,
    });
    expect(result).toBe("FAIL");
  });

  it("reports incomplete when history moved but literals remain (scrub started, not finished)", () => {
    const result = evaluateComplianceStatus({
      visibility: "PUBLIC",
      originMainSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      literalCount: 3,
    });
    expect(result).toBe("INCOMPLETE");
  });

  it("exposes today's baseline main SHA (a119d358782aac8a8ba3b2a05951088479cda861) as a named constant", () => {
    expect(BASELINE_MAIN_SHA).toBe("a119d358782aac8a8ba3b2a05951088479cda861");
  });
});
