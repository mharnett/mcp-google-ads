/**
 * Containment for tests that start the built server through code that passes
 * this process's env on, as the shared harness does (0.2.x spawns with
 * `{ ...process.env, ...startupEnv }`).
 *
 * Changes this process's env until restore(): no GOOGLE_ADS_* variable from
 * the developer's shell, a throwaway HOME (so the per-user credentials file is
 * not found) and networkJail.mjs preloaded into every node process. A server
 * started under it cannot reach anything but loopback, and everything it
 * tried is in events().
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface JailEvent {
  event: "start" | "attempt";
  /** Script path under the root, e.g. "index.js". */
  script: string;
  args: string[];
  /** For an attempt: "host:port" or "dns host". */
  to?: string;
}

export interface Jail {
  /** A log file of its own for one spawn, to pass as MCP_TEST_JAIL_LOG. */
  newLog(name: string): string;
  /** What the jailed processes did, oldest first. Default: every process not given its own log. */
  events(log?: string): JailEvent[];
  restore(): void;
}

export function jailSpawnedServers(root: string): Jail {
  const saved = { ...process.env };
  const dir = mkdtempSync(path.join(tmpdir(), "gads-jail-"));
  const home = path.join(dir, "home");
  mkdirSync(home);
  const newLog = (name: string) => {
    const file = path.join(dir, `${name}.jsonl`);
    writeFileSync(file, "");
    return file;
  };
  const defaultLog = newLog("jail");
  const preload = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "networkJail.mjs")).href;

  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GOOGLE_ADS_")) delete process.env[key];
  }
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    NODE_OPTIONS: [saved.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(" "),
    MCP_TEST_JAIL_ROOT: root,
    MCP_TEST_JAIL_LOG: defaultLog,
  });

  return {
    newLog,
    events: (log = defaultLog) =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JailEvent),
    restore() {
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) delete process.env[key];
      }
      Object.assign(process.env, saved);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
