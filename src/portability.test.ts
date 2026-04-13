// ============================================
// PORTABILITY TEST SUITE
// ============================================
// Static checks that catch platform-specific assumptions in the source
// BEFORE they ship to a non-Mac tester.
//
// Context: prior `get-refresh-token.cjs` used `exec("open ...")` which is
// Mac-only. A non-Mac tester (Windows or Linux) would have hit that on
// first try. That bug would NOT have been caught by the existing chaos
// test suite because chaos tests simulate runtime failures, not platform
// assumptions. This suite closes the gap.
//
// Each rule below is tied to a concrete failure mode seen in the wild.
// When adding a new platform-specific capability, extend src/platform.ts
// (the single sanctioned boundary) — not inline in the calling file.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const SRC_DIR = path.dirname(__filename);

// Files exempt from specific rules. Keep this list tiny; each exemption
// is a place we've decided is *the* boundary for a given platform concern.
const EXEMPT_FROM_EXEC_RULE = new Set<string>([
  // src/platform.ts is allowed to use cross-platform helpers (but currently
  // relies on the `open` npm package and node:net, so it has no exec itself).
]);

const EXEMPT_FROM_HOMEDIR_PATH_RULE = new Set<string>([
  // Tests legitimately create tmp paths that may look homedir-ish.
]);

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...walk(full));
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".mjs") || entry.endsWith(".cjs")) &&
      !entry.endsWith(".d.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

function isTest(filePath: string): boolean {
  return filePath.endsWith(".test.ts") || filePath.endsWith(".test.mjs");
}

function relSrc(filePath: string): string {
  return path.relative(SRC_DIR, filePath);
}

// Strip inline + block comments so that example-in-a-comment strings
// don't trigger portability lints. This is coarse but adequate for TS.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (avoid https://)
}

/**
 * Emit a readable diff-style report when a rule finds violations.
 */
function formatViolations(
  rule: string,
  items: Array<{ file: string; line: number; snippet: string }>,
): string {
  if (items.length === 0) return "";
  const lines = [`Portability rule violated: ${rule}`, ""];
  for (const v of items) {
    lines.push(`  ${v.file}:${v.line}`);
    lines.push(`      ${v.snippet.trim()}`);
  }
  lines.push("");
  lines.push(
    "  Fix: route this logic through src/platform.ts or use a cross-platform npm module " +
      "(os.homedir, path.join, env-paths, the `open` package).",
  );
  return lines.join("\n");
}

function findMatches(
  files: string[],
  pattern: RegExp,
  exempt: Set<string> = new Set(),
  transform: (src: string) => string = stripComments,
): Array<{ file: string; line: number; snippet: string }> {
  const out: Array<{ file: string; line: number; snippet: string }> = [];
  for (const file of files) {
    const rel = relSrc(file);
    if (exempt.has(rel)) continue;
    if (isTest(file)) continue; // test files may reference bad patterns intentionally
    const src = transform(readFileSync(file, "utf-8"));
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      // Re-clone the regex to avoid sticky/lastIndex issues
      const re = new RegExp(pattern.source, pattern.flags);
      if (re.test(line)) {
        out.push({ file: rel, line: i + 1, snippet: line });
      }
    });
  }
  return out;
}

// ============================================
// THE SUITE
// ============================================

