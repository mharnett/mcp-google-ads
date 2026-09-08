/**
 * getClientFromWorkingDir resolution — exactly-one vs. no-match vs. several-matches.
 *
 * Before this change, getClientFromWorkingDir returned a bare
 * `ClientConfig | null`: the first client whose folder/key matched the cwd
 * "won", silently hiding every other equally-plausible client sharing that
 * folder (e.g. multiple per-account keys all living under clients/imvu).
 * A caller acting on that single client could mutate the wrong Google Ads
 * account with no indication another candidate existed.
 *
 * This suite pins the resolver to a fixture config (never config.json) and
 * asserts the return shape distinguishes all three cases.
 */

import { describe, expect, it } from "vitest";

import { getClientFromWorkingDir } from "./index.js";

const FIXTURE_CONFIG = {
  google_ads: { mcc_customer_id: "123-456-7890" },
  clients: {
    "imvu-android": {
      customer_id: "551-956-7152",
      name: "IMVU Android",
      folder: "/Users/mark/claude-code/clients/imvu",
    },
    "imvu-desktop": {
      customer_id: "732-432-3950",
      name: "IMVU Desktop 2023",
      folder: "/Users/mark/claude-code/clients/imvu",
    },
    "imvu-android-2025": {
      customer_id: "326-861-4219",
      name: "IMVU Android 2025",
      folder: "/Users/mark/claude-code/clients/imvu",
    },
    "bona-na": {
      customer_id: "848-678-4588",
      name: "Bona Pro North America",
      folder: "/Users/mark/claude-code/clients/bona",
    },
    "bona-intl": {
      customer_id: "761-663-7654",
      name: "Bona | International Professional",
      folder: "/Users/mark/claude-code/clients/bona",
    },
    forcepoint: {
      customer_id: "494-825-2953",
      name: "Forcepoint",
      folder: "/Users/mark/claude-code/clients/forcepoint",
    },
  },
  defaults: {
    create_paused: true,
    label_prefix: "claude:",
    require_approval_for_enable: true,
  },
} as any;

describe("getClientFromWorkingDir", () => {
  it("returns several-matches with all 3 candidates for a cwd shared by multiple IMVU keys", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/Users/mark/claude-code/clients/imvu");

    expect(result.match).toBe("several");
    expect(result.client).toBeNull();
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => [c.name, c.customer_id]).sort()).toEqual(
      [
        ["IMVU Android", "551-956-7152"],
        ["IMVU Desktop 2023", "732-432-3950"],
        ["IMVU Android 2025", "326-861-4219"],
      ].sort()
    );
  });

  it("returns several-matches with both candidates for a cwd shared by the Bona keys", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/Users/mark/claude-code/clients/bona");

    expect(result.match).toBe("several");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => [c.name, c.customer_id]).sort()).toEqual(
      [
        ["Bona Pro North America", "848-678-4588"],
        ["Bona | International Professional", "761-663-7654"],
      ].sort()
    );
  });

  it("returns exactly-one match for a cwd matching a single client (unchanged behavior)", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/Users/mark/claude-code/clients/forcepoint");

    expect(result.match).toBe("one");
    expect(result.client).not.toBeNull();
    expect(result.client?.name).toBe("Forcepoint");
    expect(result.client?.customer_id).toBe("494-825-2953");
  });

  it("returns no-match for a cwd matching no configured client", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/Users/mark/claude-code");

    expect(result.match).toBe("none");
    expect(result.client).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  it("routes cwd.includes(key) substring-fallback hits through the same ambiguity check", () => {
    // Neither key's folder is a prefix of this cwd, so the only way either
    // resolves at all is the `.includes(key)` fallback. Both keys' names
    // appear as substrings of the cwd, so the fallback must surface both
    // as candidates (ambiguous) rather than returning whichever it finds
    // first via Object.entries() iteration order.
    const fallbackConfig = {
      ...FIXTURE_CONFIG,
      clients: {
        ...FIXTURE_CONFIG.clients,
        "imvu-legacy": {
          customer_id: "111-111-1111",
          name: "IMVU Legacy",
          folder: "/some/unrelated/path",
        },
        "imvu-legacy-2": {
          customer_id: "222-222-2222",
          name: "IMVU Legacy Two",
          folder: "/another/unrelated/path",
        },
      },
    };

    const result = getClientFromWorkingDir(
      fallbackConfig,
      "/Users/mark/claude-code/workspaces/imvu-legacy-2-workspace"
    );

    expect(result.match).toBe("several");
    expect(result.candidates.map((c) => c.name).sort()).toEqual(
      ["IMVU Legacy", "IMVU Legacy Two"].sort()
    );
  });
});
