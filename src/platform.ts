// ============================================
// CROSS-PLATFORM DISPATCH HELPERS
// ============================================
// This module is the SINGLE boundary for platform-dependent behavior.
// Any code that would otherwise shell out with a platform-specific command
// (e.g. `open`, `start`, `xdg-open`) or hardcode a platform-specific path
// MUST go through here. The portability test suite enforces this.
//
// Why: the prior `get-refresh-token.cjs` helper used `exec("open ...")`
// directly, which is Mac-only. That bug would have broken Windows testers
// on first try. Centralizing all platform dispatch in one file means there
// is exactly one place to audit for cross-platform correctness.

import envPaths from "env-paths";
import openModule from "open";
import { createServer } from "net";
import { platform } from "os";
import path from "path";

// ============================================
// CONFIG DIRECTORY
// ============================================
// Uses env-paths to get the correct per-user config directory on each OS:
//   macOS:   ~/Library/Preferences/mcp-google-ads-nodejs/
//   Linux:   ~/.config/mcp-google-ads-nodejs/
//   Windows: %APPDATA%/mcp-google-ads-nodejs/Config/

const paths = envPaths("mcp-google-ads", { suffix: "nodejs" });

export const configDir = paths.config;
export const credentialsFilePath = path.join(paths.config, "credentials.json");

// ============================================
// BROWSER OPEN
// ============================================
// Uses the `open` npm package which handles platform dispatch internally
// (open on macOS, start on Windows, xdg-open on Linux). DO NOT use exec()
// with a literal command — the portability suite will fail the build.

export async function openBrowser(url: string): Promise<void> {
  await openModule(url);
}

// ============================================
// FREE PORT SCANNING
// ============================================
// OAuth redirect URIs can't be random — Google's Desktop OAuth client must
// have http://localhost registered. But the specific PORT can vary, and
// hardcoding a port (like the old 8085) fails if something else is using it.
// Instead we scan a range and use whichever is free.

const LOOPBACK_PORT_RANGE_START = 8085;
const LOOPBACK_PORT_RANGE_END = 8199;

export async function findFreeLoopbackPort(): Promise<number> {
  for (let port = LOOPBACK_PORT_RANGE_START; port <= LOOPBACK_PORT_RANGE_END; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `No free port found in range ${LOOPBACK_PORT_RANGE_START}-${LOOPBACK_PORT_RANGE_END}. ` +
      `Close other apps that might be listening (AirPlay Receiver on macOS often uses these ports) and try again.`,
  );
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

// ============================================
// PLATFORM INFO
// ============================================

export function currentPlatform(): "darwin" | "win32" | "linux" | "other" {
  const p = platform();
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "other";
}

export function isWindows(): boolean {
  return platform() === "win32";
}

export function isMac(): boolean {
  return platform() === "darwin";
}

// ============================================
// POSIX-ONLY SIGNAL HANDLERS
// ============================================
// SIGPIPE / SIGHUP / SIGUSR* do not exist on Windows. Registering a listener
// for them is a no-op on modern Node but may emit warnings or fail on older
// versions. Route any such handler through this helper so Windows never
// touches the native signal machinery, and so the portability test suite
// has a single sanctioned location for POSIX-only signal names.

export function onPosixSignal(
  signal: "SIGPIPE" | "SIGHUP" | "SIGUSR1" | "SIGUSR2" | "SIGQUIT",
  handler: () => void,
): void {
  if (platform() === "win32") return;
  // Cast is safe because we've excluded win32 above.
  process.on(signal as NodeJS.Signals, handler);
}
