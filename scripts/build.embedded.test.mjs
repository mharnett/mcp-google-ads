/**
 * What the build bakes into dist/, proved by building.
 *
 * The OAuth client id and secret are embedded; a developer token never is,
 * whatever the build environment holds. Each build runs the real
 * scripts/build.mjs in a throwaway copy of the tree, never in this checkout:
 * `npm publish` runs this suite between its build and its pack (prepublishOnly),
 * so a fake written to dist/ here would be published.
 *
 * Containment: every EMBEDDED_* value is a fake that replaces whatever this
 * process holds, no GOOGLE_ADS_* variable is passed on, and the one server
 * started runs under the network jail with a throwaway HOME.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jailSpawnedServers } from "../tests/helpers/jailSpawnedServers.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Letters only: scan-history-secrets.mjs reads 16+ characters with digits on a
// client_secret / developer_token line as a leaked literal.
const FAKE_ID = "FAKE-EMBEDDED-CLIENT-ID-FOR-BUILD-TEST";
const FAKE_SECRET = "FAKE-EMBEDDED-CLIENT-SECRET-FOR-BUILD-TEST";
const FAKE_TOKEN = "FAKE-EMBEDDED-DEVELOPER-TOKEN-FOR-BUILD-TEST";

/** This process's env without EMBEDDED_* and GOOGLE_ADS_*, plus `extra`, with the repo's tsc on PATH. */
function buildEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(EMBEDDED_|GOOGLE_ADS_)/i.test(key)) env[key] = value;
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = [path.join(REPO, "node_modules", ".bin"), env[pathKey]].filter(Boolean).join(path.delimiter);
  return { ...env, ...extra };
}

let root;

