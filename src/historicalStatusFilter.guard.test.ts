/**
 * Historical metrics must not be filtered by an entity's CURRENT status.
 *
 * Bug class: a GAQL query that returns metrics over a date range
 * (`segments.date` / `DURING`) while also filtering on current status —
 * `campaign.status = 'ENABLED'`, `!= 'REMOVED'`, `<> 'REMOVED'`, `IN (...)`,
 * `NOT IN (...)`, on campaign / ad_group / ad_group_ad / ad_group_criterion /
 * serving_status / primary_status alike. A removed or paused entity still
 * spent in the months it was live; the filter erases that spend silently.
 *
 * Incident 2026-10-06: `campaign.status != 'REMOVED'` dropped ~$120K of Q2
 * spend from a removed brand campaign out of a CMO deck. Standing rule: data
 * pulls include removed and paused campaigns, ad groups and keywords. Select
 * the status column when a report needs to label them.
 *
 * Two layers:
 *  1. A static scan of every non-test source file (detector unit-tested below).
 *  2. A behavioral check: call each performance tool's manager method with a
 *     fake customer, capture the GAQL it actually sends, and assert no status
 *     predicate survives — this catches predicates the static scan could only
 *     see through string assembly.
 *
 * ALLOWLIST is keyed by `file:line` with a specific reason. Keep it empty
 * unless a query genuinely needs current inventory over a date window.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GoogleAdsManager } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// `<entity>[.<sub>].[<x>_]status` followed by = / != / <> / IN / NOT IN and a
// literal, list or interpolation. Not matched: status with no operator (a
// SELECT column) and `==` / `===` (client-side row comparison). IN / NOT IN
// upper-case only. `segments.*` excluded — historical by construction.
const STATUS_PRED_RE =
  /\b(?!segments\.)[a-z_]+(?:\.[a-z_]+)*\.(?:[a-z_]+_)?status\s*(?:!=|<>|(?<![=!<>])=(?!=)|NOT\s+IN\b|IN\b)\s*[('"$`{]/;
const DATE_RANGE_RE = /segments\.date|\bDURING\b/;
// A whole query in one backtick template literal (no nested backticks).
const TEMPLATE_RE = /`([^`]*)`/g;
// Window stops: a method / function / switch-case start.
const FUNC_START_RE =
  /^\s*(?:(?:export\s+)?(?:async\s+)?function\s|(?:private\s+|public\s+|static\s+)*(?:async\s+)?[A-Za-z_]\w*\s*\([^)]*\)\s*(?::[^{]*)?\{\s*$|case\s+["'])/;

const ALLOWLIST: Record<string, string> = {};

function maskTemplates(text: string): string {
  return text.replace(TEMPLATE_RE, (m) => m.replace(/[^\n]/g, " "));
}

/** Return [lineNumber, snippet] for each status predicate on a dated query. */
function findViolations(text: string): Array<[number, string]> {
  const lines = text.split("\n");
  const out = new Map<number, string>();

  // Pass 1: each template literal judged on its own content.
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const body = m[1];
    if (!DATE_RANGE_RE.test(body)) continue;
    const sm = STATUS_PRED_RE.exec(body);
    if (!sm) continue;
    const ln = text.slice(0, (m.index ?? 0) + 1 + sm.index).split("\n").length;
    out.set(ln, lines[ln - 1].trim().slice(0, 120));
  }

  // Pass 2: concatenated / appended predicates outside a template literal,
  // within a function-bounded 30-line window over the raw text.
  const masked = maskTemplates(text).split("\n");
  const n = lines.length;
  const windowEnd = (start: number) => {
    const stop = Math.min(start + 30, n);
    for (let k = start + 1; k < stop; k++) if (FUNC_START_RE.test(lines[k])) return k;
    return stop;
  };
  let i = 0;
  while (i < n) {
    const end = windowEnd(i);
    const window = lines.slice(i, end).join("\n");
    const hits: number[] = [];
    for (let j = i; j < end; j++) if (STATUS_PRED_RE.test(masked[j])) hits.push(j);
    if (hits.length && /SELECT/.test(window) && /FROM/.test(window) && DATE_RANGE_RE.test(window)) {
      for (const j of hits) out.set(j + 1, lines[j].trim().slice(0, 120));
      i = end;
    } else {
      i += 1;
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]);
}

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", ".claude", "tests"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      yield* sourceFiles(p);
    } else if (/\.(ts|mjs|cjs|js)$/.test(name) && !/\.test\./.test(name) && !name.endsWith(".d.ts")) {
      yield p;
    }
  }
}

const PREDICATES = [
  "campaign.status = 'ENABLED'",
  "campaign.status != 'REMOVED'",
  "campaign.status <> 'REMOVED'",
  "campaign.status IN ('ENABLED', 'PAUSED')",
  "campaign.status NOT IN ('REMOVED')",
  "ad_group.status != 'REMOVED'",
  "ad_group_ad.status != 'REMOVED'",
  "ad_group_criterion.status != 'REMOVED'",
  "campaign.serving_status = 'SERVING'",
  "campaign.primary_status IN ('ELIGIBLE')",
];

