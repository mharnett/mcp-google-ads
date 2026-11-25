import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readStoredCredentials,
  writeStoredCredentials,
  resolveCredentials,
  validateResolvedCredentials,
  CREDENTIALS_FILE_VERSION,
  type StoredCredentials,
} from "./credentials.js";
import { MissingDeveloperTokenError } from "./errors.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from "fs";
import path from "path";
import os from "os";

// ============================================
// Isolated per-test tmp paths + env sandboxing
// ============================================

const ENV_KEYS = [
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_MCC_CUSTOMER_ID",
];

let savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "mcp-gads-creds-"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) {
      process.env[k] = savedEnv[k];
    } else {
      delete process.env[k];
    }
  }
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================
// Read / Write round-trips
// ============================================

describe("readStoredCredentials / writeStoredCredentials", () => {
  it("returns null when the file does not exist", () => {
    const result = readStoredCredentials(path.join(tmpDir, "does-not-exist.json"));
    expect(result).toBeNull();
  });

  it("round-trips a valid credentials object", () => {
    const filePath = path.join(tmpDir, "credentials.json");
    const creds: StoredCredentials = {
      version: CREDENTIALS_FILE_VERSION,
      refresh_token: "1//0-test-refresh-token-xxxxx",
      customer_id: "1234567890",
      customer_name: "Drak Marketing",
      mcc_customer_id: "9998887777",
      obtained_at: new Date().toISOString(),
      scopes: ["https://www.googleapis.com/auth/adwords"],
    };
    writeStoredCredentials(creds, filePath);
    const read = readStoredCredentials(filePath);
    expect(read).toEqual(creds);
  });

  it("writes the file with 0600 perms on POSIX systems", () => {
    if (process.platform === "win32") return; // chmod is a no-op on Windows
    const filePath = path.join(tmpDir, "credentials.json");
    writeStoredCredentials(
      {
        version: CREDENTIALS_FILE_VERSION,
        refresh_token: "x".repeat(30),
        customer_id: "1234567890",
        obtained_at: new Date().toISOString(),
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
      filePath,
    );
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null for a file with a mismatched version number", () => {
    const filePath = path.join(tmpDir, "credentials.json");
    writeFileSync(
      filePath,
      JSON.stringify({ version: 999, refresh_token: "x", customer_id: "1" }),
    );
    const result = readStoredCredentials(filePath);
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    const filePath = path.join(tmpDir, "credentials.json");
    writeFileSync(filePath, "{ this is not json");
    const result = readStoredCredentials(filePath);
    expect(result).toBeNull();
  });

  it("creates parent directories as needed", () => {
    const filePath = path.join(tmpDir, "nested", "dirs", "credentials.json");
    writeStoredCredentials(
      {
        version: CREDENTIALS_FILE_VERSION,
        refresh_token: "x".repeat(30),
        customer_id: "1234567890",
        obtained_at: new Date().toISOString(),
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
      filePath,
    );
    expect(existsSync(filePath)).toBe(true);
  });
});

// ============================================
// resolveCredentials — priority chain
// ============================================

describe("resolveCredentials priority chain", () => {
  // Each test passes a fresh tmp path so none of them accidentally resolve
  // from the real ~/Library credentials file the auth CLI writes at runtime.
  const freshPath = () => path.join(tmpDir, `creds-${Math.random().toString(36).slice(2)}.json`);

  it("throws with a helpful message when nothing is configured", () => {
    const p = freshPath();
    expect(() => resolveCredentials(p)).toThrow(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    // npm publish runs this with EMBEDDED_CLIENT_ID / _SECRET set, so those two may not be missing.
    expect(() => resolveCredentials(p)).toThrow(/Also missing: (client_id, client_secret, )?refresh_token, customer_id\./);
    expect(() => resolveCredentials(p)).toThrow(/npx mcp-google-ads-auth/);
  });

  it("resolves from env vars when all are present (no file)", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    const resolved = resolveCredentials(freshPath());
    expect(resolved.source).toBe("env");
    expect(resolved.customer_id).toBe("1234567890");
  });

  it("trims whitespace and surrounding quotes in env values", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = `  "${"x".repeat(30)}"  `;
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    const resolved = resolveCredentials(freshPath());
    expect(resolved.client_id).toBe("x".repeat(30));
  });

  it("accepts customer_id with dashes", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "123-456-7890";
    const resolved = resolveCredentials(freshPath());
    expect(resolved.customer_id).toBe("123-456-7890");
    const validated = validateResolvedCredentials(resolved);
    expect(validated.valid).toBe(true);
  });

  it("throws when only client_id is set and nothing else fills in", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    // No other env vars, fresh tmp file => no stored fallback
    try {
      resolveCredentials(freshPath());
      throw new Error("Expected resolveCredentials to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/refresh_token/);
      expect(msg).toMatch(/customer_id/);
    }
  });

  it("falls back to stored file when env vars are absent", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    // NO GOOGLE_ADS_REFRESH_TOKEN / CUSTOMER_ID — should fall through to file
    const filePath = freshPath();
    writeStoredCredentials(
      {
        version: CREDENTIALS_FILE_VERSION,
        refresh_token: "y".repeat(30),
        customer_id: "9876543210",
        customer_name: "From File",
        obtained_at: new Date().toISOString(),
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
      filePath,
    );
    const resolved = resolveCredentials(filePath);
    expect(resolved.source).toBe("file");
    expect(resolved.customer_id).toBe("9876543210");
    expect(resolved.refresh_token).toBe("y".repeat(30));
  });

  it("env var overrides file (explicit wins over implicit)", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "env-token".padEnd(30, "x");
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1111111111";
    const filePath = freshPath();
    writeStoredCredentials(
      {
        version: CREDENTIALS_FILE_VERSION,
        refresh_token: "file-token".padEnd(30, "y"),
        customer_id: "9999999999",
        obtained_at: new Date().toISOString(),
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
      filePath,
    );
    const resolved = resolveCredentials(filePath);
    expect(resolved.customer_id).toBe("1111111111");
    expect(resolved.refresh_token).toBe("env-token".padEnd(30, "x"));
    expect(resolved.source).toBe("mixed");
  });
});

