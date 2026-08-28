#!/usr/bin/env node
// ============================================
// Parses the privatize-or-scrub decision memory record's raw text
// (frontmatter + body) and checks that its confirmation is complete:
// `status: confirmed`, an explicit chosen-path statement naming
// scrub-and-keep-public, and a follow-up pointer at the already-filed
// sibling execution task (rather than a generic or missing note).
// ============================================

const STATUS_RE = /status:\s*(\S+)/;
const CHOSEN_PATH_RE = /scrub-and-keep-public/i;
const SIBLING_TASK_RE =
  /if-scrub-is-confirmed-on-a-fresh-mirror-clone-of-mharnett-mcp-google-ads-run-git-/;

export function evaluateDecisionRecord(content) {
  const statusMatch = content.match(STATUS_RE);
  const status = statusMatch ? statusMatch[1] : null;
  const hasChosenPathStatement = CHOSEN_PATH_RE.test(content);
  const hasSiblingTaskPointer = SIBLING_TASK_RE.test(content);

  const verdict =
    status === "confirmed" && hasChosenPathStatement && hasSiblingTaskPointer
      ? "PASS"
      : "FAIL";

  return { status, hasChosenPathStatement, hasSiblingTaskPointer, verdict };
}