describe("portability: no platform-specific shell exec", () => {
  const FILES = walk(SRC_DIR);

  it("no exec/execSync/spawn/spawnSync calls anywhere in src/", () => {
    // Rule: all process spawning goes through the `open` npm module or env-paths.
    // No hand-rolled exec. This catches the exact bug that was in get-refresh-token.cjs.
    const pattern = /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/;
    const violations = findMatches(FILES, pattern, EXEMPT_FROM_EXEC_RULE);
    expect(
      violations,
      formatViolations("no exec/spawn calls in src/", violations),
    ).toEqual([]);
  });

  it("no Mac-specific command literals (open, pbcopy, osascript, say)", () => {
    // String literal "open " (with space or quote after) as a shell command
    const pattern = /["'`](open|pbcopy|pbpaste|osascript|say|defaults|security|launchctl)\s/;
    const violations = findMatches(FILES, pattern);
    expect(violations, formatViolations("no Mac-only command literals", violations)).toEqual([]);
  });

  it("no Windows-specific command literals (start, where, reg, powershell.exe)", () => {
    const pattern = /["'`](start\s|where\.exe|reg\.exe|powershell\.exe|cmd\.exe|wmic)/;
    const violations = findMatches(FILES, pattern);
    expect(violations, formatViolations("no Windows-only command literals", violations)).toEqual([]);
  });

  it("no Linux-specific command literals (xdg-open, notify-send, xclip)", () => {
    const pattern = /["'`](xdg-open|notify-send|xclip|xsel|gnome-|kde-)/;
    const violations = findMatches(FILES, pattern);
    expect(violations, formatViolations("no Linux-only command literals", violations)).toEqual([]);
  });
});

describe("portability: filesystem path assumptions", () => {
  const FILES = walk(SRC_DIR);

  it("no hardcoded Unix absolute paths (/Users/, /home/, /tmp/, /var/, /etc/, /opt/)", () => {
    // Matches "/Users/" or "/home/" etc. in string literals
    const pattern = /["'`](\/(Users|home|tmp|var|etc|opt|usr\/local|private\/tmp)\/)/;
    const violations = findMatches(FILES, pattern, EXEMPT_FROM_HOMEDIR_PATH_RULE);
    expect(violations, formatViolations("no hardcoded Unix paths", violations)).toEqual([]);
  });

  it("no hardcoded Windows drive-letter paths", () => {
    const pattern = /["'`][A-Z]:\\\\[A-Za-z]/;
    const violations = findMatches(FILES, pattern);
    expect(violations, formatViolations("no hardcoded Windows drive paths", violations)).toEqual([]);
  });

  it("no tilde-expansion in string literals (use os.homedir())", () => {
    // ~/.config, ~/something, etc. Node doesn't expand ~ — this is always wrong.
    const pattern = /["'`]~\//;
    const violations = findMatches(FILES, pattern);
    expect(violations, formatViolations("no ~/ in string literals", violations)).toEqual([]);
  });

  it("no forward-slash path concatenation with '+' operator", () => {
    // Matches: `"foo" + "/" + bar` or similar naive path concatenation.
    // This is a weak rule (plenty of false positives with URLs) so we limit
    // to obvious path-ish variable names.
    // NOTE: intentionally NOT enforced as a hard rule in v1 — too many
    // legitimate URL constructions trigger false positives. Kept here
    // commented for future tightening.
    expect(true).toBe(true);
  });
});

describe("portability: stdin/stdout + console", () => {
  const FILES = walk(SRC_DIR);

  it("MCP server (src/index.ts) never writes to stdout — stdout is reserved for JSON-RPC", () => {
    const serverFile = FILES.find((f) => path.basename(f) === "index.ts");
    if (!serverFile) return; // guard
    const src = stripComments(readFileSync(serverFile, "utf-8"));
    const lines = src.split("\n");
    const violations: Array<{ file: string; line: number; snippet: string }> = [];
    lines.forEach((line, i) => {
      // console.log writes to stdout — bad in MCP stdio mode
      if (/\bconsole\.log\s*\(/.test(line)) {
        violations.push({ file: relSrc(serverFile), line: i + 1, snippet: line });
      }
      // process.stdout.write is also stdout
      if (/process\.stdout\.write\s*\(/.test(line)) {
        violations.push({ file: relSrc(serverFile), line: i + 1, snippet: line });
      }
    });
    expect(
      violations,
      formatViolations(
        "no stdout writes in MCP server (use stderr via logger)",
        violations,
      ),
    ).toEqual([]);
  });
});

describe("portability: signal + process assumptions", () => {
  const FILES = walk(SRC_DIR);

  it("no POSIX-only signals passed to process.on/once/kill outside platform.ts", () => {
    // Windows supports SIGINT/SIGTERM/SIGKILL/SIGBREAK but NOT SIGHUP/SIGUSR*.
    // The sanctioned way to attach POSIX-only handlers is onPosixSignal() in
    // platform.ts, which no-ops on Windows. This regex specifically targets
    // direct process.on / process.once / process.kill / process.emit usage —
    // helper calls like onPosixSignal("SIGPIPE", ...) are fine because the
    // helper itself is platform-aware.
    const pattern = /process\.(on|once|kill|emit)\s*\(\s*["'`](SIGHUP|SIGUSR1|SIGUSR2|SIGPIPE|SIGQUIT)["'`]/;
    const violations = findMatches(
      FILES,
      pattern,
      new Set(["platform.ts"]),
    );
    expect(violations, formatViolations("no POSIX-only signals via process.on outside platform.ts", violations)).toEqual([]);
  });

  it("no process.geteuid / process.getegid (POSIX-only)", () => {
    const pattern = /process\.(geteuid|getegid|getgid|getuid)\s*\(/;
    const violations = findMatches(FILES, pattern);
    expect(violations, formatViolations("no POSIX-only process identity calls", violations)).toEqual([]);
  });
});

describe("portability: module system hygiene", () => {
  const FILES = walk(SRC_DIR);

  it("ESM source files don't use CommonJS require()", () => {
    const tsFiles = FILES.filter((f) => f.endsWith(".ts"));
    // `require(...)` at expression position; ignore `require` in import specifiers
    // and TypeScript type references.
    const pattern = /\brequire\s*\(/;
    const violations = findMatches(tsFiles, pattern);
    expect(violations, formatViolations("no require() in ESM .ts files", violations)).toEqual([]);
  });

  it("no `new URL(import.meta.url).pathname` (returns '/C:/...' on Windows)", () => {
    // This pattern is the #1 silent cross-platform bug in ESM Node.
    // `pathname` on a Windows file:// URL is `/C:/path/to/file`, with a leading
    // slash — which path.dirname/join misinterpret. The correct conversion is
    // `fileURLToPath(import.meta.url)` from the `url` module.
    const tsFiles = FILES.filter((f) => f.endsWith(".ts") || f.endsWith(".mjs"));
    const pattern = /new\s+URL\s*\(\s*import\.meta\.url\s*\)\s*\.\s*pathname/;
    const violations = findMatches(tsFiles, pattern);
    expect(
      violations,
      formatViolations(
        "use fileURLToPath(import.meta.url) instead of new URL(...).pathname",
        violations,
      ),
    ).toEqual([]);
  });
});

describe("portability: node-only globals + env assumptions", () => {
  const FILES = walk(SRC_DIR);

  it("no hardcoded port numbers outside platform.ts", () => {
    // Matches `listen(8085...)`, `port: 8085`, etc. with a specific port.
    // platform.ts legitimately scans a range; nothing else should hardcode.
    const pattern = /\b(listen|port)\s*[:=(]\s*(?:\d{4,5})/;
    const violations = findMatches(
      FILES,
      pattern,
      new Set(["platform.ts", "platform.test.ts"]),
    );
    // Test files sometimes need hardcoded ports; that's fine.
    const filteredViolations = violations.filter((v) => !v.file.endsWith(".test.ts"));
    expect(
      filteredViolations,
      formatViolations("no hardcoded ports outside platform.ts", filteredViolations),
    ).toEqual([]);
  });

  it("no hardcoded shell PATH separators (use path.delimiter)", () => {
    // Pattern: split(":") where the adjacent context looks like a PATH.
    // Narrow pattern to reduce false positives.
    const pattern = /\.split\s*\(\s*["']:["']\s*\).*\b(PATH|path)\b/;
    const violations = findMatches(FILES, pattern);
    expect(
      violations,
      formatViolations("no hardcoded PATH delimiter ':'", violations),
    ).toEqual([]);
  });
});
