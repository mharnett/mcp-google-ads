import { spawnSync } from "child_process";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Regression: Claude Desktop runs the MCP server with stderr piped (not a
// TTY). v1.2.2 and earlier gated pino's stderr destination behind
// process.stderr.isTTY, so non-TTY runs silently defaulted to stdout. Pino
// JSON log frames then collided with MCP JSON-RPC and Claude Desktop rejected
// every message with an "unrecognized_keys: level, time, pid, hostname, msg"
// schema error. Logs MUST go to stderr; stdout is reserved for JSON-RPC.
describe("logger destination under non-TTY subprocess (Claude Desktop)", () => {
  it("writes log output to stderr, never stdout", () => {
    const harness = resolve(__dirname, "..", "dist", "resilience.js");
    const probe = `
import { logger } from ${JSON.stringify(harness)};
logger.info({ probe: "stdout-pollution-check" }, "canary log line");
// Give pino a tick to flush before exit.
setTimeout(() => process.exit(0), 50);
`;
    const result = spawnSync("node", ["--input-type=module", "-e", probe], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("canary log line");
  });
});
