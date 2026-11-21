import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tools } from "./tools.js";
import { WRITE_TOOLS } from "./writeGate.js";

// Skills under skills/<name>/SKILL.md are runnable playbooks built on this
// server. Their promise is that every check is backed by a READ-ONLY tool
// call, so a skill must never name a tool that doesn't exist or that writes.

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const TOOL_REF = /\bgoogle_ads_[a-z_]+\b/g;
const CHECK_HEADING = /^### (\d+\.\d+) /;

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

  const registered = new Set(tools.map((t) => t.name));

  for (const file of skillFiles()) {
    const name = basename(dirname(file));
    const text = readFileSync(file, "utf8");

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

      it("names only read-only tools", () => {
        expect(toolRefs(text).filter((r) => WRITE_TOOLS.has(r))).toEqual([]);
      });

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