/** Run the real build in a copy of the tree holding only `srcFiles` (all of src/ by default). */
function build(name, extraEnv, srcFiles) {
  const tree = path.join(root, name);
  mkdirSync(path.join(tree, "scripts"), { recursive: true });
  cpSync(path.join(REPO, "scripts", "build.mjs"), path.join(tree, "scripts", "build.mjs"));
  cpSync(path.join(REPO, "package.json"), path.join(tree, "package.json"));
  // node_modules is linked, not copied. Without preserveSymlinks tsc names the
  // checkout's path in declarations and refuses (TS2742).
  const tsconfig = JSON.parse(readFileSync(path.join(REPO, "tsconfig.json"), "utf8"));
  tsconfig.compilerOptions.preserveSymlinks = true;
  writeFileSync(path.join(tree, "tsconfig.json"), JSON.stringify(tsconfig));
  if (srcFiles) {
    mkdirSync(path.join(tree, "src"));
    for (const file of srcFiles) cpSync(path.join(REPO, "src", file), path.join(tree, "src", file));
  } else {
    cpSync(path.join(REPO, "src"), path.join(tree, "src"), { recursive: true });
  }
  symlinkSync(path.join(REPO, "node_modules"), path.join(tree, "node_modules"), "junction");
  const run = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: tree, env: buildEnv(extraEnv), encoding: "utf8", timeout: 120_000 });
  expect(run.status, `build ${name} failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
  const dist = path.join(tree, "dist");
  return { dist, stderr: run.stderr, info: JSON.parse(readFileSync(path.join(dist, "build-info.json"), "utf8")) };
}

/** Every file under dir, as [relative path, text]. */
function contents(dir, base = dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? contents(full, base) : [[path.relative(base, full), readFileSync(full, "utf8")]];
  });
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "gads-build-"));
});
afterAll(() => {
  // The links first, so no recursive delete ever meets the real node_modules.
  for (const tree of readdirSync(root)) unlinkSync(path.join(root, tree, "node_modules"));
  rmSync(root, { recursive: true, force: true });
});

describe("a build given all three EMBEDDED_* values", () => {
  let built;
  let files;

  beforeAll(() => {
    built = build("full", { EMBEDDED_CLIENT_ID: FAKE_ID, EMBEDDED_CLIENT_SECRET: FAKE_SECRET, EMBEDDED_DEVELOPER_TOKEN: FAKE_TOKEN });
    files = contents(built.dist);
  }, 150_000);

  const holding = (text) => files.filter(([, body]) => body.includes(text)).map(([name]) => name);

  it("control: is a whole build, with the client id and secret baked in", () => {
    expect(files.map(([name]) => name)).toEqual(
      expect.arrayContaining(["index.js", "auth-cli.js", "credentials.js", "credentials.d.ts", "embedded-secrets.js", "embedded-secrets.js.map", "build-info.json"]),
    );
    expect(holding(FAKE_ID)).toEqual(["embedded-secrets.js"]);
    expect(holding(FAKE_SECRET)).toEqual(["embedded-secrets.js"]);
  });

  it("holds the developer token in no file", () => {
    expect(holding(FAKE_TOKEN)).toEqual([]);
  });

  it("reads no EMBEDDED_DEVELOPER_TOKEN at run time either", () => {
    expect(holding("EMBEDDED_DEVELOPER_TOKEN")).toEqual([]);
  });

  describe("its server", () => {
    let jail;
    beforeAll(() => {
      jail = jailSpawnedServers(built.dist);
    });
    afterAll(() => jail.restore());

    const FRAMES =
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ]
        .map((frame) => JSON.stringify(frame))
        .join("\n") + "\n";

    function start(name, env) {
      const log = jail.newLog(name);
      const run = spawnSync(process.execPath, [path.join(built.dist, "index.js")], {
        env: { ...process.env, ...env, MCP_TEST_JAIL_LOG: log },
        input: FRAMES,
        encoding: "utf8",
        timeout: 30_000,
      });
      const replies = run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      return {
        stderr: run.stderr,
        tools: replies.find((reply) => reply.id === 2)?.result?.tools ?? [],
        attempts: jail.events(log).filter((event) => event.event === "attempt"),
      };
    }

    const SIGNED_IN = { GOOGLE_ADS_REFRESH_TOKEN: "fake-refresh-token", GOOGLE_ADS_CUSTOMER_ID: "1234567890" };
    const told = (stderr) => stderr.split("GOOGLE_ADS_DEVELOPER_TOKEN is not set").length - 1;

    it("without a developer token: says so once, and still serves tools/list", () => {
      const run = start("no-token", SIGNED_IN);
      expect(told(run.stderr)).toBe(1);
      expect(run.stderr).toContain("https://console.cloud.google.com/google/ads-apis/overview");
      // The old start-up path guessed at it ("Auth check returned non-auth error (may be OK)").
      expect(run.stderr).not.toMatch(/may be OK|Auth check|re-?authenticate|published without/i);
      // Only the token is missing, so signing in again is not the way out.
      expect(run.stderr).not.toContain("mcp-google-ads-auth");
      expect(run.tools.map((tool) => tool.name)).toContain("google_ads_list_campaigns");
      expect(run.attempts).toEqual([]);
    }, 45_000);

    it("says it with a config.json and the start-up auth check turned off, where nothing else looks", () => {
      const config = path.join(built.dist, "..", "config.json");
      const clients = { example: { customer_id: "1234567890", name: "Example", folder: "/example" } };
      writeFileSync(config, JSON.stringify({ google_ads: { mcc_customer_id: "" }, clients, defaults: {} }));
      try {
        expect(told(start("no-token-skip", { ...SIGNED_IN, MCP_GOOGLE_ADS_SKIP_STARTUP_CHECK: "1" }).stderr)).toBe(1);
      } finally {
        rmSync(config);
      }
    }, 45_000);

    it("without anything set: names the sign-in too, in the same message", () => {
      const run = start("nothing", {});
      expect(told(run.stderr)).toBe(1);
      expect(run.stderr).toContain("refresh_token, customer_id");
      expect(run.stderr).toContain("npx mcp-google-ads-auth");
    }, 45_000);

    it("control: with a developer token in the env it is not mentioned, and the auth check runs", () => {
      const run = start("token", { ...SIGNED_IN, GOOGLE_ADS_DEVELOPER_TOKEN: "fake-developer-token" });
      expect(told(run.stderr)).toBe(0);
      expect([...new Set(run.attempts.map((attempt) => attempt.to))]).toEqual(["oauth2.googleapis.com:443"]);
    }, 45_000);
  });
});

describe("build-info.json embeddedSecrets means the client id and secret", () => {
  // Only embedded-secrets.ts: what is under test is the build script's own report.
  const small = (name, env) => build(name, env, ["embedded-secrets.ts"]);

  it("true with those two alone, and the build warns about nothing", () => {
    const { info, stderr } = small("id-and-secret", { EMBEDDED_CLIENT_ID: FAKE_ID, EMBEDDED_CLIENT_SECRET: FAKE_SECRET });
    expect(info.embeddedSecrets).toBe(true);
    expect(stderr).not.toMatch(/missing/i);
  }, 60_000);

  it.each([
    ["EMBEDDED_CLIENT_SECRET", { EMBEDDED_CLIENT_ID: FAKE_ID }],
    ["EMBEDDED_CLIENT_ID", { EMBEDDED_CLIENT_SECRET: FAKE_SECRET }],
  ])("false without %s, and a developer token does not stand in for it", (missing, env) => {
    const { info, stderr } = small(`no-${missing}`, { ...env, EMBEDDED_DEVELOPER_TOKEN: FAKE_TOKEN });
    expect(info.embeddedSecrets).toBe(false);
    expect(stderr).toMatch(new RegExp(`missing: ${missing}\\n`));
  }, 60_000);
});

// The two gates in front of a publish take the same environments: the npm hook
// (check-embedded.mjs) and publish.yml's own check, run as GitHub runs it.
function publishYmlCheck() {
  const lines = readFileSync(path.join(REPO, ".github/workflows/publish.yml"), "utf8").split(/\r?\n/);
  const step = lines.findIndex((line) => line.includes("- name: Verify embedded secrets are configured"));
  const run = lines.findIndex((line, i) => i > step && /^\s+run: \|$/.test(line));
  const indent = lines[run].match(/^ */)[0].length;
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && line.match(/^ */)[0].length <= indent) break;
    body.push(line);
  }
  return body.join("\n");
}

const GATES = [["check-embedded.mjs", (env) => spawnSync(process.execPath, [path.join(REPO, "scripts", "check-embedded.mjs")], { env: buildEnv(env), encoding: "utf8" })]];
if (process.platform !== "win32") {
  GATES.push(["publish.yml's check", (env) => spawnSync("bash", ["-e", "-c", publishYmlCheck()], { env: buildEnv(env), encoding: "utf8" })]);
}

describe.each(GATES)("%s", (_name, gate) => {
  it("passes with the client id and secret alone", () => {
    const run = gate({ EMBEDDED_CLIENT_ID: FAKE_ID, EMBEDDED_CLIENT_SECRET: FAKE_SECRET });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });

  it.each([
    ["EMBEDDED_CLIENT_ID", { EMBEDDED_CLIENT_SECRET: FAKE_SECRET }],
    ["EMBEDDED_CLIENT_SECRET", { EMBEDDED_CLIENT_ID: FAKE_ID }],
  ])("refuses without %s, naming only it", (missing, env) => {
    const run = gate({ ...env, EMBEDDED_DEVELOPER_TOKEN: FAKE_TOKEN });
    expect(run.status).toBe(1);
    const out = run.stdout + run.stderr;
    expect(out.match(/EMBEDDED_[A-Z_]+/g)).toEqual([missing]);
  });
});
