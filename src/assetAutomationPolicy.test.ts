// Demand Gen asset-automation policy, read from the client's own policy file.
//
// Origin 2026-10-05: the MCP hardcoded OFF for auto-video and adaptive layouts
// on every client, while the Forcepoint Python builders and the daily audit
// read google_ads/config/platform_policy.yaml. Two sources of truth for one
// setting. This module makes the MCP read the same file.
//
// Rules, mirrored from the Python side (google_ads/shared/dg_asset_automation.py
// in the forcepoint repo) -- the cases below are deliberately the same cases:
//   * A client with NO policy file keeps the historical default: both OFF.
//     (Mark, 2026-10-05: "leave it default off".)
//   * A policy file that exists but is malformed is an error, never a default.
//     The caller resolves the policy BEFORE creating the ad, so a broken file
//     refuses the create instead of leaving an ad to clean up.
//   * Bare YAML off/on parse as booleans in PyYAML; they must mean off/on here.
//   * Every managed type is written in ONE operation per ad -- a partial write
//     makes Google re-populate the other type as OPTED_IN.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AUTO_VIDEO,
  AUTO_IMAGE,
  POLICY_RELATIVE_PATH,
  PolicyError,
  parseDgPolicy,
  resolveDgPolicy,
  buildAssetAutomationSettings,
} from "./assetAutomationPolicy.js";

const OFF_OFF = { [AUTO_VIDEO]: "OPTED_OUT", [AUTO_IMAGE]: "OPTED_OUT" };

const doc = (dg: string) => `# header comment\ngoogle_ads:\n  demand_gen:\n${dg}`;

describe("parseDgPolicy", () => {
  it("maps quoted off/off to both OPTED_OUT", () => {
    expect(parseDgPolicy(doc('    auto_video: "off"\n    adaptive_layouts: "off"\n'))).toEqual(OFF_OFF);
  });

  it("reads bare YAML off/on as off/on, the way PyYAML does", () => {
    expect(parseDgPolicy(doc("    auto_video: off\n    adaptive_layouts: on\n"))).toEqual({
      [AUTO_VIDEO]: "OPTED_OUT",
      [AUTO_IMAGE]: "OPTED_IN",
    });
  });

  it("ignores trailing comments and single quotes", () => {
    expect(
      parseDgPolicy(doc("    auto_video: 'off'   # GENERATE_VIDEOS\n    adaptive_layouts: off # x\n"))
    ).toEqual(OFF_OFF);
  });

  it("leaves an unmanaged setting out of the desired state", () => {
    expect(parseDgPolicy(doc('    auto_video: "off"\n    adaptive_layouts: "unmanaged"\n'))).toEqual({
      [AUTO_VIDEO]: "OPTED_OUT",
    });
  });

  it("skips other platforms' sections", () => {
    const text =
      'meta:\n  advantage_plus: "off"\ngoogle_ads:\n  pmax:\n    x: "off"\n  demand_gen:\n    auto_video: "off"\n    adaptive_layouts: "off"\nlinkedin:\n  audience_expansion: "off"\n';
    expect(parseDgPolicy(text)).toEqual(OFF_OFF);
  });

  it("fails closed when google_ads.demand_gen is not declared", () => {
    expect(() => parseDgPolicy("google_ads: {}\n")).toThrow(/demand_gen/);
    expect(() => parseDgPolicy('meta:\n  x: "off"\n')).toThrow(PolicyError);
  });

  it("fails closed on one undeclared setting rather than defaulting it", () => {
    expect(() => parseDgPolicy(doc('    auto_video: "off"\n'))).toThrow(/adaptive_layouts/);
  });

  it("rejects an invalid value", () => {
    expect(() => parseDgPolicy(doc('    auto_video: "disabled"\n    adaptive_layouts: "off"\n'))).toThrow(
      /disabled/
    );
  });

  it("rejects an unknown setting instead of ignoring a typo", () => {
    expect(() =>
      parseDgPolicy(doc('    auto_video: "off"\n    adaptive_layouts: "off"\n    auto_vidoe: "off"\n'))
    ).toThrow(/auto_vidoe/);
  });

  it("rejects a quoted boolean word, which PyYAML reads as a plain string", () => {
    expect(() => parseDgPolicy(doc('    auto_video: "false"\n    adaptive_layouts: "off"\n'))).toThrow(
      /false/
    );
  });
});

describe("resolveDgPolicy", () => {
  const folderWith = (body?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "dgpol-"));
    if (body !== undefined) {
      mkdirSync(join(dir, "google_ads", "config"), { recursive: true });
      writeFileSync(join(dir, POLICY_RELATIVE_PATH), body);
    }
    return dir;
  };

  it("reads the policy file under the client's folder", () => {
    const dir = folderWith(doc('    auto_video: "on"\n    adaptive_layouts: "off"\n'));
    const r = resolveDgPolicy(dir);
    expect(r.source).toBe("policy-file");
    expect(r.path).toBe(join(dir, POLICY_RELATIVE_PATH));
    expect(r.desired).toEqual({ [AUTO_VIDEO]: "OPTED_IN", [AUTO_IMAGE]: "OPTED_OUT" });
  });

  it("falls back to default-off when the client has no policy file", () => {
    const r = resolveDgPolicy(folderWith());
    expect(r).toEqual({ source: "default-off", path: null, desired: OFF_OFF });
  });

  it("falls back to default-off when the client has no folder configured", () => {
    expect(resolveDgPolicy("").source).toBe("default-off");
    expect(resolveDgPolicy(undefined).source).toBe("default-off");
  });

  it("throws on a malformed file rather than defaulting", () => {
    const dir = folderWith("google_ads:\n  demand_gen:\n    auto_video: maybe\n    adaptive_layouts: off\n");
    expect(() => resolveDgPolicy(dir)).toThrow(PolicyError);
  });

  const FORCEPOINT = "/Users/mark/claude-code/clients/forcepoint";
  it.skipIf(!existsSync(join(FORCEPOINT, POLICY_RELATIVE_PATH)))(
    "parses the real Forcepoint policy file the Python side reads (local only)",
    () => {
      expect(resolveDgPolicy(FORCEPOINT)).toMatchObject({ source: "policy-file", desired: OFF_OFF });
    }
  );
});

describe("buildAssetAutomationSettings", () => {
  const typeEnum = { [AUTO_VIDEO]: 12, [AUTO_IMAGE]: 10 };
  const statusEnum = { OPTED_IN: 2, OPTED_OUT: 3 };

  it("writes every managed type, each with its own declared status, in one list", () => {
    expect(
      buildAssetAutomationSettings({ [AUTO_VIDEO]: "OPTED_IN", [AUTO_IMAGE]: "OPTED_OUT" }, typeEnum, statusEnum)
    ).toEqual([
      { asset_automation_type: 12, asset_automation_status: 2 },
      { asset_automation_type: 10, asset_automation_status: 3 },
    ]);
  });

  it("refuses an automation type the client library does not know", () => {
    expect(() => buildAssetAutomationSettings({ NOPE: "OPTED_OUT" }, typeEnum, statusEnum)).toThrow(/NOPE/);
  });
});
