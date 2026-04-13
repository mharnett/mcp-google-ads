import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readStoredCredentials,
  writeStoredCredentials,
  resolveCredentials,
  validateResolvedCredentials,
  CREDENTIALS_FILE_VERSION,
  type StoredCredentials,
} from "./credentials.js";
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
      customer_id: "3741961572",
      customer_name: "Drak Marketing",
      mcc_customer_id: "6761396070",
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
  it("throws with a helpful message when nothing is configured", () => {
    // No env vars set, no file, no embedded (empty string in tests)
    expect(() => resolveCredentials()).toThrow(/Missing Google Ads credentials/);
    expect(() => resolveCredentials()).toThrow(/npx mcp-google-ads-auth/);
  });

  it("resolves from env vars when all are present", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    const resolved = resolveCredentials();
    expect(resolved.source).toBe("env");
    expect(resolved.customer_id).toBe("1234567890");
  });

  it("trims whitespace and surrounding quotes in env values", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = `  "${"x".repeat(30)}"  `;
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
    const resolved = resolveCredentials();
    expect(resolved.client_id).toBe("x".repeat(30));
  });

  it("accepts customer_id with dashes", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    process.env.GOOGLE_ADS_CLIENT_SECRET = "x".repeat(30);
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "x".repeat(30);
    process.env.GOOGLE_ADS_CUSTOMER_ID = "374-196-1572";
    const resolved = resolveCredentials();
    expect(resolved.customer_id).toBe("374-196-1572");
    const validated = validateResolvedCredentials(resolved);
    expect(validated.valid).toBe(true);
  });

  it("includes 'missing credentials' message when fields are partially set", () => {
    process.env.GOOGLE_ADS_CLIENT_ID = "x".repeat(30);
    // Leave the rest unset
    try {
      resolveCredentials();
      throw new Error("Expected resolveCredentials to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/refresh_token/);
      expect(msg).toMatch(/customer_id/);
    }
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
