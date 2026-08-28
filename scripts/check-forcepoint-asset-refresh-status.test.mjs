// ============================================
// Unit tests for evaluateForcepointAssetRefreshStatus
// (scripts/check-forcepoint-asset-refresh-status.mjs).
//
// Context: the Forcepoint (494-825-2953) account-level asset refresh's
// Definition of Done names an exact ENABLED customer_asset shape (14
// callouts / 2 structured snippets / 8 sitelinks by asset ID or exact
// text) and a set of things that must NOT be ENABLED (10 removed
// callout IDs, 3 removed snippet IDs, sitelink 280051853776, and any
// divested-messaging text). This module only computes the verdict from
// a `customer_asset` GAQL result set — it never calls the Google Ads
// API itself, so it stays a pure, unit-testable decision table instead
// of a live-effect script.
// ============================================

import { describe, it, expect } from "vitest";
import {
  evaluateForcepointAssetRefreshStatus,
  KEEP_CALLOUT_IDS,
  PROMOTED_CALLOUT_IDS,
  NEW_CALLOUT_TEXTS,
  REMOVED_CALLOUT_IDS,
  KEEP_SITELINK_IDS,
  PROMOTED_SITELINK_IDS,
  REMOVED_SITELINK_ID,
  PROMOTED_SNIPPET_ID,
} from "./check-forcepoint-asset-refresh-status.mjs";

function calloutRow(id, text, status = "ENABLED") {
  return {
    asset: `customers/4948252953/customerAssets/${id}~CALLOUT`,
    field_type: "CALLOUT",
    status,
    callout_text: text,
  };
}

function sitelinkRow(id, text, status = "ENABLED") {
  return {
    asset: `customers/4948252953/customerAssets/${id}~SITELINK`,
    field_type: "SITELINK",
    status,
    link_text: text,
  };
}

function snippetRow(id, header, values, status = "ENABLED") {
  return {
    asset: `customers/4948252953/customerAssets/${id}~STRUCTURED_SNIPPET`,
    field_type: "STRUCTURED_SNIPPET",
    status,
    header,
    values,
  };
}

// Builds a fully-compliant row set matching the Definition of Done exactly.
function buildCompliantRows() {
  const rows = [];
  for (const id of KEEP_CALLOUT_IDS) rows.push(calloutRow(id, `keep-${id}`));
  for (const id of PROMOTED_CALLOUT_IDS) rows.push(calloutRow(id, `promoted-${id}`));
  rows.push(calloutRow("900000000001", NEW_CALLOUT_TEXTS[0]));
  rows.push(calloutRow("900000000002", NEW_CALLOUT_TEXTS[1]));
  for (const id of REMOVED_CALLOUT_IDS) rows.push(calloutRow(id, `removed-${id}`, "PAUSED"));

  for (const id of KEEP_SITELINK_IDS) rows.push(sitelinkRow(id, `keep-${id}`));
  for (const id of PROMOTED_SITELINK_IDS) rows.push(sitelinkRow(id, `promoted-${id}`));
  rows.push(sitelinkRow(REMOVED_SITELINK_ID, "Free Data Risk Assessment", "REMOVED"));

  rows.push(
    snippetRow(PROMOTED_SNIPPET_ID, "Service catalog", [
      "Endpoint DLP",
      "Cloud DLP",
      "SaaS & Email Protection",
      "Insider Threat Detection",
      "Compliance Templates",
    ])
  );
  rows.push(
    snippetRow("900000000003", "Types", [
      "Data Loss Prevention",
      "DSPM",
      "Data Classification",
      "GenAI Data Protection",
      "Insider Threat Detection",
      "Data Access Governance",
    ])
  );
  rows.push(snippetRow("23569235938", "old", ["x"], "PAUSED"));
  rows.push(snippetRow("23569235959", "old", ["x"], "PAUSED"));
  rows.push(snippetRow("341380266294", "old", ["x"], "PAUSED"));

  return rows;
}

describe("evaluateForcepointAssetRefreshStatus", () => {
  it("passes a row set matching the Definition of Done exactly (14 callouts / 2 snippets / 8 sitelinks ENABLED)", () => {
    const result = evaluateForcepointAssetRefreshStatus(buildCompliantRows());
    expect(result.verdict).toBe("PASS");
    expect(result.enabledCalloutCount).toBe(14);
    expect(result.enabledSnippetCount).toBe(2);
    expect(result.enabledSitelinkCount).toBe(8);
    expect(result.reasons).toEqual([]);
  });

  it("fails when a removed callout ID (23558472208, Web Security) is still ENABLED", () => {
    const rows = buildCompliantRows().map((row) =>
      row.asset.includes("23558472208") ? { ...row, status: "ENABLED" } : row
    );
    const result = evaluateForcepointAssetRefreshStatus(rows);
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("23558472208"))).toBe(true);
  });

  it("fails when divested-messaging text (\"Web Security\") appears on an ENABLED row", () => {
    const rows = buildCompliantRows().map((row) =>
      row.callout_text === `keep-${KEEP_CALLOUT_IDS[0]}`
        ? { ...row, callout_text: "Web Security" }
        : row
    );
    const result = evaluateForcepointAssetRefreshStatus(rows);
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("divested"))).toBe(true);
  });

  it("fails when sitelink asset 280051853776 shows status ENABLED", () => {
    const rows = buildCompliantRows().map((row) =>
      row.asset.includes(REMOVED_SITELINK_ID) ? { ...row, status: "ENABLED" } : row
    );
    const result = evaluateForcepointAssetRefreshStatus(rows);
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes(REMOVED_SITELINK_ID))).toBe(true);
  });

  it("reports INCOMPLETE when one of the two new callouts hasn't been created/linked yet", () => {
    const rows = buildCompliantRows().filter(
      (row) => row.callout_text !== NEW_CALLOUT_TEXTS[1]
    );
    const result = evaluateForcepointAssetRefreshStatus(rows);
    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.enabledCalloutCount).toBe(13);
  });

  it("returns FAIL with an authorization_error reason when the query itself errored (direct_access regressed)", () => {
    const result = evaluateForcepointAssetRefreshStatus(null, {
      queryError: "authorization_error(2)",
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.some((r) => r.includes("authorization_error"))).toBe(true);
  });
});
