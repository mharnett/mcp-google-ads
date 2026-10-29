// Audit trail for confirm_large_change overrides.
//
// Every override that lets a change past a magnitude ceiling appends one
// JSONL line to a local log (always, unless explicitly disabled) and posts
// one line to an incoming webhook when one is configured. Neither step may
// fail the write: the change has already been made by the time this runs,
// so errors are returned to the caller, never thrown.
//
// Config:
//   GOOGLE_ADS_MCP_OVERRIDE_LOG          JSONL path (default: <configDir>/overrides.jsonl)
//   GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL  Slack-compatible incoming webhook ({"text": ...})

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { configDir } from "./platform.js";

export interface OverrideLogTarget {
  /** JSONL file path. null disables the file log; undefined uses env / default. */
  logPath?: string | null;
  /** Incoming-webhook URL. null disables posting; undefined reads the env var. */
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
}

export interface OverrideEntry {
  tool: string;
  entity: string;
  old: string | number;
  new: string | number;
  change_pct?: number | null;
  reason: string | null;
}

export interface OverrideLogResult {
  logged: boolean;
  log_path: string | null;
  posted: boolean;
  log_error?: string;
  webhook_error?: string;
}

export function resolveOverrideLogTarget(
  env: NodeJS.ProcessEnv = process.env,
  target: OverrideLogTarget = {}
): { logPath: string | null; webhookUrl: string | null } {
  const logPath =
    target.logPath !== undefined
      ? target.logPath
      : env.GOOGLE_ADS_MCP_OVERRIDE_LOG || path.join(configDir, "overrides.jsonl");
  const webhookUrl =
    target.webhookUrl !== undefined ? target.webhookUrl : env.GOOGLE_ADS_MCP_OVERRIDE_WEBHOOK_URL || null;
  return { logPath, webhookUrl };
}

export function formatOverrideLine(entry: OverrideEntry): string {
  const pct =
    typeof entry.change_pct === "number"
      ? ` (${entry.change_pct >= 0 ? "+" : ""}${Math.round(entry.change_pct)}%)`
      : "";
  const line =
    `Google Ads large-change override: ${entry.tool} on ${entry.entity}: ` +
    `${entry.old} -> ${entry.new}${pct}. Reason: ${entry.reason ?? "(none given)"}`;
  return line.replace(/\s*\n\s*/g, " ");
}

export async function recordOverride(
  entry: OverrideEntry,
  target: OverrideLogTarget = {},
  now: Date = new Date()
): Promise<OverrideLogResult> {
  const { logPath, webhookUrl } = resolveOverrideLogTarget(process.env, target);
  const result: OverrideLogResult = { logged: false, log_path: logPath, posted: false };

  if (logPath) {
    try {
      await mkdir(path.dirname(logPath), { recursive: true });
      await appendFile(logPath, JSON.stringify({ timestamp: now.toISOString(), ...entry }) + "\n", "utf8");
      result.logged = true;
    } catch (e: any) {
      result.log_error = String(e?.message ?? e);
    }
  }

  if (webhookUrl) {
    const doFetch = target.fetchImpl ?? fetch;
    try {
      const resp = await doFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: formatOverrideLine(entry) }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) result.posted = true;
      else result.webhook_error = `webhook returned HTTP ${resp.status}`;
    } catch (e: any) {
      result.webhook_error = String(e?.message ?? e);
    }
  }

  return result;
}
