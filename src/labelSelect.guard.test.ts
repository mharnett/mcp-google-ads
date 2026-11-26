/**
 * The Google Ads API joins `label` only to the *_label resources:
 * `label.name FROM campaign` (or ad_group, or ad_group_ad) is refused. This
 * checks every GAQL query written in src/.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

function labelQueries(): { where: string; from: string }[] {
  return readdirSync(SRC)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .flatMap((file) => {
      const source = readFileSync(path.join(SRC, file), "utf8");
      // A query runs from SELECT to its FROM resource, with no closing backtick between.
      return [...source.matchAll(/\bSELECT\b([^`]*?)\bFROM\s+([a-z_]+)/g)]
        .filter((m) => /\blabel\.[a-z_]/.test(m[1]))
        .map((m) => ({ where: `${file}:${source.slice(0, m.index).split("\n").length}`, from: m[2] }));
    });
}

describe("GAQL that selects label fields", () => {
  it("starts from label or a *_label resource", () => {
    const queries = labelQueries();
    // A scan that finds nothing would pass for the wrong reason.
    expect(queries.length).toBeGreaterThanOrEqual(5);
    expect(queries.filter((q) => q.from !== "label" && !q.from.endsWith("_label"))).toEqual([]);
  });
});
