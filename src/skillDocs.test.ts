import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tools } from "./tools.js";
import { WRITE_TOOLS } from "./writeGate.js";

// Skills under skills/<name>/SKILL.md are runnable playbooks built on this
// server. A skill must never name a tool that doesn't exist, and every
// numbered check must be backed by a tool call. A skill is read-only and
// must not name a tool that writes, unless its frontmatter declares
// `writes: true` under metadata; such a skill must say that writes need
// GOOGLE_ADS_MCP_WRITE=true.

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const TOOL_REF = /\bgoogle_ads_[a-z_]+\b/g;
const CHECK_HEADING = /^### (\d+\.\d+) /;

/** True when a SKILL.md frontmatter block declares `writes: true` (nested under metadata). */
function declaresWrites(frontmatter: string): boolean {
  return /^metadata:$/m.test(frontmatter) && /^[ \t]+writes: true[ \t]*$/m.test(frontmatter);
}

function skillFiles(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(SKILLS_DIR, d.name, "SKILL.md"))
    .filter((f) => existsSync(f));
}

function toolRefs(text: string): string[] {
  return [...new Set(text.match(TOOL_REF) ?? [])].sort();
}

/** Split a SKILL.md into its numbered check sections ("### 2.1 ..."). */
function checkSections(text: string): { id: string; body: string }[] {
  const sections: { id: string; body: string }[] = [];
  let current: { id: string; body: string } | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(CHECK_HEADING);
    if (m) {
      current = { id: m[1], body: "" };
      sections.push(current);
    } else if (line.startsWith("## ") || line.startsWith("### ")) {
      current = null;
    } else if (current) {
      current.body += line + "\n";
    }
  }
  return sections;
}

describe("bundled skills", () => {
  it("ships the google-ads-program-audit skill", () => {
    expect(skillFiles().map((f) => basename(dirname(f)))).toContain(
      "google-ads-program-audit",
    );
  });

  it("ships the google-ads-safe-changes skill", () => {
    expect(skillFiles().map((f) => basename(dirname(f)))).toContain(
      "google-ads-safe-changes",
    );
  });

  it("reads `writes: true` only from the metadata block", () => {
    expect(declaresWrites("name: x\nmetadata:\n  version: 1.0.0\n  writes: true")).toBe(true);
    expect(declaresWrites("name: x\nmetadata:\n  writes: false")).toBe(false);
    expect(declaresWrites("name: x\nmetadata:\n  version: 1.0.0")).toBe(false);
    expect(declaresWrites("name: x\nwrites: true")).toBe(false);
  });

  const registered = new Set(tools.map((t) => t.name));

  for (const file of skillFiles()) {
    const name = basename(dirname(file));
    const text = readFileSync(file, "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    const writes = declaresWrites(frontmatter);

    describe(name, () => {
      it("frontmatter name matches the directory and has a description", () => {
        const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
        expect(fm, "missing YAML frontmatter").not.toBeNull();
        expect(fm![1]).toMatch(new RegExp(`^name: ${name}$`, "m"));
        expect(fm![1]).toMatch(/^description: .{40,}/m);
      });

      it("names only tools this server registers", () => {
        const refs = toolRefs(text);
        expect(refs.length).toBeGreaterThan(0);
        expect(refs.filter((r) => !registered.has(r))).toEqual([]);
      });

      if (writes) {
        it("says write tools need GOOGLE_ADS_MCP_WRITE=true", () => {
          expect(text).toContain("GOOGLE_ADS_MCP_WRITE=true");
        });

        it("names a write tool, or it should not declare writes", () => {
          expect(toolRefs(text).filter((r) => WRITE_TOOLS.has(r)).length).toBeGreaterThan(0);
        });
      } else {
        it("names only read-only tools", () => {
          expect(toolRefs(text).filter((r) => WRITE_TOOLS.has(r))).toEqual([]);
        });
      }

      it("backs every numbered check with a tool call", () => {
        const sections = checkSections(text);
        expect(sections.length).toBeGreaterThan(0);
        const unbacked = sections
          .filter((s) => toolRefs(s.body).length === 0)
          .map((s) => s.id);
        expect(unbacked).toEqual([]);
      });
    });
  }
});
