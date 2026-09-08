import { describe, it, expect } from "vitest";
import { getClientFromWorkingDir } from "./index.js";

function fixtureConfig() {
  return {
    google_ads: { mcc_customer_id: "" },
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
      bona: {
        customer_id: "848-678-4588",
        name: "Bona Pro North America",
        folder: "/Users/mark/claude-code/clients/bona",
      },
    },
    defaults: {
      create_paused: true,
      label_prefix: "claude:",
      require_approval_for_enable: true,
    },
  };
}

describe("getClientFromWorkingDir", () => {
  it("reports every candidate when the cwd matches more than one client's folder", () => {
    const resolution = getClientFromWorkingDir(
      fixtureConfig(),
      "/Users/mark/claude-code/clients/imvu"
    );

    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(resolution.candidates.map((c) => c.client.customer_id).sort()).toEqual(
      ["326-861-4219", "551-956-7152", "732-432-3950"].sort()
    );
  });

  it("returns the single client when the cwd matches exactly one folder", () => {
    const resolution = getClientFromWorkingDir(
      fixtureConfig(),
      "/Users/mark/claude-code/clients/bona"
    );

    expect(resolution.kind).toBe("single");
    if (resolution.kind !== "single") throw new Error("expected single");
    expect(resolution.client.customer_id).toBe("848-678-4588");
  });

  it("returns none when the cwd matches no client", () => {
    const resolution = getClientFromWorkingDir(fixtureConfig(), "/Users/mark/claude-code");

    expect(resolution.kind).toBe("none");
  });

  it("falls back to the key-substring match only when no folder matches, and still applies the ambiguity check", () => {
    const config = {
      google_ads: { mcc_customer_id: "" },
      clients: {
        acme: {
          customer_id: "111-111-1111",
          name: "Acme",
          folder: "/nonmatching/acme",
        },
        acmecorp: {
          customer_id: "222-222-2222",
          name: "Acme Corp",
          folder: "/nonmatching/acmecorp",
        },
      },
      defaults: {
        create_paused: true,
        label_prefix: "claude:",
        require_approval_for_enable: true,
      },
    };

    // Neither client's `folder` matches this cwd, so resolution falls to the
    // substring fallback, where both "acme" and "acmecorp" are substrings —
    // the fallback's hits must go through the same ambiguity check.
    const resolution = getClientFromWorkingDir(
      config,
      "/Users/mark/claude-code/clients/acmecorp-project"
    );

    expect(resolution.kind).toBe("ambiguous");
    if (resolution.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(resolution.candidates.map((c) => c.key).sort()).toEqual(["acme", "acmecorp"]);
  });
});
