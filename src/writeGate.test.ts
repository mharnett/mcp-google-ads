import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";
import {
  WRITE_TOOLS,
  isWriteTool,
  isWriteEnabled,
  filterTools,
  assertWriteAllowed,
  WRITE_DISABLED_MESSAGE,
} from "./writeGate.js";

const READ_TOOLS = [
  "google_ads_get_client_context",
  "google_ads_list_campaigns",
  "google_ads_list_ad_groups",
  "google_ads_get_campaign_tracking",
  "google_ads_list_pending_changes",
  "google_ads_validate_ad",
  "google_ads_keyword_performance",
  "google_ads_keyword_performance_by_conversion",
  "google_ads_search_term_report",
  "google_ads_search_term_report_by_conversion",
  "google_ads_ad_performance",
  "google_ads_ad_performance_by_conversion",
  "google_ads_list_conversion_actions",
  "google_ads_search_term_insights",
  "google_ads_search_term_insight_terms",
  "google_ads_gaql_query",
  "google_ads_keyword_volume",
  "google_ads_list_experiments",
  "google_ads_get_experiment",
  "google_ads_get_campaign_diagnostics",
  "google_ads_get_ad_strength",
];

describe("writeGate", () => {
  describe("tool classification covers every registered tool", () => {
    it("every tool is either in WRITE_TOOLS or in the READ_TOOLS fixture", () => {
      const registered = tools.map((t) => t.name);
      const classified = new Set<string>([...WRITE_TOOLS, ...READ_TOOLS]);
      const uncovered = registered.filter((n) => !classified.has(n));
      expect(uncovered).toEqual([]);
    });

    it("WRITE_TOOLS and READ_TOOLS do not overlap", () => {
      const overlap = READ_TOOLS.filter((n) => WRITE_TOOLS.has(n));
      expect(overlap).toEqual([]);
    });
  });

  describe("isWriteEnabled", () => {
    it("defaults to false when env var is unset", () => {
      expect(isWriteEnabled({})).toBe(false);
    });

    it("accepts 'true' (case-insensitive) as enabled", () => {
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "true" })).toBe(true);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "TRUE" })).toBe(true);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "True" })).toBe(true);
    });

    it("accepts '1' and 'yes' as enabled", () => {
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "1" })).toBe(true);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "yes" })).toBe(true);
    });

    it("rejects anything else", () => {
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "" })).toBe(false);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "false" })).toBe(false);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "0" })).toBe(false);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "no" })).toBe(false);
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "maybe" })).toBe(false);
    });

    it("trims whitespace", () => {
      expect(isWriteEnabled({ GOOGLE_ADS_MCP_WRITE: "  true  " })).toBe(true);
    });
  });

  describe("filterTools (read-only default)", () => {
    it("hides every write tool when the env var is unset", () => {
      const filtered = filterTools(tools, {});
      const names = filtered.map((t) => t.name);
      for (const w of WRITE_TOOLS) {
        expect(names).not.toContain(w);
      }
    });

    it("keeps every read tool when the env var is unset", () => {
      const filtered = filterTools(tools, {});
      const names = filtered.map((t) => t.name);
      for (const r of READ_TOOLS) {
        expect(names).toContain(r);
      }
    });

    it("exposes every tool when GOOGLE_ADS_MCP_WRITE=true", () => {
      const filtered = filterTools(tools, { GOOGLE_ADS_MCP_WRITE: "true" });
      expect(filtered.map((t) => t.name).sort()).toEqual(
        tools.map((t) => t.name).sort(),
      );
    });
  });

  describe("assertWriteAllowed", () => {
    it("permits read tools regardless of env var", () => {
      expect(() => assertWriteAllowed("google_ads_list_campaigns", {})).not.toThrow();
      expect(() => assertWriteAllowed("google_ads_gaql_query", {})).not.toThrow();
    });

    it("blocks every write tool when env var is unset", () => {
      for (const w of WRITE_TOOLS) {
        expect(() => assertWriteAllowed(w, {})).toThrow(/write operation/i);
      }
    });

    it("allows write tools when GOOGLE_ADS_MCP_WRITE=true", () => {
      for (const w of WRITE_TOOLS) {
        expect(() =>
          assertWriteAllowed(w, { GOOGLE_ADS_MCP_WRITE: "true" }),
        ).not.toThrow();
      }
    });

    it("error message points at the env var fix", () => {
      try {
        assertWriteAllowed("google_ads_enable_items", {});
      } catch (err) {
        expect((err as Error).message).toContain("GOOGLE_ADS_MCP_WRITE=true");
        return;
      }
      throw new Error("expected assertWriteAllowed to throw");
    });
  });

  describe("isWriteTool", () => {
    it("returns true for the Javier incident tool (enable_items)", () => {
      expect(isWriteTool("google_ads_enable_items")).toBe(true);
    });

    it("returns false for read-only tools", () => {
      expect(isWriteTool("google_ads_list_campaigns")).toBe(false);
      expect(isWriteTool("google_ads_gaql_query")).toBe(false);
    });

    it("classifies google_ads_create_lead_form_asset as a write tool", () => {
      // LeadFormAsset creation mutates account state and must be gated behind
      // GOOGLE_ADS_MCP_WRITE=true. Regression test for the v1.4.6 addition.
      expect(isWriteTool("google_ads_create_lead_form_asset")).toBe(true);
    });
  });

  it("WRITE_DISABLED_MESSAGE mentions the env var", () => {
    expect(WRITE_DISABLED_MESSAGE).toContain("GOOGLE_ADS_MCP_WRITE=true");
  });
});
