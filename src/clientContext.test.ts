/**
 * getClientFromWorkingDir resolution — exactly-one vs. no-match vs. several-matches.
 *
 * Before this change, getClientFromWorkingDir returned a bare
 * `ClientConfig | null`: the first client whose folder/key matched the cwd
 * "won", silently hiding every other equally-plausible client sharing that
 * folder (e.g. multiple per-account keys all living under clients/acme).
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
    "acme-android": {
      customer_id: "100-000-0001",
      name: "Acme Android",
      folder: "/home/user/work/clients/acme",
    },
    "acme-desktop": {
      customer_id: "100-000-0002",
      name: "Acme Desktop 2023",
      folder: "/home/user/work/clients/acme",
    },
    "acme-android-2025": {
      customer_id: "100-000-0003",
      name: "Acme Android 2025",
      folder: "/home/user/work/clients/acme",
    },
    "globex-na": {
      customer_id: "200-000-0001",
      name: "Globex North America",
      folder: "/home/user/work/clients/globex",
    },
    "globex-intl": {
      customer_id: "200-000-0002",
      name: "Globex | International",
      folder: "/home/user/work/clients/globex",
    },
    initech: {
      customer_id: "300-000-0001",
      name: "Initech",
      folder: "/home/user/work/clients/initech",
    },
  },
  defaults: {
    create_paused: true,
    label_prefix: "claude:",
    require_approval_for_enable: true,
  },
} as any;

describe("getClientFromWorkingDir", () => {
  it("returns several-matches with all 3 candidates for a cwd shared by multiple Acme keys", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/home/user/work/clients/acme");

    expect(result.match).toBe("several");
    expect(result.client).toBeNull();
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((c) => [c.name, c.customer_id]).sort()).toEqual(
      [
        ["Acme Android", "100-000-0001"],
        ["Acme Desktop 2023", "100-000-0002"],
        ["Acme Android 2025", "100-000-0003"],
      ].sort()
    );
  });

  it("returns several-matches with both candidates for a cwd shared by the Globex keys", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/home/user/work/clients/globex");

    expect(result.match).toBe("several");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => [c.name, c.customer_id]).sort()).toEqual(
      [
        ["Globex North America", "200-000-0001"],
        ["Globex | International", "200-000-0002"],
      ].sort()
    );
  });

  it("returns exactly-one match for a cwd matching a single client (unchanged behavior)", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/home/user/work/clients/initech");

    expect(result.match).toBe("one");
    expect(result.client).not.toBeNull();
    expect(result.client?.name).toBe("Initech");
    expect(result.client?.customer_id).toBe("300-000-0001");
  });

  it("returns no-match for a cwd matching no configured client", () => {
    const result = getClientFromWorkingDir(FIXTURE_CONFIG, "/home/user/work");

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
        "acme-legacy": {
          customer_id: "111-111-1111",
          name: "Acme Legacy",
          folder: "/some/unrelated/path",
        },
        "acme-legacy-2": {
          customer_id: "222-222-2222",
          name: "Acme Legacy Two",
          folder: "/another/unrelated/path",
        },
      },
    };

    const result = getClientFromWorkingDir(
      fallbackConfig,
      "/home/user/work/workspaces/acme-legacy-2-workspace"
    );

    expect(result.match).toBe("several");
    expect(result.candidates.map((c) => c.name).sort()).toEqual(
      ["Acme Legacy", "Acme Legacy Two"].sort()
    );
  });
});
