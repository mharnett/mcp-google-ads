import { describe, it, expect } from "vitest";
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
// Not every mutation can carry a label — only campaigns, ad groups, ad group
// ads and ad group criteria have a label surface (budgets, bidding, tracking
// edits, shared-set negatives, assets do NOT). This module governs the label
// STRING; coverage over which ops label is a separate concern.
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
  const d = new Date(2026, 6, 23); // 2026-07-23 (month is 0-indexed)

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
    expect(claudeAuditLabel(new Date(2026, 0, 5))).toBe("claude-01-05-26");
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
