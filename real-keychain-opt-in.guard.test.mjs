/**
 * Tests that run run-mcp.sh against the real `security` binary read real
 * credentials from the login Keychain, so they run only when asked for by
 * name. They used to run whenever CI was unset, which meant any local
 * `npm test`.
 *
 * Nothing here starts a process.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { REAL_KEYCHAIN_ENV_VAR, realKeychainTestsEnabled } from "./tests/helpers/realKeychain.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

describe("the real-Keychain opt-in", () => {
  it("is off by default, on a Mac with no CI variable too", () => {
    expect(realKeychainTestsEnabled({}, "darwin")).toBe(false);
  });

  it.each(["", "0", "false", "true", "yes"])("stays off for %j: only 1 turns it on", (value) => {
    expect(realKeychainTestsEnabled({ [REAL_KEYCHAIN_ENV_VAR]: value }, "darwin")).toBe(false);
  });

  it("is on when asked for on macOS, whatever CI says", () => {
    expect(REAL_KEYCHAIN_ENV_VAR).toBe("MCP_GOOGLE_ADS_TEST_REAL_KEYCHAIN");
    expect(realKeychainTestsEnabled({ [REAL_KEYCHAIN_ENV_VAR]: "1" }, "darwin")).toBe(true);
    expect(realKeychainTestsEnabled({ [REAL_KEYCHAIN_ENV_VAR]: "1", CI: "true" }, "darwin")).toBe(true);
  });

  it.each(["linux", "win32"])("is off on %s, which has no Keychain", (platform) => {
    expect(realKeychainTestsEnabled({ [REAL_KEYCHAIN_ENV_VAR]: "1" }, platform)).toBe(false);
  });

  it("gates the block that runs run-mcp.sh against the real `security`", () => {
    const wrapper = readFileSync(path.join(ROOT, "run-mcp.wrapper.test.mjs"), "utf8");
    expect(wrapper).toMatch(
      /describe\.skipIf\(!realKeychainTestsEnabled\(process\.env, process\.platform\)\)\(\s*"run-mcp\.sh Keychain accounts resolve to real secrets"/,
    );
  });
});
