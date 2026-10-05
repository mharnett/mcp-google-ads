// Demand Gen asset-automation policy, read from the client's own policy file
// at <client folder>/google_ads/config/platform_policy.yaml -- the same file the
// client's Python DG builders and its daily audit read (forcepoint repo:
// google_ads/shared/dg_asset_automation.py). Behaviour mirrors that module:
//
//   * No policy file (or no client folder) -> default-off for both types, the
//     MCP's behaviour before policy files existed (Mark, 2026-10-05).
//   * A policy file that exists but is malformed -> PolicyError. Resolve BEFORE
//     creating the ad, so a broken file refuses the create.
//   * "unmanaged" leaves that type out of the write entirely.
//
// The file is YAML; the MCP has no YAML dependency, so this reads only the
// google_ads.demand_gen block (block-style mappings, scalar values, comments)
// and treats anything else inside that block as malformed.

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const AUTO_VIDEO = "GENERATE_VIDEOS_FROM_OTHER_ASSETS";
export const AUTO_IMAGE = "GENERATE_DESIGN_VERSIONS_FOR_IMAGES";
export const POLICY_RELATIVE_PATH = join("google_ads", "config", "platform_policy.yaml");

export const SETTING_TYPES: Record<string, string> = {
  auto_video: AUTO_VIDEO,
  adaptive_layouts: AUTO_IMAGE,
};

export type AutomationStatus = "OPTED_IN" | "OPTED_OUT";
export type DesiredState = Record<string, AutomationStatus>;

export interface ResolvedPolicy {
  source: "policy-file" | "default-off";
  path: string | null;
  desired: DesiredState;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

const DEFAULT_OFF: DesiredState = { [AUTO_VIDEO]: "OPTED_OUT", [AUTO_IMAGE]: "OPTED_OUT" };

// Bare scalars follow YAML 1.1 (PyYAML): off/no/false and on/yes/true are
// booleans. Quoted scalars are plain strings, so a quoted "false" is invalid.
const BARE: Record<string, AutomationStatus | null> = {
  off: "OPTED_OUT", no: "OPTED_OUT", false: "OPTED_OUT",
  on: "OPTED_IN", yes: "OPTED_IN", true: "OPTED_IN",
  unmanaged: null,
};
const QUOTED: Record<string, AutomationStatus | null> = {
  off: "OPTED_OUT",
  on: "OPTED_IN",
  unmanaged: null,
};

interface Line {
  indent: number;
  key: string;
  value: string; // "" for a nested mapping
  n: number;
}

function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const body = stripComment(raw).replace(/\s+$/, "");
    if (!body.trim()) return;
    const indent = body.length - body.trimStart().length;
    const m = body.trim().match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (!m) {
      out.push({ indent, key: "", value: body.trim(), n: i + 1 });
      return;
    }
    out.push({ indent, key: m[1], value: (m[2] ?? "").trim(), n: i + 1 });
  });
  return out;
}

function parseValue(setting: string, raw: string, where: string): AutomationStatus | null {
  const quoted = raw.match(/^(["'])(.*)\1$/);
  const table = quoted ? QUOTED : BARE;
  const word = quoted ? quoted[2] : raw;
  if (!Object.prototype.hasOwnProperty.call(table, word)) {
    throw new PolicyError(`${where}: demand_gen.${setting} = ${raw}; expected off, on or unmanaged`);
  }
  return table[word];
}

export function parseDgPolicy(text: string, where = "platform policy"): DesiredState {
  const ls = lines(text);
  const gIdx = ls.findIndex((l) => l.indent === 0 && l.key === "google_ads" && l.value === "");
  if (gIdx < 0) throw new PolicyError(`${where}: google_ads.demand_gen is not declared`);

  // Children of google_ads: lines after it with indent > 0, until the next top-level key.
  let end = ls.findIndex((l, i) => i > gIdx && l.indent === 0);
  if (end < 0) end = ls.length;
  const block = ls.slice(gIdx + 1, end);
  const childIndent = block.length ? block[0].indent : 0;
  const dIdx = block.findIndex((l) => l.indent === childIndent && l.key === "demand_gen" && l.value === "");
  if (dIdx < 0) throw new PolicyError(`${where}: google_ads.demand_gen is not declared`);

  const settings: Record<string, string> = {};
  for (const l of block.slice(dIdx + 1)) {
    if (l.indent <= childIndent) break;
    if (!l.key || l.value === "") {
      throw new PolicyError(`${where}: line ${l.n}: unreadable entry under google_ads.demand_gen`);
    }
    settings[l.key] = l.value;
  }

  const unknown = Object.keys(settings).filter((k) => !(k in SETTING_TYPES)).sort();
  if (unknown.length) {
    throw new PolicyError(`${where}: unknown demand_gen setting(s): ${unknown.join(", ")}`);
  }

  const desired: DesiredState = {};
  for (const [setting, typeName] of Object.entries(SETTING_TYPES)) {
    if (!(setting in settings)) throw new PolicyError(`${where}: demand_gen.${setting} is not declared`);
    const status = parseValue(setting, settings[setting], where);
    if (status !== null) desired[typeName] = status;
  }
  return desired;
}

export function resolveDgPolicy(folder: string | null | undefined): ResolvedPolicy {
  if (!folder) return { source: "default-off", path: null, desired: { ...DEFAULT_OFF } };
  const path = join(folder, POLICY_RELATIVE_PATH);
  if (!existsSync(path)) return { source: "default-off", path: null, desired: { ...DEFAULT_OFF } };
  return { source: "policy-file", path, desired: parseDgPolicy(readFileSync(path, "utf-8"), path) };
}

export function buildAssetAutomationSettings(
  desired: Record<string, string>,
  typeEnum: Record<string, number>,
  statusEnum: Record<string, number>
): Array<{ asset_automation_type: number; asset_automation_status: number }> {
  const unknown = Object.keys(desired).filter((n) => typeEnum[n] === undefined);
  if (unknown.length) {
    throw new Error(`Unknown AssetAutomationType value(s): ${unknown.join(", ")}`);
  }
  return Object.entries(desired).map(([name, status]) => ({
    asset_automation_type: typeEnum[name],
    asset_automation_status: statusEnum[status],
  }));
}
