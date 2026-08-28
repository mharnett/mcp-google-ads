#!/usr/bin/env node
// ============================================
// Verdict logic for the Forcepoint (494-825-2953, routed via MCC
// 676-139-6070) account-level asset refresh's Acceptance check:
//
//   SELECT customer_asset.asset, customer_asset.field_type,
//          customer_asset.status, asset.callout_asset.callout_text,
//          asset.sitelink_asset.link_text,
//          asset.structured_snippet_asset.header,
//          asset.structured_snippet_asset.values
//   FROM customer_asset
//   WHERE customer_asset.status = 'ENABLED'
//
// This module only computes the verdict from that GAQL result set — it
// never calls the Google Ads API itself, so it stays a pure,
// unit-testable decision table instead of a live-effect script.
// ============================================

export const KEEP_CALLOUT_IDS = [
  "23558472265", // Data Loss Prevention
  "23558472295", // Risk-Adaptive Protection
  "23558472409", // Data Classification
  "23558472277", // Single Console Control
  "23558472286", // Predefined Policy Library
  "23558472379", // Schedule A Demo
  "23558472250", // Data Fingerprinting
  "23558472523", // Data Theft Prevention
  "23558472367", // Data Protection
];

export const PROMOTED_CALLOUT_IDS = [
  "280049187298", // Insider Threat Detection
  "280049187301", // Trusted by Fortune 500
  "280049187304", // Immediate Visibility
];

export const NEW_CALLOUT_TEXTS = ["GenAI Data Protection", "Secure AI Adoption"];

export const REMOVED_CALLOUT_IDS = [
  "23558472208", // Web Security
  "23558472235", // Cloud Security
  "23558472268", // Leader In Web Security
  "23558472484", // Firewall Protection
  "23558472322", // Adaptive Response
  "23558472361", // Risk Adaptive Protection (dup)
  "23558472325", // DLP Integration
  "23558472436", // Advanced Analytics
  "23558472496", // Data Fingerprinting (dup)
  "23558472520", // Real-Time Reporting
];

export const REMOVED_SNIPPET_IDS = ["23569235938", "23569235959", "341380266294"];

export const NEW_SNIPPET_HEADER = "Types";
export const NEW_SNIPPET_VALUES = [
  "Data Loss Prevention",
  "DSPM",
  "Data Classification",
  "GenAI Data Protection",
  "Insider Threat Detection",
  "Data Access Governance",
];

export const PROMOTED_SNIPPET_ID = "280051920607";
export const PROMOTED_SNIPPET_HEADER = "Service catalog";
export const PROMOTED_SNIPPET_VALUES = [
  "Endpoint DLP",
  "Cloud DLP",
  "SaaS & Email Protection",
  "Insider Threat Detection",
  "Compliance Templates",
];

export const KEEP_SITELINK_IDS = [
  "42254931610", // Request A Demo
  "62582976904", // Forcepoint Pricing
  "297895991371", // All Solutions
  "391231622628", // Products Overview
  "392534015879", // Gartner AI Cyber Report
];

export const PROMOTED_SITELINK_IDS = [
  "391185556396", // Free Data Risk Assessment
  "136471930134", // DSPM
  "391231432917", // Securely Enable AI
];

// Distinct from the promoted Free Data Risk Assessment sitelink above —
// this is the older asset that must stay REMOVED (needs no action).
export const REMOVED_SITELINK_ID = "280051853776";

export const DIVESTED_TEXT_SNIPPETS = [
  "Next-Gen Firewall",
  "NGFW w/ SD-WAN",
  "Web Security",
  "Cloud Security",
  "Leader In Web Security",
  "Firewall Protection",
];

const EXPECTED_CALLOUT_COUNT = KEEP_CALLOUT_IDS.length + PROMOTED_CALLOUT_IDS.length + NEW_CALLOUT_TEXTS.length; // 14
const EXPECTED_SNIPPET_COUNT = 2;
const EXPECTED_SITELINK_COUNT = KEEP_SITELINK_IDS.length + PROMOTED_SITELINK_IDS.length; // 8

function extractAssetId(resourceName) {
  const match = /\/customerAssets\/(\d+)~/.exec(resourceName || "");
  return match ? match[1] : null;
}

