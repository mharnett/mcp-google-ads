#!/usr/bin/env node
// ============================================
// Git-history secret scanner.
//
// `git log --all -p | grep -c developer_token` (per the credential-hygiene
// audit's Check 1) tells you how many lines MENTION a keyword — it can't
// tell a literal leaked token apart from a variable name, a type
// annotation, or a `process.env.X` passthrough. This module walks
// `git log --all -p` output and classifies every matching line as either a
// LITERAL value (looks like a real secret was pasted in) or a PLACEHOLDER
// (the keyword appears with no real value attached).
//
// This is a heuristic, not a guarantee — false negatives are possible for
// secrets that don't look "random enough" (e.g. all-letters, no digits).
// Treat "literal" hits as the list to spot-check by hand, not as final proof.
// ============================================

import { execFileSync } from "node:child_process";

export const DEFAULT_PATTERNS = [
  { name: "developer_token", regex: /developer_token/i },
  { name: "client_secret", regex: /client_secret/i },
];

const PLACEHOLDER_VALUE_RE =
  /^(|null|undefined|string|number|boolean|process\.env(\.\w+)?|<[^>]*>|\$\{[^}]*\}|your[_-]?\w*token\w*|xxx+|changeme|change[_-]?me|placeholder|example|redacted|not[_-]?set|todo|n\/a)$/i;

// Pull the value assigned to a key on this line, e.g. `foo: "bar"` -> `bar`,
// `FOO=bar` -> `bar`. Returns null if there's no assignment at all (a bare
// identifier mention, a comment, an array literal entry, etc).
function extractValue(content) {
  const idx = Math.max(content.lastIndexOf("="), content.lastIndexOf(":"));
  if (idx === -1) return null;
  let rest = content.slice(idx + 1);
  const endMatch = rest.match(/[;,})\]]/);
  if (endMatch) rest = rest.slice(0, endMatch.index);
  return rest.trim().replace(/^['"`]|['"`]$/g, "");
}

function classifyLine(content) {
  const value = extractValue(content);
  if (!value) return "placeholder";
  if (PLACEHOLDER_VALUE_RE.test(value)) return "placeholder";
  if (/^GOCSPX-/.test(value)) return "literal";
  if (/^[A-Za-z0-9_-]{16,}$/.test(value) && /[0-9]/.test(value) && /[A-Za-z]/.test(value)) return "literal";
  return "placeholder";
}

// Walk `git log --all -p` style text and return one entry per line that
// matches a pattern: { commit, file, pattern, classification, line }.
export function scanGitLogForSecrets(logText, patterns = DEFAULT_PATTERNS) {
  const hits = [];
  let commit = null;
  let file = null;

  for (const raw of logText.split("\n")) {
    if (raw.startsWith("commit ")) {
      commit = raw.slice("commit ".length).trim();
      continue;
    }
    if (raw.startsWith("+++ b/") || raw.startsWith("--- a/")) {
      const p = raw.slice(6);
      if (p !== "/dev/null") file = p;
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (!/^[+\- ]/.test(raw)) continue; // skip hunk headers, diff --git, index lines, etc.

    const content = raw.slice(1);
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        hits.push({
          commit,
          file,
          pattern: pattern.name,
          classification: classifyLine(content),
          line: content.trim(),
        });
      }
    }
  }

  return hits;
}

function redact(value) {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

function main() {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx !== -1 ? args[repoIdx + 1] : ".";
  const reveal = args.includes("--reveal");

  const logText = execFileSync("git", ["-C", repo, "log", "--all", "-p"], {
    encoding: "utf-8",
    maxBuffer: 1024 * 1024 * 1024,
  });

  const hits = scanGitLogForSecrets(logText);
  const literal = hits.filter((h) => h.classification === "literal");
  const placeholder = hits.filter((h) => h.classification === "placeholder");

  console.log(`Scanned pushed history of ${repo}`);
  console.log(`Total matches: ${hits.length} (literal: ${literal.length}, placeholder: ${placeholder.length})`);

  if (literal.length > 0) {
    console.log("\nLiteral-looking hits (spot-check these):");
    for (const hit of literal) {
      const value = extractValue(hit.line) ?? "";
      console.log(`  ${hit.commit?.slice(0, 12)} ${hit.file}: ${reveal ? value : redact(value)}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nNo literal-looking secret values found — remaining matches are placeholders/identifiers only.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
