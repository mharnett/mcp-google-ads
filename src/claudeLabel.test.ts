import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  isValidClaudeLabel,
  claudeAuditLabel,
  AUTO_CLAUDE_LABEL_RE,
} from "./claudeLabel.js";

// GLOBAL rule: every Claude-created/edited Google Ads entity is stamped with an
// audit label so a batch can be found and rolled back. Canonical format
// (locked 2026-07-23): `claude-MM-DD-YY` optionally followed by a kebab-case
// description — `claude-MM-DD-YY-<desc>`. The `claude-` prefix keeps the
// `label.name LIKE 'claude-%'` rollback filter working; the date lets a day's
// batch be isolated; the description says what the change was.
//
// Not every entity can carry a label — only campaigns, ad groups, ad group
// ads and ad group criteria have a label surface (budgets, campaign criteria,
// negative ad group criteria, shared sets and assets do NOT). This module
// governs the label STRING; which entity each tool labels is pinned at the
// dispatch in claudeLabel.callSite.test.ts.
describe("isValidClaudeLabel", () => {
  it("accepts the bare dated form", () => {
    expect(isValidClaudeLabel("claude-07-23-26")).toBe(true);
  });

  it("accepts a kebab-case description suffix", () => {
    expect(isValidClaudeLabel("claude-07-23-26-brand-cpa-fix")).toBe(true);
  });

  it("rejects a missing claude- prefix", () => {
    expect(isValidClaudeLabel("07-23-26-brand-cpa-fix")).toBe(false);
  });

  it("rejects a 4-digit year", () => {
    expect(isValidClaudeLabel("claude-07-23-2026")).toBe(false);
  });

  it("rejects single-digit month/day", () => {
    expect(isValidClaudeLabel("claude-7-3-26")).toBe(false);
  });

  it("rejects an out-of-range month", () => {
    expect(isValidClaudeLabel("claude-13-23-26")).toBe(false);
  });

  it("rejects an out-of-range day", () => {
    expect(isValidClaudeLabel("claude-07-32-26")).toBe(false);
  });

  it("rejects a trailing hyphen / empty description", () => {
    expect(isValidClaudeLabel("claude-07-23-26-")).toBe(false);
  });

  it("rejects uppercase or underscores in the description (not kebab)", () => {
    expect(isValidClaudeLabel("claude-07-23-26-Brand_Fix")).toBe(false);
  });

  it("rejects a description with consecutive hyphens", () => {
    expect(isValidClaudeLabel("claude-07-23-26-brand--fix")).toBe(false);
  });
});

describe("claudeAuditLabel", () => {
  // 12:00 PDT on 2026-07-23, an instant that is 07-23 in Pacific time
  // whatever zone the machine running the test is in.
  const d = new Date("2026-07-23T19:00:00Z");

  it("produces the bare dated form with no descriptor", () => {
    expect(claudeAuditLabel(d)).toBe("claude-07-23-26");
  });

  it("slugs a free-text descriptor into kebab-case", () => {
    expect(claudeAuditLabel(d, "Brand CPA Fix")).toBe("claude-07-23-26-brand-cpa-fix");
  });

  it("strips punctuation and collapses separators in the descriptor", () => {
    expect(claudeAuditLabel(d, "  pause: losing_RSA!! ")).toBe(
      "claude-07-23-26-pause-losing-rsa",
    );
  });

  it("omits the descriptor when it slugs to empty", () => {
    expect(claudeAuditLabel(d, "!!!")).toBe("claude-07-23-26");
  });

  // Property/shape: whatever descriptor comes in, the OUTPUT is always a valid
  // label — the generator can never emit a string its own validator rejects.
  it("always emits a label its validator accepts", () => {
    const descriptors = [
      undefined,
      "",
      "Brand CPA Fix",
      "  spaced  out  ",
      "UPPER_and_snake",
      "unicode—em—dash",
      "trailing-hyphen-",
      "a".repeat(200), // very long — must still be valid (bounded, not mid-token sliced)
      "111-222",
    ];
    for (const desc of descriptors) {
      const label = claudeAuditLabel(d, desc as string | undefined);
      expect(isValidClaudeLabel(label), `invalid label from descriptor ${JSON.stringify(desc)}: ${label}`).toBe(true);
    }
  });

  it("zero-pads single-digit months and days", () => {
    expect(claudeAuditLabel(new Date("2026-01-05T20:00:00Z"))).toBe("claude-01-05-26");
  });
});

/**
 * The label names Mark's Pacific calendar day, whatever zone the machine is in
 * (same rule and cases as mcp-stackadapt src/label.ts).
 * US DST 2026: starts Sun 03-08 at 02:00 PST, ends Sun 11-01 at 02:00 PDT.
 */
