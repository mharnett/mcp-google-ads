import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tools } from "./tools.js";

const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
const section = readme.slice(readme.indexOf("### Available Tools")).split(/\n### (?!Available Tools)/)[0];
const listed = [...section.matchAll(/^\| `(google_ads_[a-z_]+)` \|/gm)].map((m) => m[1]);

describe("README tool counts match what the server registers", () => {
  it("states the total everywhere it gives one", () => {
    const totals = [...readme.matchAll(/(\d+) tools\b/g)].map((m) => Number(m[1]));
    expect(totals.length).toBeGreaterThan(0);
    expect(totals).toEqual(totals.map(() => tools.length));
    expect(section).toMatch(new RegExp(`^### Available Tools \\(${tools.length}\\)\\n`));
  });

  it("states how many of them its tables describe", () => {
    expect(listed.length).toBeGreaterThan(0);
    expect(section).toContain(`describe ${listed.length} of the ${tools.length}`);
  });

  it("lists no tool twice and none that does not exist", () => {
    const names = new Set(tools.map((t) => t.name));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((name) => !names.has(name))).toEqual([]);
  });
});
