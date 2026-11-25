#!/usr/bin/env node
// mcp-google-ads-install  —  write the Claude Desktop config entry for users
// so they never have to hand-edit claude_desktop_config.json.
//
// Flow:
//   1. Resolve the Claude Desktop config path for the current platform.
//   2. Read it (or start empty); parse as JSON; refuse to clobber invalid JSON.
//   3. Ensure mcpServers.google-ads = { command: "npx", args: ["-y", "mcp-google-ads@latest"], env: ... }.
//      All other keys (theme, sibling MCPs, unrelated top-level config) are
//      preserved byte-for-byte via object spread, and so is an existing
//      google-ads entry's env: that is where the user's developer token lives.
//   4. Write back with 2-space indent + trailing newline.
//
// Idempotent: running twice yields identical content. Safe to re-run after
// future version bumps — user just gets the latest config each time.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { dirname, join } from "path";

interface InstallOptions {
  configPath?: string;
  customerId?: string;
}

export function resolveDefaultConfigPath(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    default:
      // Linux / Claude Desktop isn't officially supported here yet, but some
      // users run it via snap or an unofficial build; follow XDG convention.
      return join(home, ".config", "Claude", "claude_desktop_config.json");
  }
}

type ConfigShape = {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

/** The env block of a mcpServers entry, or {} when it has none worth keeping. */
export function entryEnv(entry: unknown): Record<string, unknown> {
  const env = (entry as { env?: unknown } | null | undefined)?.env;
  return env && typeof env === "object" && !Array.isArray(env) ? (env as Record<string, unknown>) : {};
}

/** Whether an entry's env sets a developer token. Presence only: the value is never returned. */
export function entryHasDeveloperToken(entry: unknown): boolean {
  const value = entryEnv(entry).GOOGLE_ADS_DEVELOPER_TOKEN;
  return typeof value === "string" && value.trim().length > 0;
}

export function installIntoConfig(opts: InstallOptions = {}): { path: string; existed: boolean; hasDeveloperToken: boolean } {
  const configPath = opts.configPath ?? resolveDefaultConfigPath();
  const existed = existsSync(configPath);

  let config: ConfigShape = {};
  if (existed) {
    const raw = readFileSync(configPath, "utf8");
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          config = parsed as ConfigShape;
        }
      } catch {
        throw new Error(
          `Claude Desktop config at ${configPath} is not valid JSON. ` +
            `Refusing to overwrite. Open the file, fix the syntax (or delete ` +
            `it to start fresh), and re-run.`,
        );
      }
    }
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
  }

  const normalizedCustomerId = opts.customerId?.replace(/-/g, "");
  const entry: Record<string, unknown> = {
    command: "npx",
    args: ["-y", "mcp-google-ads@latest"],
  };
  const env = {
    ...entryEnv(config.mcpServers?.["google-ads"]),
    ...(normalizedCustomerId ? { GOOGLE_ADS_CUSTOMER_ID: normalizedCustomerId } : {}),
  };
  if (Object.keys(env).length > 0) {
    entry.env = env;
  }

  const nextConfig: ConfigShape = {
    ...config,
    mcpServers: {
      ...(config.mcpServers ?? {}),
      "google-ads": entry,
    },
  };

  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2) + "\n", { mode: 0o644 });
  return { path: configPath, existed, hasDeveloperToken: entryHasDeveloperToken(entry) };
}

function parseArgs(argv: string[]): InstallOptions & { help: boolean } {
  const out: InstallOptions & { help: boolean } = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--customer-id" && argv[i + 1]) out.customerId = argv[++i];
    else if (a === "--config" && argv[i + 1]) out.configPath = argv[++i];
  }
  return out;
}

function printHelp(): void {
  process.stderr.write(
    [
      "mcp-google-ads-install  —  add mcp-google-ads to Claude Desktop config",
      "",
      "Usage:",
      "  npx mcp-google-ads-install",
      "  npx mcp-google-ads-install --customer-id 111-222-3333",
      "",
      "Options:",
      "  --customer-id <id>   Pin the customer ID in the config (skips auth picker later)",
      "  --config <path>      Override the default Claude Desktop config path",
      "  -h, --help           Show this help",
      "",
      `Default config path: ${resolveDefaultConfigPath()}`,
      "",
    ].join("\n"),
  );
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const result = installIntoConfig(args);
  const steps = [
    ...(result.hasDeveloperToken ? [] : ["Add GOOGLE_ADS_DEVELOPER_TOKEN to mcpServers.google-ads.env in that file."]),
    "Fully quit Claude Desktop (Cmd+Q on macOS, not just close the window).",
    "Reopen Claude Desktop.",
    "If you haven't authenticated yet, run: npx mcp-google-ads-auth",
  ];
  process.stdout.write(
    [
      "",
      `✓ ${result.existed ? "Updated" : "Created"}: ${result.path}`,
      "",
      "Next steps:",
      ...steps.map((step, i) => `  ${i + 1}. ${step}`),
      "",
    ].join("\n"),
  );
}

import { fileURLToPath } from "url";
import { realpathSync } from "fs";

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run().catch((err) => {
    process.stderr.write(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
