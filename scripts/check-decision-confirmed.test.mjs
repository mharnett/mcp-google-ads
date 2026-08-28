// ============================================
// Unit tests for evaluateDecisionRecord (scripts/check-decision-confirmed.mjs).
//
// Context: the privatize-or-scrub decision memory record moves from
// `status: open` to `status: confirmed` once Mark answers the Open
// Question via Slack. This module parses that memory file's raw text
// (frontmatter + body) and checks that the confirmation was actually
// recorded correctly: the status flipped, the chosen path
// (scrub-and-keep-public) is stated explicitly, and the follow-up note
// points at the already-filed sibling execution task rather than staying
// generic or vanishing.
// ============================================

import { describe, it, expect } from "vitest";
import { evaluateDecisionRecord } from "./check-decision-confirmed.mjs";

const CONFIRMED_RECORD = `---
name: privatize-or-scrub-decision
metadata:
  status: confirmed
---

**Confirmed path: scrub-and-keep-public** — scrub secret history via
\`git filter-repo --replace-text\` on a mirror clone of
\`mharnett/mcp-google-ads\`, force-push the rewritten history, and keep the
repo PUBLIC. Mark answered the Open Question via Slack (thread
\`C0BL4V195LN/1787875858.152829\`), selecting option (a).

## Requested follow-ups

See \`task-mgmt/tasks/if-scrub-is-confirmed-on-a-fresh-mirror-clone-of-mharnett-mcp-google-ads-run-git-.md\`
for the next actor — no new task needed.
`;

const OPEN_RECORD = `---
name: privatize-or-scrub-decision
metadata:
  status: open
---

Recommendation carried forward: scrub history via \`git filter-repo
--replace-text\`, keep the repo public. Not yet executed.
`;

describe("evaluateDecisionRecord", () => {
  it("passes a record with status: confirmed, the scrub-and-keep-public statement, and the sibling task pointer", () => {
    const result = evaluateDecisionRecord(CONFIRMED_RECORD);
    expect(result.status).toBe("confirmed");
    expect(result.hasChosenPathStatement).toBe(true);
    expect(result.hasSiblingTaskPointer).toBe(true);
    expect(result.verdict).toBe("PASS");
  });

  it("fails a record still marked status: open with no chosen-path statement", () => {
    const result = evaluateDecisionRecord(OPEN_RECORD);
    expect(result.status).toBe("open");
    expect(result.hasChosenPathStatement).toBe(false);
    expect(result.verdict).toBe("FAIL");
  });

  it("fails when status is confirmed but the sibling task pointer is missing", () => {
    const record = CONFIRMED_RECORD.replace(
      /## Requested follow-ups[\s\S]*/,
      "## Requested follow-ups\n\nTBD.\n"
    );
    const result = evaluateDecisionRecord(record);
    expect(result.status).toBe("confirmed");
    expect(result.hasChosenPathStatement).toBe(true);
    expect(result.hasSiblingTaskPointer).toBe(false);
    expect(result.verdict).toBe("FAIL");
  });
});