describe("historical-status detector", () => {
  it.each(PREDICATES)("flags %s in a dated template literal", (pred) => {
    const src = [
      "async function q(s: string, e: string) {",
      "  const query = `",
      "    SELECT campaign.name, metrics.cost_micros FROM campaign",
      "    WHERE segments.date BETWEEN '${s}' AND '${e}'",
      `      AND ${pred}`,
      "  `;",
      "}",
    ].join("\n");
    expect(findViolations(src)).toHaveLength(1);
  });

  it.each(PREDICATES)("flags %s concatenated onto a dated query", (pred) => {
    const src = [
      "function q() {",
      `  let query = "SELECT campaign.name, metrics.clicks FROM campaign WHERE segments.date DURING LAST_7_DAYS";`,
      `  query += " AND ${pred}";`,
      "}",
    ].join("\n");
    expect(findViolations(src)).toHaveLength(1);
  });

  it("flags DURING with no literal segments.date", () => {
    const src = "const q = `SELECT campaign.id, metrics.clicks FROM campaign WHERE campaign.status = 'ENABLED' DURING LAST_7_DAYS`;";
    expect(findViolations(src)).toHaveLength(1);
  });

  it("ignores a status-only inventory query", () => {
    const src = "const q = `SELECT campaign.id FROM campaign WHERE campaign.status != 'REMOVED'`;";
    expect(findViolations(src)).toEqual([]);
  });

  it("ignores a date-only query", () => {
    const src = "const q = `SELECT campaign.id, metrics.clicks FROM campaign WHERE segments.date BETWEEN 'a' AND 'b'`;";
    expect(findViolations(src)).toEqual([]);
  });

  it("ignores status selected (not filtered) on a dated query", () => {
    const src = [
      "const q = `",
      "  SELECT campaign.status, ad_group_ad.status, metrics.clicks FROM ad_group_ad",
      "  WHERE segments.date BETWEEN 'a' AND 'b'",
      "`;",
    ].join("\n");
    expect(findViolations(src)).toEqual([]);
  });

  it("ignores client-side === comparison next to a dated query", () => {
    const src = [
      "function f(rows: any[]) {",
      "  const q = `SELECT campaign.status, metrics.clicks FROM campaign WHERE segments.date DURING LAST_7_DAYS`;",
      "  return rows.filter((r) => r.campaign.status === 'ENABLED');",
      "}",
    ].join("\n");
    expect(findViolations(src)).toEqual([]);
  });

  it("ignores a status-only query in a neighbouring method", () => {
    const src = [
      "  async dated() {",
      "    return `SELECT campaign.id, metrics.clicks FROM campaign WHERE segments.date BETWEEN 'a' AND 'b'`;",
      "  }",
      "",
      "  async live() {",
      "    return `SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED'`;",
      "  }",
    ].join("\n");
    expect(findViolations(src)).toEqual([]);
  });
});

describe("repo scan: no dated GAQL filters on current status", () => {
  it("has no unallowlisted hits", () => {
    const bugs: string[] = [];
    for (const file of sourceFiles(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file);
      for (const [ln, snippet] of findViolations(readFileSync(file, "utf8"))) {
        if (ALLOWLIST[`${rel}:${ln}`]) continue;
        bugs.push(`  ${rel}:${ln}  ${snippet}`);
      }
    }
    expect(
      bugs,
      "Dated GAQL combined with a current-status filter drops paused/removed " +
        "entities' historical spend. Drop the predicate (select status to label " +
        "instead) or allowlist file:line with a specific reason.\n" + bugs.join("\n")
    ).toEqual([]);
  });

  it("allowlist has no stale entries", () => {
    const stale = Object.keys(ALLOWLIST).filter((key) => {
      const [rel, ln] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
      try {
        return !findViolations(readFileSync(join(REPO_ROOT, rel), "utf8")).some(([l]) => l === ln);
      } catch {
        return true;
      }
    });
    expect(stale).toEqual([]);
  });
});

// ── Behavioral: the GAQL each performance tool actually sends ──────────────

function managerCapturing(): { mgr: GoogleAdsManager; queries: string[] } {
  const queries: string[] = [];
  const customer = {
    async query(gaql: string) {
      queries.push(gaql);
      return [];
    },
  };
  const mgr = Object.create(GoogleAdsManager.prototype) as GoogleAdsManager;
  (mgr as any).getCustomer = () => customer;
  return { mgr, queries };
}

const DATES = { startDate: "2026-04-01", endDate: "2026-06-30" };
const FILTERS = { ...DATES, campaignIds: ["1"], adGroupIds: ["2"], keywordTextContains: "crm", searchTermContains: "crm" };

const PERFORMANCE_CALLS: Array<[string, (m: GoogleAdsManager) => Promise<unknown>]> = [
  ["google_ads_keyword_performance", (m) => m.getKeywordPerformance("1234567890", FILTERS)],
  ["google_ads_keyword_performance_by_conversion", (m) => m.getKeywordPerformanceWithConversions("1234567890", FILTERS)],
  ["google_ads_search_term_report", (m) => m.getSearchTermReport("1234567890", FILTERS)],
  ["google_ads_search_term_report_by_conversion", (m) => m.getSearchTermReportWithConversions("1234567890", FILTERS)],
  ["google_ads_ad_performance", (m) => m.getAdPerformance("1234567890", FILTERS)],
  ["google_ads_ad_performance_by_conversion", (m) => m.getAdPerformanceWithConversions("1234567890", FILTERS)],
  ["google_ads_get_campaign_diagnostics", (m) => (m as any).getCampaignDiagnostics("1234567890", ["1"])],
];

describe("performance tools send no current-status predicate", () => {
  it.each(PERFORMANCE_CALLS)("%s", async (_tool, call) => {
    const { mgr, queries } = managerCapturing();
    await call(mgr);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(DATE_RANGE_RE.test(q), "expected a dated query").toBe(true);
      const where = q.slice(q.search(/\bWHERE\b/));
      expect(STATUS_PRED_RE.exec(where)?.[0] ?? null, `status predicate in:\n${q}`).toBeNull();
    }
  });
});
