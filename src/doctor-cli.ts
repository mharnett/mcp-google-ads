#!/usr/bin/env node
// mcp-google-ads-doctor  —  diagnose a broken Claude Desktop + Google Ads
// setup without reading stack traces. Runs a fixed sequence of checks and
// prints pass/fail/warn per check with actionable next steps.
//
// Checks:
//   1. Node version >= 18 (MCP SDK requirement)
//   2. Claude Desktop config file exists
//   3. Claude Desktop config parses as JSON
//   4. google-ads registered in mcpServers
//   5. Credentials file exists
//   6. Credentials file has required fields (refresh_token, customer_id)
//   7. customer_id is a leaf account (warns if it equals mcc_customer_id)
//
// Collect-all semantics: every check runs regardless of earlier failures,
// because the user wants the full picture on a single run, not one-error-
// at-a-time debugging.

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { credentialsFilePath } from "./credentials.js";
import { resolveDefaultConfigPath } from "./install-cli.js";

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export type FetchLatestVersion = () => Promise<string>;

export interface DoctorOptions {
  configPath?: string;
  credentialsPath?: string;
  fetchLatestVersion?: FetchLatestVersion;
  installedVersion?: string;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const cfgPath = opts.configPath ?? resolveDefaultConfigPath();
  const credsPath = opts.credentialsPath ?? credentialsFilePath;

  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());

  const cfgExists = existsSync(cfgPath);
  checks.push({
    name: "claude_desktop_config exists",
    status: cfgExists ? "pass" : "fail",
    detail: cfgExists
      ? cfgPath
      : `Not found at ${cfgPath}. Run: npx mcp-google-ads-install`,
  });

  let cfg: unknown = null;
  let cfgParseOk = false;
  if (cfgExists) {
    try {
      cfg = JSON.parse(readFileSync(cfgPath, "utf8") || "{}");
      cfgParseOk = true;
    } catch (err) {
      cfgParseOk = false;
    }
    checks.push({
      name: "claude_desktop_config is valid JSON",
      status: cfgParseOk ? "pass" : "fail",
      detail: cfgParseOk ? "parsed ok" : `${cfgPath} is not valid JSON. Fix syntax or delete the file and re-run mcp-google-ads-install.`,
    });
  } else {
    checks.push({
      name: "claude_desktop_config is valid JSON",
      status: "fail",
      detail: "config file missing — cannot check JSON validity",
    });
  }

  const mcpServers = (cfgParseOk && cfg && typeof cfg === "object"
    ? ((cfg as { mcpServers?: Record<string, unknown> }).mcpServers ?? {})
    : {}) as Record<string, unknown>;
  const registered = Boolean(mcpServers["google-ads"]);
  checks.push({
    name: "google-ads registered in claude_desktop_config",
    status: registered ? "pass" : "fail",
    detail: registered
      ? "entry present under mcpServers.google-ads"
      : "not registered. Run: npx mcp-google-ads-install",
  });

  const credsExist = existsSync(credsPath);
  checks.push({
    name: "credentials file exists",
    status: credsExist ? "pass" : "fail",
    detail: credsExist
      ? credsPath
      : `Not found at ${credsPath}. Run: npx mcp-google-ads-auth`,
  });

  let creds: Record<string, unknown> = {};
  if (credsExist) {
    try {
      creds = JSON.parse(readFileSync(credsPath, "utf8"));
    } catch {
      // fall through -- next checks will fail
    }
  }

  const hasRefresh = typeof creds.refresh_token === "string" && creds.refresh_token.length > 0;
  const hasCustomerId = typeof creds.customer_id === "string" && creds.customer_id.length > 0;
  checks.push({
    name: "credentials file has refresh_token and customer_id",
    status: hasRefresh && hasCustomerId ? "pass" : credsExist ? "fail" : "warn",
    detail: credsExist
      ? hasRefresh && hasCustomerId
        ? "both fields present"
        : "missing required fields. Re-run: npx mcp-google-ads-auth"
      : "credentials file missing — cannot check",
  });

  const customerId = typeof creds.customer_id === "string" ? creds.customer_id : "";
  const mccId = typeof creds.mcc_customer_id === "string" ? creds.mcc_customer_id : "";
  const isMccTerminal = customerId.length > 0 && customerId === mccId;
  checks.push({
    name: "customer_id is a leaf account, not an MCC",
    status: !hasCustomerId ? "warn" : isMccTerminal ? "warn" : "pass",
    detail: !hasCustomerId
      ? "customer_id missing — cannot check"
      : isMccTerminal
        ? `customer_id (${customerId}) equals mcc_customer_id — this is a Manager account. Most tools need a leaf. Re-run: npx mcp-google-ads-auth and pick a client under the MCC.`
        : `leaf account (customer_id=${customerId}${mccId ? `, under MCC ${mccId}` : ", direct access"})`,
  });

  checks.push(await checkInstalledIsLatest(opts));

  return checks;
}

