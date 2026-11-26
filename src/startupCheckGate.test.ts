/**
 * The startup auth check does not hold `initialize`, and no tool call runs
 * ahead of it.
 *
 * main() used to await the check before connecting, so a slow or unreachable
 * Google left the client waiting on `initialize` and it could give up on the
 * server. The server now connects first. A tool call still waits until the
 * check has settled, pass or fail.
 *
 * Containment: the child gets a fixed env (a throwaway HOME, fake
 * credentials), not this process's. A preload replaces Socket#connect, DNS
 * lookups and fetch, and never calls the real ones: each attempt is held until
 * the test creates the release file, then refused.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = path.join(REPO_ROOT, "dist", "index.js");

const HELD_NETWORK = `
import dns from "node:dns";
import net from "node:net";
import { existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const held = [];
const released = () => existsSync(process.env.TEST_RELEASE_FILE);
const refusal = () => Object.assign(new Error("network is disabled in this test"), { code: "ECONNREFUSED" });
const hold = (what, refuse) => {
  process.stderr.write("[held-network] " + what + "\\n");
  if (released()) process.nextTick(refuse);
  else held.push(refuse);
};
setInterval(() => { if (released()) for (const refuse of held.splice(0)) refuse(); }, 50).unref();
net.Socket.prototype.connect = function () {
  hold("socket connect", () => this.destroy(refusal()));
  return this;
};
for (const name of ["lookup", "resolve", "resolve4", "resolve6", "resolveTxt", "resolveSrv"]) {
  dns[name] = (...args) => hold("dns " + name, () => args[args.length - 1](refusal()));
  dns.promises[name] = () => new Promise((_, reject) => hold("dns " + name, () => reject(refusal())));
}
globalThis.fetch = () => new Promise((_, reject) => hold("fetch", () => reject(refusal())));
syncBuiltinESMExports();
`;

const FAKE_ENV: Record<string, string> = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "fake-dev-token",
  GOOGLE_ADS_CLIENT_ID: "fake-client-id",
  GOOGLE_ADS_CLIENT_SECRET: "fake-client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "fake-refresh-token",
  GOOGLE_ADS_CUSTOMER_ID: "1234567890",
};

let home: string;
let releaseFile: string;
let proc: ChildProcess;
let stderr = "";
const replies = new Map<number, any>();

function send(id: number, method: string, params: unknown) {
  proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
}

async function reply(id: number, withinMs: number): Promise<any> {
  const deadline = Date.now() + withinMs;
  while (!replies.has(id)) {
    if (proc.exitCode !== null) throw new Error(`server exited (code ${proc.exitCode})\nstderr:\n${stderr}`);
    if (Date.now() > deadline) throw new Error(`no reply to request ${id} within ${withinMs}ms\nstderr:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  return replies.get(id);
}

beforeAll(() => {
  if (!existsSync(DIST_INDEX)) throw new Error(`${DIST_INDEX} is missing: run \`npm test\`, which builds first`);
  home = mkdtempSync(path.join(tmpdir(), "startup-gate-"));
  releaseFile = path.join(home, "release");
  const preload = path.join(home, "held-network.mjs");
  writeFileSync(preload, HELD_NETWORK);

  const env: Record<string, string> = {};
  // process.env lookups are case-insensitive on Windows, so these two cover it.
  for (const key of ["PATH", "SystemRoot"]) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    LOCALAPPDATA: path.join(home, "AppData"),
    MCP_DISABLE_UPDATE_CHECK: "1",
    TEST_RELEASE_FILE: releaseFile,
    ...FAKE_ENV,
  });

  proc = spawn(process.execPath, ["--import", pathToFileURL(preload).href, DIST_INDEX], {
    cwd: home,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stdin!.on("error", () => {});
  let buffered = "";
  proc.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop()!;
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line);
      if (typeof message.id === "number") replies.set(message.id, message);
    }
  });
  proc.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
});

afterAll(async () => {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const closed = new Promise((r) => proc.once("close", r));
    proc.kill("SIGKILL");
    await closed;
  }
  rmSync(home, { recursive: true, force: true });
});

// One server, in order: the check is held, then released and refused.
describe("startup auth check and the MCP handshake", () => {
  it("answers initialize and tools/list while the check is still waiting on the network", async () => {
    send(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "gate-test", version: "0.0.0" } });
    expect((await reply(1, 10_000)).result.serverInfo).toBeDefined();

    send(2, "tools/list", {});
    expect((await reply(2, 5_000)).result.tools.length).toBeGreaterThan(0);

    // The check really is pending: it reached for the network and was held.
    const deadline = Date.now() + 5_000;
    while (!stderr.includes("[held-network]") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(stderr).toContain("[held-network]");
  }, 30_000);

  // google_ads_get_client_context needs no network, so only the gate can delay it.
  it("holds a tool call until the check settles", async () => {
    send(3, "tools/call", { name: "google_ads_get_client_context", arguments: { working_directory: home } });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(replies.has(3), stderr).toBe(false);

    writeFileSync(releaseFile, "");
    expect((await reply(3, 60_000)).result.content[0].text).toBeDefined();
    // stderr and stdout are separate pipes, so the log can trail the reply.
    await expect.poll(() => stderr, { timeout: 10_000 }).toMatch(/Auth check (FAILED|returned non-auth error)/);
  }, 90_000);

  it("after a failed check, a tool call that needs the API fails", async () => {
    send(4, "tools/call", { name: "google_ads_list_campaigns", arguments: { customer_id: "1234567890" } });
    expect((await reply(4, 60_000)).result.isError).toBe(true);
  }, 90_000);
});
