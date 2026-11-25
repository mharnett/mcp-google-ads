// Preloaded (NODE_OPTIONS --import, see jailSpawnedServers.ts) into every node
// process a test starts. A process running a script under MCP_TEST_JAIL_ROOT
// (this repo's dist/) is refused any connection or DNS lookup that is not
// loopback, and one JSON line per start and per attempt goes to
// MCP_TEST_JAIL_LOG. Other processes, such as npm, are left alone.
import dns from "node:dns";
import net from "node:net";
import { appendFileSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const { MCP_TEST_JAIL_ROOT: root, MCP_TEST_JAIL_LOG: log } = process.env;

function relativeScript() {
  try {
    const rel = path.relative(realpathSync(root), realpathSync(process.argv[1]));
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
  } catch {
    return null; // no script (node -e), or no root: not ours
  }
}

const script = root && log ? relativeScript() : null;
if (script !== null) {
  const record = (event) => appendFileSync(log, JSON.stringify({ script, args: process.argv.slice(2), ...event }) + "\n");
  const refuse = (to) => {
    record({ event: "attempt", to });
    return Object.assign(new Error(`network is disabled in this test process (${to})`), { code: "ECONNREFUSED" });
  };
  const isLoopback = (host) => /^(localhost|127(\.\d+){3}|\[?::1\]?)$/i.test(String(host ?? "localhost"));
  record({ event: "start" });

  // net.connect, tls.connect, http(s), fetch and gRPC all end in Socket#connect.
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const target =
      first !== null && typeof first === "object"
        ? first
        : typeof first === "string" && Number.isNaN(Number(first))
          ? { path: first }
          : { port: first, host: typeof args[1] === "string" ? args[1] : undefined };
    if (target.path || isLoopback(target.host)) return connect.apply(this, args);
    const err = refuse(`${target.host}:${target.port}`);
    process.nextTick(() => this.destroy(err));
    return this;
  };
  // gRPC resolves the host itself before it connects.
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "resolveTxt", "resolveSrv"]) {
    const original = dns[name];
    dns[name] = (host, ...rest) =>
      isLoopback(host) ? original(host, ...rest) : void process.nextTick(rest[rest.length - 1], refuse(`dns ${host}`));
    const originalPromise = dns.promises[name];
    dns.promises[name] = async (host, ...rest) => {
      if (isLoopback(host)) return originalPromise(host, ...rest);
      throw refuse(`dns ${host}`);
    };
  }
  syncBuiltinESMExports();
}