function containsDivestedText(text) {
  if (!text) return false;
  return DIVESTED_TEXT_SNIPPETS.some((snippet) => text.includes(snippet));
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

// Returns { verdict: "PASS" | "INCOMPLETE" | "FAIL", reasons: string[],
//           enabledCalloutCount, enabledSnippetCount, enabledSitelinkCount }
export function evaluateForcepointAssetRefreshStatus(rows, { queryError } = {}) {
  const reasons = [];

  if (queryError) {
    return {
      verdict: "FAIL",
      reasons: [`query failed: ${queryError}`],
      enabledCalloutCount: 0,
      enabledSnippetCount: 0,
      enabledSitelinkCount: 0,
    };
  }

  const enabledRows = (rows || []).filter((row) => row.status === "ENABLED");

  const enabledCallouts = enabledRows.filter((row) => row.field_type === "CALLOUT");
  const enabledSnippets = enabledRows.filter((row) => row.field_type === "STRUCTURED_SNIPPET");
  const enabledSitelinks = enabledRows.filter((row) => row.field_type === "SITELINK");

  // Divested messaging must not appear in ANY enabled row, of any type.
  for (const row of enabledRows) {
    const text = row.callout_text || row.link_text || row.header || "";
    if (containsDivestedText(text)) {
      reasons.push(`divested-messaging text "${text}" is ENABLED on ${row.asset}`);
    }
  }

  // Removed callout IDs must not be ENABLED.
  for (const row of enabledCallouts) {
    const id = extractAssetId(row.asset);
    if (REMOVED_CALLOUT_IDS.includes(id)) {
      reasons.push(`removed callout ID ${id} is still ENABLED`);
    }
  }

  // Removed snippet IDs must not be ENABLED.
  for (const row of enabledSnippets) {
    const id = extractAssetId(row.asset);
    if (REMOVED_SNIPPET_IDS.includes(id)) {
      reasons.push(`removed structured snippet ID ${id} is still ENABLED`);
    }
  }

  // Removed sitelink ID must not be ENABLED.
  for (const row of enabledSitelinks) {
    const id = extractAssetId(row.asset);
    if (id === REMOVED_SITELINK_ID) {
      reasons.push(`removed sitelink ID ${REMOVED_SITELINK_ID} is still ENABLED`);
    }
  }

  // Match enabled callouts against the expected keep/promoted/new sets.
  const expectedCalloutIds = new Set([...KEEP_CALLOUT_IDS, ...PROMOTED_CALLOUT_IDS]);
  const remainingNewCalloutTexts = new Set(NEW_CALLOUT_TEXTS);
  let matchedCalloutCount = 0;
  for (const row of enabledCallouts) {
    const id = extractAssetId(row.asset);
    if (expectedCalloutIds.has(id)) {
      matchedCalloutCount += 1;
    } else if (remainingNewCalloutTexts.has(row.callout_text)) {
      remainingNewCalloutTexts.delete(row.callout_text);
      matchedCalloutCount += 1;
    } else if (!REMOVED_CALLOUT_IDS.includes(id)) {
      reasons.push(`unexpected ENABLED callout ${row.asset} ("${row.callout_text}")`);
    }
  }

  // Match enabled sitelinks against the expected keep/promoted sets.
  const expectedSitelinkIds = new Set([...KEEP_SITELINK_IDS, ...PROMOTED_SITELINK_IDS]);
  let matchedSitelinkCount = 0;
  for (const row of enabledSitelinks) {
    const id = extractAssetId(row.asset);
    if (expectedSitelinkIds.has(id)) {
      matchedSitelinkCount += 1;
    } else if (id !== REMOVED_SITELINK_ID) {
      reasons.push(`unexpected ENABLED sitelink ${row.asset} ("${row.link_text}")`);
    }
  }

  // Match enabled snippets against the promoted asset + the new "Types" snippet.
  let matchedSnippetCount = 0;
  let sawPromotedSnippet = false;
  let sawNewSnippet = false;
  for (const row of enabledSnippets) {
    const id = extractAssetId(row.asset);
    if (id === PROMOTED_SNIPPET_ID) {
      matchedSnippetCount += 1;
      sawPromotedSnippet = true;
      if (row.header !== PROMOTED_SNIPPET_HEADER || !arraysEqual(row.values, PROMOTED_SNIPPET_VALUES)) {
        reasons.push(`promoted structured snippet ${PROMOTED_SNIPPET_ID} has unexpected header/values`);
      }
    } else if (row.header === NEW_SNIPPET_HEADER && arraysEqual(row.values, NEW_SNIPPET_VALUES)) {
      matchedSnippetCount += 1;
      sawNewSnippet = true;
    } else if (!REMOVED_SNIPPET_IDS.includes(id)) {
      reasons.push(`unexpected ENABLED structured snippet ${row.asset}`);
    }
  }

  const result = {
    enabledCalloutCount: enabledCallouts.length,
    enabledSnippetCount: enabledSnippets.length,
    enabledSitelinkCount: enabledSitelinks.length,
  };

  if (reasons.length > 0) {
    return { verdict: "FAIL", reasons, ...result };
  }

  const complete =
    matchedCalloutCount === EXPECTED_CALLOUT_COUNT &&
    matchedSitelinkCount === EXPECTED_SITELINK_COUNT &&
    matchedSnippetCount === EXPECTED_SNIPPET_COUNT &&
    sawPromotedSnippet &&
    sawNewSnippet &&
    remainingNewCalloutTexts.size === 0;

  return { verdict: complete ? "PASS" : "INCOMPLETE", reasons: [], ...result };
}
