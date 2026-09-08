// ============================================
// Unit tests for the git-history secret scanner (scripts/scan-history-secrets.mjs).
//
// Purpose: Check 1 of the credential-hygiene audit requires distinguishing a
// LITERAL secret value pushed into history (developer_token/client_secret
// assigned to something that looks like a real token) from a PLACEHOLDER
// reference (a variable name, type annotation, env-var passthrough, or an
// example value like "your_token_here"). `grep -c` alone can't make that
// distinction; these tests pin down the classifier's behavior on each shape
// of line it must tell apart.
//
// Fixture note: fake "secret-looking" values below are deliberately short /
// broken up so they don't themselves match a real secret-scanner pattern.
// ============================================

import { describe, it, expect } from "vitest";
import { scanGitLogForSecrets, fingerprintValue, hitFingerprint, evaluateBaseline } from "./scan-history-secrets.mjs";

function fakeLog(commitHash, file, diffLines) {
  return [
    `commit ${commitHash}`,
    "Author: Test <test@example.com>",
    "Date:   Mon Jan 1 00:00:00 2026 +0000",
    "",
    `diff --git a/${file} b/${file}`,
    "index 1234567..89abcde 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,1 +1,1 @@",
    ...diffLines,
    "",
  ].join("\n");
}

const FAKE_TOKEN_1 = "AbCdEf1234567890ZzYyXxWw";
const FAKE_GOCSPX = "GOCSPX-" + "abc12XY";
const FAKE_TOKEN_2 = "RealLooking123456Token";

