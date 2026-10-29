/**
 * Ceiling / expected_old contract over WRITE_TOOLS.
 *
 * Every write tool must be classified in WRITE_TOOL_GUARDS. A tool whose
 * input schema carries a number must declare either a magnitude `ceiling` or
 * an explicit `no_ceiling_reason`. A tool that overwrites a value (update_*,
 * rename_*, replace_*) must accept `expected_old` or declare an explicit
 * `no_expected_old_reason`. Adding a new numeric or overwriting write tool
 * without making that decision fails here.
 */

import { describe, expect, it } from "vitest";

import { tools } from "./tools.js";
import { WRITE_TOOLS } from "./writeGate.js";
import { WRITE_TOOL_GUARDS } from "./writeGuards.js";

type Schema = Record<string, any>;

/** Dotted paths of every number/integer property in a JSON schema (walks properties, items, oneOf/anyOf/allOf). */
export function numericPaths(schema: Schema | undefined, prefix = ""): string[] {
  if (!schema || typeof schema !== "object") return [];
  const out: string[] = [];
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("number") || types.includes("integer")) out.push(prefix || "(root)");
  for (const [k, v] of Object.entries(schema.properties ?? {})) {
    out.push(...numericPaths(v as Schema, prefix ? `${prefix}.${k}` : k));
  }
  if (schema.items) out.push(...numericPaths(schema.items, `${prefix}[]`));
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    for (const sub of schema[key] ?? []) out.push(...numericPaths(sub, prefix));
  }
  return [...new Set(out)];
}

/** True if `name` appears as a property anywhere in the schema. */
function hasProperty(schema: Schema | undefined, name: string): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (schema.properties && name in schema.properties) return true;
  if (Object.values(schema.properties ?? {}).some((v) => hasProperty(v as Schema, name))) return true;
  if (schema.items && hasProperty(schema.items, name)) return true;
  return ["oneOf", "anyOf", "allOf"].some((k) => (schema[k] ?? []).some((s: Schema) => hasProperty(s, name)));
}

const OVERWRITING = /^google_ads_(update|rename|replace)_/;
const byName = new Map(tools.map((t) => [t.name, t]));

describe("numericPaths (self-test)", () => {
  it("finds numbers in properties, array items and oneOf branches", () => {
    expect(
      numericPaths({
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "array", items: { oneOf: [{ type: "string" }, { type: "object", properties: { p: { type: "number" } } }] } },
          c: { type: "string" },
        },
      }).sort()
    ).toEqual(["a", "b[].p"]);
  });
});

describe("WRITE_TOOL_GUARDS contract", () => {
  it("classifies exactly the tools in WRITE_TOOLS", () => {
    const declared = Object.keys(WRITE_TOOL_GUARDS).sort();
    expect(declared).toEqual([...WRITE_TOOLS].sort());
  });

  it("every write tool that takes a number declares a ceiling or a no_ceiling_reason", () => {
    const offenders: string[] = [];
    for (const name of WRITE_TOOLS) {
      const nums = numericPaths(byName.get(name)?.inputSchema as Schema);
      if (nums.length === 0) continue;
      const g = WRITE_TOOL_GUARDS[name] ?? {};
      const hasCeiling = !!g.ceiling;
      const hasReason = typeof g.no_ceiling_reason === "string" && g.no_ceiling_reason.trim().length > 0;
      if (hasCeiling === hasReason) offenders.push(`${name} [${nums.join(", ")}]`);
    }
    expect(offenders, "declare exactly one of ceiling / no_ceiling_reason").toEqual([]);
  });

  it("a declared ceiling is enforceable: the schema takes confirm_large_change", () => {
    for (const [name, g] of Object.entries(WRITE_TOOL_GUARDS)) {
      if (!g.ceiling) continue;
      expect(hasProperty(byName.get(name)?.inputSchema as Schema, "confirm_large_change"), name).toBe(true);
      expect(g.ceiling.pct).toBeGreaterThan(0);
    }
  });

  it("every overwriting update tool accepts expected_old or declares a no_expected_old_reason", () => {
    const offenders: string[] = [];
    for (const name of WRITE_TOOLS) {
      if (!OVERWRITING.test(name)) continue;
      const accepts = hasProperty(byName.get(name)?.inputSchema as Schema, "expected_old");
      const reason = WRITE_TOOL_GUARDS[name]?.no_expected_old_reason;
      const hasReason = typeof reason === "string" && reason.trim().length > 0;
      if (accepts === hasReason) offenders.push(name);
    }
    expect(offenders, "declare exactly one of: expected_old in the schema / no_expected_old_reason").toEqual([]);
  });

  it("google_ads_update_campaign_budget takes confirm_large_change, reason and expected_old", () => {
    const schema = byName.get("google_ads_update_campaign_budget")!.inputSchema as Schema;
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["confirm_large_change", "reason", "expected_old"])
    );
  });
});

// ---------------------------------------------------------------------------
// Handler wiring: a schema that advertises expected_old / confirm_large_change
// / reason is a lie unless the dispatch case actually forwards it. Text-level
// check over index.ts, same approach as tools.handler.test.ts.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const INDEX_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
const ASSET_HELPERS_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assetHelpers.ts"), "utf8");

function caseBody(tool: string): string {
  const start = INDEX_SRC.indexOf(`case "${tool}":`);
  if (start < 0) return "";
  const next = INDEX_SRC.indexOf('case "google_ads_', start + 10);
  return INDEX_SRC.slice(start, next < 0 ? undefined : next);
}

describe("handler forwards guard params", () => {
  it("every tool advertising expected_old forwards it from its dispatch case", () => {
    const missing: string[] = [];
    for (const name of WRITE_TOOLS) {
      if (!hasProperty(byName.get(name)?.inputSchema as Schema, "expected_old")) continue;
      const body = caseBody(name);
      const fn = body.match(/(normalize\w+Args)\(/)?.[1];
      const fnStart = fn ? ASSET_HELPERS_SRC.indexOf(`export function ${fn}(`) : -1;
      const fnBody = fnStart < 0 ? "" : ASSET_HELPERS_SRC.slice(fnStart, ASSET_HELPERS_SRC.indexOf("\nexport function", fnStart + 10));
      const viaNormalizer = fnBody.includes("expected_old");
      if (!body.includes("expected_old") && !viaNormalizer) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("budget and bidding cases forward confirm_large_change and reason", () => {
    for (const name of ["google_ads_update_campaign_budget", "google_ads_update_campaign_bidding"]) {
      const body = caseBody(name);
      expect(body, name).toContain("confirm_large_change");
      expect(body, name).toContain("reason");
    }
  });
});
