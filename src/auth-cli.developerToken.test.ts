/**
 * Signing in needs no developer token; listing accounts does. Without one,
 * mcp-google-ads-auth finishes the OAuth flow, saves the sign-in, says once
 * what is missing and exits 2. With one, nothing changes.
 *
 * Containment: the real run() with the browser, the token endpoint and the
 * Google Ads client replaced, and the credentials file in a temp dir. The
 * "browser" follows the loopback redirect with a fake code. Every value is
 * made up.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const fake = vi.hoisted(() => ({
  dir: "",
  browserOpened: 0,
  apiOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("./platform.js", async (importOriginal) => {
  fake.dir = mkdtempSync(path.join(tmpdir(), "gads-auth-token-"));
  return {
    ...(await importOriginal<typeof import("./platform.js")>()),
    configDir: fake.dir,
    credentialsFilePath: path.join(fake.dir, "credentials.json"),
    findFreeLoopbackPort: () =>
      new Promise<number>((resolve) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => {
          const { port } = probe.address() as AddressInfo;
          probe.close(() => resolve(port));
        });
      }),
    openBrowser: async (authUrl: string) => {
      fake.browserOpened += 1;
      const asked = new URL(authUrl).searchParams;
      const redirect = new URL(asked.get("redirect_uri")!);
      redirect.searchParams.set("code", "fake-code");
      redirect.searchParams.set("state", asked.get("state")!);
      // IPv4, where the CLI listens. Browsers fall back to it; Node 18 does not.
      http.get(redirect, { agent: false, family: 4 }, (res) => res.resume());
    },
  };
});

// A source build. npm publish runs this suite with EMBEDDED_CLIENT_ID / _SECRET set.
vi.mock("./embedded-secrets.js", () => ({ EMBEDDED_CLIENT_ID: "", EMBEDDED_CLIENT_SECRET: "" }));

vi.mock("google-ads-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("google-ads-api")>()),
  GoogleAdsApi: class {
    constructor(options: Record<string, unknown>) {
      fake.apiOptions.push(options);
    }
    async listAccessibleCustomers() {
      return { resource_names: ["customers/1112223333"] };
    }
    Customer() {
      return { query: async () => [{ customer: { id: 1112223333, descriptive_name: "Example Account", manager: false } }] };
    }
  },
}));

import { run } from "./auth-cli.js";
import { credentialsFilePath, readStoredCredentials, resolveCredentials } from "./credentials.js";

const HELP_URL = "https://console.cloud.google.com/google/ads-apis/overview";
let printed: string;

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** Run the CLI. Returns its exit code, or "returned" when it finished normally. */
async function auth(...argv: string[]): Promise<number | "returned"> {
  try {
    await run(argv);
    return "returned";
  } catch (err) {
    if (err instanceof Exit) return err.code;
    throw err;
  }
}

const told = () => printed.split("GOOGLE_ADS_DEVELOPER_TOKEN is not set").length - 1;

function savedBefore(fields: Record<string, unknown>): void {
  mkdirSync(fake.dir, { recursive: true });
  writeFileSync(
    credentialsFilePath,
    JSON.stringify({ version: 1, refresh_token: "fake-old-refresh", obtained_at: "2026-01-01T00:00:00Z", scopes: [], ...fields }),
  );
}

