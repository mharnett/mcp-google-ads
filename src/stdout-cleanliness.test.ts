import { spawn } from "child_process";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Regression: dotenv v17 prints a "tip" line to stdout via console.log
// unless called with { quiet: true }. Since MCP uses stdout for JSON-RPC,
// that single line breaks Claude Desktop on first launch. See
// https://github.com/mharnett/mcp-google-ads/issues/2.
//
// Invariant: the server MUST write only valid JSON-RPC frames to stdout.
// Startup-time chatter (dotenv tips, @clack/prompts banners, stray
// console.log, dependency boot messages) breaks the transport.
//
// This test strips credentials so the bin exits early, then asserts that
// every non-empty line written to stdout before exit parses as JSON.
describe("bin stdout cleanliness on startup", () => {
  it("writes only JSON lines to stdout before exit", async () => {
    const bin = resolve(__dirname, "..", "dist", "index.js");

    const sanitizedEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      HOME: "/tmp",
    };

    const child = spawn("node", [bin], {
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizedEnv,
    });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();

    const exitCode = await new Promise<number | null>((done) => {
      const killTimer = setTimeout(() => child.kill("SIGTERM"), 4_000);
      child.once("exit", (code) => {
        clearTimeout(killTimer);
        done(code);
      });
    });

    const offendingLines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => {
        try {
          JSON.parse(l);
          return false;
        } catch {
          return true;
        }
      });

    expect(
      offendingLines,
      `non-JSON stdout detected (exit=${exitCode}):\n${offendingLines.join("\n")}`
    ).toEqual([]);
  }, 10_000);
});