describe("claudeAuditLabel uses the America/Los_Angeles calendar date", () => {
  it.each([
    // Pacific midnight, both offsets
    ["2026-11-21T07:30:00Z", "claude-11-20-26", "PST: 07:30 UTC is 23:30 the previous Pacific day"],
    ["2026-11-21T08:00:00Z", "claude-11-21-26", "PST: Pacific midnight"],
    ["2026-07-15T06:30:00Z", "claude-07-14-26", "PDT: 06:30 UTC is 23:30 the previous Pacific day"],
    ["2026-07-15T07:00:00Z", "claude-07-15-26", "PDT: Pacific midnight"],
    // DST end, Sun 2026-11-01
    ["2026-11-01T06:59:59Z", "claude-10-31-26", "last second of Sat 10-31 (PDT)"],
    ["2026-11-01T07:00:00Z", "claude-11-01-26", "midnight 11-01, still PDT"],
    ["2026-11-01T08:30:00Z", "claude-11-01-26", "01:30 PDT, first pass of the repeated hour"],
    ["2026-11-01T09:30:00Z", "claude-11-01-26", "01:30 PST, second pass of the repeated hour"],
    ["2026-11-02T07:30:00Z", "claude-11-01-26", "23:30 PST on 11-01 (a fixed UTC-7 offset says 11-02)"],
    ["2026-11-02T08:00:00Z", "claude-11-02-26", "midnight 11-02, now PST"],
    // DST start, Sun 2026-03-08
    ["2026-03-08T07:59:59Z", "claude-03-07-26", "last second of Sat 03-07 (PST; a fixed UTC-7 offset says 03-08)"],
    ["2026-03-08T08:00:00Z", "claude-03-08-26", "midnight 03-08, still PST"],
    ["2026-03-08T10:30:00Z", "claude-03-08-26", "03:30 PDT, just past the skipped hour"],
    ["2026-03-09T06:59:59Z", "claude-03-08-26", "23:59:59 PDT on 03-08"],
    ["2026-03-09T07:00:00Z", "claude-03-09-26", "midnight 03-09, now PDT (a fixed UTC-8 offset says 03-08)"],
    // Year rollover
    ["2027-01-01T07:59:59Z", "claude-12-31-26", "still 2026 in Pacific"],
    ["2027-01-01T08:00:00Z", "claude-01-01-27", "Pacific new year"],
  ])("%s -> %s (%s)", (iso, expected) => {
    const label = claudeAuditLabel(new Date(iso));
    expect(label).toBe(expected);
    expect(isValidClaudeLabel(label)).toBe(true);
  });

  it("keeps the descriptor on the Pacific date", () => {
    expect(claudeAuditLabel(new Date("2026-11-21T07:30:00Z"), "Budget Cut")).toBe("claude-11-20-26-budget-cut");
  });

  it("refuses an invalid Date instead of building a NaN label", () => {
    expect(() => claudeAuditLabel(new Date("not a date"))).toThrow(/valid Date/);
  });
});

describe("claudeAuditLabel ignores the machine's time zone", () => {
  let savedTz: string | undefined;
  beforeEach(() => {
    savedTz = process.env.TZ;
  });
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  // getTimezoneOffset() at 2026-10-30T15:00Z proves the zone switch took
  // effect, so this cannot pass vacuously if runtime TZ changes stop working.
  it.each([
    ["UTC", 0],
    ["America/Los_Angeles", 420],
    ["Asia/Tokyo", -540],
    ["Pacific/Kiritimati", -840],
  ])("TZ=%s gives the Pacific label", (tz, offsetMinutes) => {
    process.env.TZ = tz;
    expect(new Date("2026-10-30T15:00:00Z").getTimezoneOffset()).toBe(offsetMinutes);
    expect(claudeAuditLabel(new Date("2026-10-30T15:00:00Z"))).toBe("claude-10-30-26");
    expect(claudeAuditLabel(new Date("2026-11-21T07:30:00Z"))).toBe("claude-11-20-26");
    // 05:00 on 11-22 in Tokyo and Kiritimati, still 11-21 in Pacific.
    expect(claudeAuditLabel(new Date("2026-11-21T20:00:00Z"))).toBe("claude-11-21-26");
  });
});

describe("AUTO_CLAUDE_LABEL_RE", () => {
  // The recognizer used to strip the auto-applied label from a caller's extra
  // labels (so it isn't double-added). Must match BOTH the bare and described
  // forms, and nothing that only resembles them.
  it("matches the bare and described auto-label", () => {
    expect(AUTO_CLAUDE_LABEL_RE.test("claude-07-23-26")).toBe(true);
    expect(AUTO_CLAUDE_LABEL_RE.test("claude-07-23-26-brand-cpa-fix")).toBe(true);
  });

  it("does not match an unrelated user label", () => {
    expect(AUTO_CLAUDE_LABEL_RE.test("q3-brand-push")).toBe(false);
    expect(AUTO_CLAUDE_LABEL_RE.test("claudecorp")).toBe(false);
  });
});