async function checkInstalledIsLatest(opts: DoctorOptions): Promise<DoctorCheck> {
  const installed = opts.installedVersion ?? readInstalledVersion();
  const fetcher = opts.fetchLatestVersion ?? fetchLatestVersionFromNpm;
  const name = "installed version is up to date";
  if (!installed) {
    return { name, status: "warn", detail: "could not read installed version from package.json" };
  }
  let latest: string;
  try {
    latest = await fetcher();
  } catch (err) {
    return {
      name,
      status: "warn",
      detail: `could not reach npm registry (${err instanceof Error ? err.message : String(err)}). Installed ${installed}. Skip offline.`,
    };
  }
  if (!latest) {
    return { name, status: "warn", detail: `registry returned no version. Installed ${installed}.` };
  }
  if (installed === latest) {
    return { name, status: "pass", detail: `${installed} (latest on npm)` };
  }
  if (semverLt(installed, latest)) {
    return {
      name,
      status: "warn",
      detail: `installed ${installed}, latest on npm is ${latest}. Upgrade: npx -y mcp-google-ads@latest (and fully quit + reopen Claude Desktop).`,
    };
  }
  return { name, status: "pass", detail: `${installed} (ahead of npm latest ${latest}; dev build?)` };
}

function readInstalledVersion(): string | null {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

async function fetchLatestVersionFromNpm(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch("https://registry.npmjs.org/mcp-google-ads/latest", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string") {
      throw new Error("registry response missing version field");
    }
    return body.version;
  } finally {
    clearTimeout(timer);
  }
}

function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

function checkNodeVersion(): DoctorCheck {
  const match = process.version.match(/^v(\d+)\./);
  const major = match ? parseInt(match[1], 10) : 0;
  return {
    name: "node version >= 18",
    status: major >= 18 ? "pass" : "fail",
    detail: major >= 18 ? process.version : `${process.version} is too old. Install Node 18+ from https://nodejs.org/`,
  };
}

function renderChecks(checks: DoctorCheck[]): string {
  const icon = (s: DoctorCheck["status"]) => (s === "pass" ? "✓" : s === "warn" ? "⚠" : "✗");
  const lines = ["", "mcp-google-ads — diagnostic", ""];
  for (const c of checks) {
    lines.push(`  ${icon(c.status)} ${c.name}`);
    lines.push(`      ${c.detail}`);
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  lines.push("");
  if (failed === 0 && warned === 0) {
    lines.push("All checks passed. If Claude Desktop still shows the MCP as disconnected,");
    lines.push("fully quit Claude Desktop (Cmd+Q) and reopen it.");
  } else {
    lines.push(`${failed} failure${failed === 1 ? "" : "s"}, ${warned} warning${warned === 1 ? "" : "s"}. See details above.`);
  }
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv: string[]): DoctorOptions & { help: boolean } {
  const out: DoctorOptions & { help: boolean } = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--config" && argv[i + 1]) out.configPath = argv[++i];
    else if (a === "--credentials" && argv[i + 1]) out.credentialsPath = argv[++i];
  }
  return out;
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stderr.write("mcp-google-ads-doctor — diagnose Claude Desktop + Google Ads MCP setup\n");
    return 0;
  }
  const checks = await runDoctor(args);
  process.stdout.write(renderChecks(checks));
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

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
  run().then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