describe("validateResolvedCredentials", () => {
  const base = {
    client_id: "x".repeat(30),
    client_secret: "x".repeat(30),
    developer_token: "x".repeat(30),
    refresh_token: "x".repeat(30),
    customer_id: "1234567890",
    mcc_customer_id: "",
    source: "env" as const,
  };

  it("passes for well-formed values", () => {
    const result = validateResolvedCredentials(base);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a credential that is too short", () => {
    const result = validateResolvedCredentials({ ...base, refresh_token: "short" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatch(/refresh_token too short/);
  });

  it("rejects a customer_id that is not 10 digits", () => {
    const result = validateResolvedCredentials({ ...base, customer_id: "abc123" });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatch(/customer_id/);
  });

  it("accepts a customer_id with dashes of the right shape", () => {
    const result = validateResolvedCredentials({ ...base, customer_id: "123-456-7890" });
    expect(result.valid).toBe(true);
  });
});

// ============================================
// Regression: developer token still resolved
// ============================================
// google-ads-api 24 sends a developer-token header on every call, so the server
// needs a value. Google sunset developer tokens on 2026-09-09 and will reject
// the header in a later API version. GOOGLE_ADS_DEVELOPER_TOKEN is the only
// source: nothing is embedded and nothing is stored.

describe("developer token resolution", () => {
  const freshPath = () => path.join(tmpDir, `creds-${Math.random().toString(36).slice(2)}.json`);

  it("includes developer_token in resolved credentials from env var", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token-12345";
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    const resolved = resolveCredentials(freshPath());
    expect(resolved.developer_token).toBe("test-dev-token-12345");
  });

  it("trims whitespace from developer_token env var", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "  test-dev-token-with-spaces  ";
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    const resolved = resolveCredentials(freshPath());
    expect(resolved.developer_token).toBe("test-dev-token-with-spaces");
  });

  function setAllBut(...unset: string[]): void {
    for (const key of ENV_KEYS) process.env[key] = key.endsWith("CUSTOMER_ID") ? "1234567890" : "x".repeat(30);
    for (const key of unset) delete process.env[key];
  }
  function missing(file = freshPath()): MissingDeveloperTokenError {
    try {
      resolveCredentials(file);
    } catch (err) {
      expect(err).toBeInstanceOf(MissingDeveloperTokenError);
      return err as MissingDeveloperTokenError;
    }
    throw new Error("Expected resolveCredentials to throw for a missing developer token");
  }

  it("only the developer token missing: names the variable and where to apply, and does not send anyone to the auth helper", () => {
    setAllBut("GOOGLE_ADS_DEVELOPER_TOKEN");
    const { message, alsoMissing } = missing();
    expect(message).toMatch(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    expect(message).toContain("https://console.cloud.google.com/google/ads-apis/overview");
    expect(message).not.toMatch(/mcp-google-ads-auth|Also missing|credentials file/);
    expect(alsoMissing).toEqual([]);
  });

  it("a complete credentials file is not called incomplete: it never holds the token", () => {
    setAllBut("GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID");
    const file = freshPath();
    writeStoredCredentials(
      { version: CREDENTIALS_FILE_VERSION, refresh_token: "x".repeat(30), customer_id: "1234567890", obtained_at: "2026-01-01T00:00:00Z", scopes: [] },
      file,
    );
    expect(missing(file).message).not.toMatch(/credentials file|mcp-google-ads-auth/);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "fake-developer-token";
    expect(resolveCredentials(file)).toMatchObject({ developer_token: "fake-developer-token", source: "file" });
  });

  it("the sign-in missing too: one message covers both", () => {
    setAllBut("GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID");
    const { message, alsoMissing } = missing();
    expect(message).toMatch(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    expect(message).toContain("Also missing: refresh_token, customer_id.");
    expect(message).toContain("npx mcp-google-ads-auth");
    expect(alsoMissing).toEqual(["refresh_token", "customer_id"]);
  });

  it("a blank or quoted-blank value counts as not set", () => {
    setAllBut("GOOGLE_ADS_DEVELOPER_TOKEN");
    for (const blank of ["   ", '""', '" "']) {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = blank;
      missing();
    }
  });

  it("other credentials missing but not the token: the message does not mention it", () => {
    setAllBut("GOOGLE_ADS_REFRESH_TOKEN");
    expect(() => resolveCredentials(freshPath())).toThrow(/Missing Google Ads credentials: refresh_token/);
    expect(() => resolveCredentials(freshPath())).not.toThrow(/DEVELOPER_TOKEN/);
  });

  it("EMBEDDED_DEVELOPER_TOKEN in the env is not a source", async () => {
    setAllBut("GOOGLE_ADS_DEVELOPER_TOKEN");
    vi.stubEnv("EMBEDDED_DEVELOPER_TOKEN", "fake-embedded-developer-token");
    vi.resetModules();
    try {
      const fresh = await import("./credentials.js");
      expect(() => fresh.resolveCredentials(freshPath())).toThrow(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
