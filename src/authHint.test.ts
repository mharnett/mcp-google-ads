/**
 * The auth-error hint names the Keychain item the server actually read.
 *
 * It used to name one fixed item that the launcher no longer reads, so a
 * rejected token sent people to check the wrong credential. The launcher
 * (run-mcp.sh) exports the item it read as GOOGLE_ADS_REFRESH_TOKEN_SERVICE
 * and GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT; without them the hint is generic.
 * The hint never asks `security` to print the token (`-w`).
 *
 * Pure: env is passed in. Every value is made up.
 */
import { describe, expect, it } from "vitest";
import { authErrorHint } from "./authHint.js";

const READ = { GOOGLE_ADS_REFRESH_TOKEN_SERVICE: "EXAMPLE_REFRESH_TOKEN", GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT: "example-read-account" };
const WRITE = { GOOGLE_ADS_REFRESH_TOKEN_SERVICE: "EXAMPLE_REFRESH_TOKEN_WRITE", GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT: "example-write-account" };

describe("authErrorHint", () => {
  it.each([
    ["read", READ],
    ["write", WRITE],
  ])("%s mode: names the service and account the launcher read", (_mode, env) => {
    const { hint, action_required } = authErrorHint(env);
    expect(hint).toContain(`-s ${env.GOOGLE_ADS_REFRESH_TOKEN_SERVICE}`);
    expect(hint).toContain(`-a ${env.GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT}`);
    expect(action_required).toMatch(/Keychain/);
  });

  it("read and write mode give different hints", () => {
    expect(authErrorHint(READ).hint).not.toBe(authErrorHint(WRITE).hint);
  });

  it("never tells anyone to print the token", () => {
    for (const env of [READ, WRITE, {}]) {
      expect(authErrorHint(env).hint).not.toMatch(/\s-w\b/);
    }
  });

  it("unset: a generic hint that names no Keychain item", () => {
    const { hint, action_required } = authErrorHint({});
    expect(hint).not.toMatch(/security|Keychain|google-ads-drak/);
    expect(hint).toMatch(/mcp-google-ads-auth/);
    expect(hint).toMatch(/GOOGLE_ADS_REFRESH_TOKEN/);
    expect(action_required).not.toMatch(/Keychain/);
  });

  it("only one of the two set, or one empty: generic", () => {
    expect(authErrorHint({ GOOGLE_ADS_REFRESH_TOKEN_SERVICE: "EXAMPLE_REFRESH_TOKEN" }).hint).not.toMatch(/security/);
    expect(authErrorHint({ ...READ, GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT: "" }).hint).not.toMatch(/security/);
  });

  it("a value with shell metacharacters is not echoed into a command", () => {
    const { hint } = authErrorHint({ ...READ, GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT: "x; rm -rf ~" });
    expect(hint).not.toMatch(/security|rm -rf/);
  });
});
