/**
 * `GOOGLE_ADS_MCP_ALWAYS_LOAD` — opt-in "always load" stamping for tools/list.
 *
 * Clients that defer tool schemas (tool search) only load a tool's schema on
 * demand. A tool carrying `_meta: {"anthropic/alwaysLoad": true}` is offered
 * directly instead. This server lets the launcher name the handful of tools
 * that should always be directly callable via a comma-separated env var.
 *
 * The invariants locked in here:
 *   - named tools get the marker, merged onto any `_meta` they already carry
 *   - unset/empty env var leaves the list byte-for-byte as it is today
 *   - a name matching no tool is ignored, and stamps nothing else
 *   - stamping never resurrects a tool that `filterTools` removed (read-only
 *     mode still hides write tools, named or not)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { applyAlwaysLoad, buildToolList } from "./index.js";
import { tools } from "./tools.js";
import { filterTools } from "./writeGate.js";

const ALWAYS_LOAD_META_KEY = "anthropic/alwaysLoad";

/** Read-only (today's default): no GOOGLE_ADS_MCP_WRITE in the environment. */
const readOnlyEnv = (
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv => ({ ...extra });

/** Write mode: every tool survives filterTools. */
const writeEnv = (
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv => ({ GOOGLE_ADS_MCP_WRITE: "true", ...extra });

function metaOf(list: Tool[], name: string): unknown {
  const tool = list.find((t) => t.name === name);
  expect(tool, `tool ${name} missing from list`).toBeDefined();
  return (tool as Tool)._meta;
}

describe("GOOGLE_ADS_MCP_ALWAYS_LOAD", () => {
  it("stamps each named tool that exists with anthropic/alwaysLoad", () => {
    const list = buildToolList(
      readOnlyEnv({
        GOOGLE_ADS_MCP_ALWAYS_LOAD:
          "google_ads_get_client_context,google_ads_gaql_query",
      }),
    );

    expect(metaOf(list, "google_ads_get_client_context")).toEqual({
      [ALWAYS_LOAD_META_KEY]: true,
    });
    expect(metaOf(list, "google_ads_gaql_query")).toEqual({
      [ALWAYS_LOAD_META_KEY]: true,
    });

    // Nothing else picked up the marker.
    const stamped = list
      .filter((t) => t._meta !== undefined)
      .map((t) => t.name)
      .sort();
    expect(stamped).toEqual([
      "google_ads_gaql_query",
      "google_ads_get_client_context",
    ]);
  });

  it("tolerates whitespace and empty segments around the names", () => {
    const list = buildToolList(
      readOnlyEnv({
        GOOGLE_ADS_MCP_ALWAYS_LOAD: " google_ads_gaql_query , ,",
      }),
    );

    expect(metaOf(list, "google_ads_gaql_query")).toEqual({
      [ALWAYS_LOAD_META_KEY]: true,
    });
    expect(list.filter((t) => t._meta !== undefined)).toHaveLength(1);
  });

  it("merges the marker onto a tool's existing _meta", () => {
    const withMeta: Tool[] = [
      {
        name: "google_ads_gaql_query",
        description: "stub",
        inputSchema: { type: "object" },
        _meta: { "example.com/keep": "me" },
      },
    ];

    const [stamped] = applyAlwaysLoad(withMeta, {
      GOOGLE_ADS_MCP_ALWAYS_LOAD: "google_ads_gaql_query",
    });

    expect(stamped._meta).toEqual({
      "example.com/keep": "me",
      [ALWAYS_LOAD_META_KEY]: true,
    });
    // The source tool is not mutated in place.
    expect(withMeta[0]._meta).toEqual({ "example.com/keep": "me" });
  });

  it("returns today's list unchanged when the env var is unset", () => {
    expect(buildToolList(readOnlyEnv())).toEqual(filterTools(tools, readOnlyEnv()));
    expect(buildToolList(writeEnv())).toEqual(filterTools(tools, writeEnv()));
  });

  it("returns today's list unchanged when the env var is empty", () => {
    const env = readOnlyEnv({ GOOGLE_ADS_MCP_ALWAYS_LOAD: "" });
    expect(buildToolList(env)).toEqual(filterTools(tools, env));

    const commasOnly = readOnlyEnv({ GOOGLE_ADS_MCP_ALWAYS_LOAD: " , " });
    expect(buildToolList(commasOnly)).toEqual(filterTools(tools, commasOnly));
  });

  it("ignores a name that matches no tool, and stamps nothing else", () => {
    const env = readOnlyEnv({
      GOOGLE_ADS_MCP_ALWAYS_LOAD: "google_ads_not_a_real_tool",
    });

    expect(() => buildToolList(env)).not.toThrow();
    expect(buildToolList(env)).toEqual(filterTools(tools, env));
  });

  it("still stamps the real names when an unknown name rides along", () => {
    const list = buildToolList(
      readOnlyEnv({
        GOOGLE_ADS_MCP_ALWAYS_LOAD:
          "google_ads_not_a_real_tool,google_ads_gaql_query",
      }),
    );

    expect(metaOf(list, "google_ads_gaql_query")).toEqual({
      [ALWAYS_LOAD_META_KEY]: true,
    });
    expect(list.filter((t) => t._meta !== undefined)).toHaveLength(1);
  });

  it("never overrides filterTools: a named write tool stays hidden in read-only mode", () => {
    const env = readOnlyEnv({
      GOOGLE_ADS_MCP_ALWAYS_LOAD:
        "google_ads_create_campaign,google_ads_gaql_query",
    });
    const list = buildToolList(env);

    expect(list.map((t) => t.name)).not.toContain("google_ads_create_campaign");
    expect(list.map((t) => t.name).sort()).toEqual(
      filterTools(tools, env)
        .map((t) => t.name)
        .sort(),
    );
    // The read-only tool named alongside it is still stamped.
    expect(metaOf(list, "google_ads_gaql_query")).toEqual({
      [ALWAYS_LOAD_META_KEY]: true,
    });
  });

  it("stamps a named write tool once write mode makes it visible", () => {
    const list = buildToolList(
      writeEnv({ GOOGLE_ADS_MCP_ALWAYS_LOAD: "google_ads_create_campaign" }),
    );

    expect(metaOf(list, "google_ads_create_campaign")).toEqual({
      [ALWAYS_LOAD_META_KEY]: true,
    });
  });
});

describe("tools/list handler wiring", () => {
  /**
   * The env var is only useful if the live `tools/list` handler is what reads
   * it. Asserting on the source text keeps the handler from drifting back to
   * a bare `filterTools(tools)` while the unit tests above stay green.
   */
  it("the ListToolsRequestSchema handler returns buildToolList()", () => {
    const indexTs = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );
    const handler = indexTs.match(
      /setRequestHandler\(\s*ListToolsRequestSchema[\s\S]*?\n\}\);/,
    );
    expect(handler, "ListToolsRequestSchema handler not found").not.toBeNull();
    expect((handler as RegExpMatchArray)[0]).toContain("buildToolList(");
  });
});