describe("scanGitLogForSecrets", () => {
  it("classifies a quoted alphanumeric token literal as literal", () => {
    const log = fakeLog("aaa1111", "src/config.ts", [`+  developer_token: "${FAKE_TOKEN_1}",`]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      commit: "aaa1111",
      file: "src/config.ts",
      pattern: "developer_token",
      classification: "literal",
    });
  });

  it("classifies a GOCSPX-prefixed client secret as literal regardless of length", () => {
    const log = fakeLog("bbb2222", "src/auth.ts", [`+client_secret=${FAKE_GOCSPX}`]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("literal");
    expect(hits[0].pattern).toBe("client_secret");
  });

  it("classifies process.env passthrough as placeholder, not literal", () => {
    const log = fakeLog("ccc3333", "src/config.ts", [
      "+  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,",
    ]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("placeholder");
  });

  it("classifies an example env value (your_token_here) as placeholder", () => {
    const log = fakeLog("ddd4444", ".env.example", ["+DEVELOPER_TOKEN=your_token_here"]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("placeholder");
  });

  it("classifies a bare type annotation as placeholder", () => {
    const log = fakeLog("eee5555", "src/types.ts", ["+  developer_token: string;"]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("placeholder");
  });

  it("classifies a bare identifier mention (no assignment) as placeholder", () => {
    const log = fakeLog("fff6666", "scripts/check-embedded.mjs", [
      '+const required = ["EMBEDDED_CLIENT_SECRET"];',
    ]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("placeholder");
  });

  it("classifies an empty-string assignment as placeholder", () => {
    const log = fakeLog("ggg7777", "config.json", ['+  "client_secret": "",']);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("placeholder");
  });

  it("still finds a literal value on a removed (deleted) diff line", () => {
    const log = fakeLog("hhh8888", "config.json", [`-  "client_secret": "${FAKE_GOCSPX}9999",`]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(1);
    expect(hits[0].classification).toBe("literal");
  });

  it("returns zero hits for a log with no matching patterns", () => {
    const log = fakeLog("iii9999", "README.md", ["+Just a normal doc line."]);
    expect(scanGitLogForSecrets(log)).toHaveLength(0);
  });

  it("supports scanning a multi-commit log and tags each hit with its own commit/file", () => {
    const log =
      fakeLog("jjj0001", "a.ts", ['+  client_secret: "onlyaplaceholder",']) +
      fakeLog("jjj0002", "b.ts", [`+  developer_token: "${FAKE_TOKEN_2}",`]);
    const hits = scanGitLogForSecrets(log);
    expect(hits).toHaveLength(2);
    expect(hits.find((h) => h.file === "a.ts")).toMatchObject({ commit: "jjj0001", classification: "placeholder" });
    expect(hits.find((h) => h.file === "b.ts")).toMatchObject({ commit: "jjj0002", classification: "literal" });
  });
});

describe("scanGitLogForSecrets aggregate shape", () => {
  it("summary counts match the literal/placeholder split across a mixed log", () => {
    const log =
      fakeLog("k001", "one.ts", [`+  developer_token: "${FAKE_TOKEN_1}",`]) +
      fakeLog("k002", "two.ts", ["+  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,"]) +
      fakeLog("k003", "three.ts", [`+client_secret=${FAKE_GOCSPX}`]) +
      fakeLog("k004", "four.ts", ["+DEVELOPER_TOKEN=your_token_here"]);
    const hits = scanGitLogForSecrets(log);
    const literal = hits.filter((h) => h.classification === "literal");
    const placeholder = hits.filter((h) => h.classification === "placeholder");
    expect(literal).toHaveLength(2);
    expect(placeholder).toHaveLength(2);
    // Cardinality invariant: every hit is classified into exactly one bucket.
    expect(literal.length + placeholder.length).toBe(hits.length);
  });
});

// ============================================
// Baseline-subset logic (Definition of Done #3-#5, #8).
//
// The baseline pins every already-known literal hit as-of this card, keyed
// by commit SHA + file path + a redacted fingerprint of the value (never the
// value itself: `fingerprintValue` is a one-way hash, not `redact()`'s
// partial reveal). `evaluateBaseline` is the pass/fail decision: every
// literal hit found by the scanner must match an entry in the baseline
// (exit 0), and any hit that isn't covered fails the build (exit non-zero)
// while naming the hit's commit and file. It also flags baseline entries
// that no longer correspond to any hit as "stale" — the signal that
// scrubbing history should have removed that entry rather than leaving it
// to rot.
// ============================================
describe("fingerprintValue", () => {
  it("never returns the input value itself, even for a short value", () => {
    const fp = fingerprintValue("GOCSPXabc12XY");
    expect(fp).not.toContain("GOCSPXabc12XY");
    expect(fp.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same value", () => {
    expect(fingerprintValue("some-secret-value")).toBe(fingerprintValue("some-secret-value"));
  });

  it("differs for different values", () => {
    expect(fingerprintValue("some-secret-value")).not.toBe(fingerprintValue("some-other-value"));
  });
});

describe("hitFingerprint", () => {
  it("fingerprints the value extracted from a hit's line", () => {
    const log = fakeLog("aaa1111", "src/config.ts", [`+  developer_token: "${FAKE_TOKEN_1}",`]);
    const [hit] = scanGitLogForSecrets(log);
    expect(hitFingerprint(hit)).toBe(fingerprintValue(FAKE_TOKEN_1));
  });
});

describe("evaluateBaseline", () => {
  it("exits 0 when every literal hit is present in the baseline", () => {
    const log = fakeLog("aaa1111", "src/config.ts", [`+  developer_token: "${FAKE_TOKEN_1}",`]);
    const [hit] = scanGitLogForSecrets(log);
    const baseline = [{ commit: "aaa1111", file: "src/config.ts", fingerprint: hitFingerprint(hit) }];
    const result = evaluateBaseline([hit], baseline);
    expect(result.exitCode).toBe(0);
    expect(result.missing).toHaveLength(0);
  });

  it("exits non-zero and names the commit and file when a literal hit is absent from the baseline", () => {
    const log = fakeLog("bbb2222", "src/auth.ts", [`+client_secret=${FAKE_GOCSPX}`]);
    const [hit] = scanGitLogForSecrets(log);
    const result = evaluateBaseline([hit], []);
    expect(result.exitCode).not.toBe(0);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ commit: "bbb2222", file: "src/auth.ts" });
  });

  it("reports a baseline entry with no corresponding hit as stale (shrink-only)", () => {
    const staleEntry = { commit: "ccc3333", file: "src/gone.ts", fingerprint: "deadbeef" };
    const result = evaluateBaseline([], [staleEntry]);
    expect(result.exitCode).toBe(0);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0]).toMatchObject(staleEntry);
  });
});