beforeEach(() => {
  printed = "";
  fake.browserOpened = 0;
  fake.apiOptions.length = 0;
  rmSync(credentialsFilePath, { force: true });
  vi.stubEnv("GOOGLE_ADS_REQUEST_LOG_PATH", path.join(fake.dir, "requests.jsonl"));
  vi.stubEnv("GOOGLE_ADS_CLIENT_ID", "fake-client-id");
  vi.stubEnv("GOOGLE_ADS_CLIENT_SECRET", "fake-client-secret");
  vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "");
  vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", "");
  vi.stubEnv("GOOGLE_ADS_CUSTOMER_ID", "");
  vi.stubEnv("GOOGLE_ADS_MCC_CUSTOMER_ID", "");
  vi.stubGlobal("fetch", async (url: unknown) => {
    if (String(url) !== "https://oauth2.googleapis.com/token") throw new Error(`containment: fetch ${String(url)}`);
    return new Response(JSON.stringify({ access_token: "fake-access", refresh_token: "fake-new-refresh", expires_in: 3600, scope: "", token_type: "Bearer" }));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    printed += String(chunk);
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Exit(code ?? 0);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => rmSync(fake.dir, { recursive: true, force: true }));

describe("mcp-google-ads-auth without a developer token", () => {
  it("completes the sign-in, saves it, and says once what is missing and where to apply", async () => {
    expect(await auth()).toBe(2);
    expect(fake.browserOpened).toBe(1);
    expect(readStoredCredentials()).toMatchObject({ refresh_token: "fake-new-refresh", customer_id: "", mcc_customer_id: null });
    expect(told()).toBe(1);
    expect(printed).toContain(HELP_URL);
    expect(printed).toContain(credentialsFilePath);
    expect(printed).not.toMatch(/published without|✅/);
    // Listing accounts is the call that needs the token, so it is not made.
    expect(fake.apiOptions).toEqual([]);
  });

  it("with --customer-id: saves that account with the sign-in, and the server then needs only the token", async () => {
    expect(await auth("--customer-id", "111-222-3333")).toBe(2);
    expect(readStoredCredentials()).toMatchObject({ refresh_token: "fake-new-refresh", customer_id: "1112223333" });
    expect(printed).toMatch(/1112223333.*not checked/);
    expect(() => resolveCredentials()).toThrow(/^GOOGLE_ADS_DEVELOPER_TOKEN is not set/);
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "fake-developer-token");
    expect(resolveCredentials()).toMatchObject({ customer_id: "1112223333", refresh_token: "fake-new-refresh", developer_token: "fake-developer-token" });
  });

  it("keeps the account an earlier run saved, and says it was not checked", async () => {
    savedBefore({ customer_id: "4445556666", customer_name: "Example Client", mcc_customer_id: "7778889999" });
    expect(await auth()).toBe(2);
    expect(readStoredCredentials()).toMatchObject({
      refresh_token: "fake-new-refresh",
      customer_id: "4445556666",
      customer_name: "Example Client",
      mcc_customer_id: "7778889999",
    });
    expect(printed).toMatch(/Example Client \(4445556666\).*not checked/);
  });

  it("--customer-id for another account does not inherit the old account's name or manager", async () => {
    savedBefore({ customer_id: "4445556666", customer_name: "Example Client", mcc_customer_id: "7778889999" });
    await auth("--customer-id", "1112223333");
    const saved = readStoredCredentials()!;
    expect(saved).toMatchObject({ customer_id: "1112223333", mcc_customer_id: null });
    expect(saved.customer_name).toBeUndefined();
  });

  it("a saved file with no account offers no account line", async () => {
    expect(await auth()).toBe(2);
    expect(printed).not.toMatch(/not checked|undefined|\(\)/);
  });
});

describe("mcp-google-ads-auth with a developer token in the env", () => {
  it("lists accounts with it, saves the choice and finishes", async () => {
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "fake-developer-token");
    expect(await auth()).toBe("returned");
    expect(fake.apiOptions).toEqual([expect.objectContaining({ developer_token: "fake-developer-token" })]);
    expect(readStoredCredentials()).toMatchObject({ refresh_token: "fake-new-refresh", customer_id: "1112223333", customer_name: "Example Account" });
    expect(told()).toBe(0);
  });
});

describe("mcp-google-ads-auth on Node 18", () => {
  it("signs in where there is no global crypto", async () => {
    vi.stubGlobal("crypto", undefined);
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "fake-developer-token");
    expect(await auth()).toBe("returned");
    expect(readStoredCredentials()).toMatchObject({ refresh_token: "fake-new-refresh", customer_id: "1112223333" });
  });
});

describe("mcp-google-ads-auth without an OAuth client", () => {
  it("stops before the browser and asks for the client id and secret only", async () => {
    vi.stubEnv("GOOGLE_ADS_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_ADS_CLIENT_SECRET", "");
    expect(await auth()).toBe(2);
    expect(fake.browserOpened).toBe(0);
    expect(existsSync(credentialsFilePath)).toBe(false);
    expect([...new Set(printed.match(/GOOGLE_ADS_[A-Z_]+/g))].sort()).toEqual(["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET"]);
  });
});
