/**
 * Per-request Google Ads log: one JSONL line per API call.
 *
 * Containment: nothing here can reach Google Ads. The library tests drive the
 * REAL google-ads-api Customer (so the hook contract is the library's, not a
 * restated copy) with its three network entry points replaced on the
 * prototypes: `paginatedSearch` (every GAQL read), `loadService` (every gRPC
 * service client, mutates included) and `getAccessToken` / `getCredentials`
 * (OAuth), the last two throwing so any path that slipped past the stubs fails
 * the test instead of calling out. Log lines go to a temp file through
 * GOOGLE_ADS_REQUEST_LOG_PATH, never to ~/Library/Logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleAdsApi, Customer } from "google-ads-api";

import {
  REQUEST_LOG_FIELDS,
  callerName,
  logGoogleAdsRequest,
  loggedCall,
  requestLogDestination,
  requestLogHooks,
  withRequestLog,
  writeRequestLogLine,
} from "./requestLog.js";
import { GoogleAdsManager } from "./index.js";

const requireCjs = createRequire(import.meta.url);
const { Service } = requireCjs("google-ads-api/build/src/service.js");

const FAKE_REFRESH = "fake-refresh-token-value";
const FAKE_DEV_TOKEN = "fake-developer-token-value";
const GAQL = "SELECT campaign.id FROM campaign WHERE campaign.name = 'Secret Plan'";

let dir: string;
let logPath: string;

function lines(p = logPath): any[] {
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gads-reqlog-"));
  logPath = path.join(dir, "google-ads-requests.jsonl");
  vi.stubEnv("GOOGLE_ADS_REQUEST_LOG_PATH", logPath);
  vi.stubEnv("DRAK_JOB", "");
  vi.stubEnv("RAILWAY_SERVICE_NAME", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("requestLogDestination", () => {
  it("macOS writes the JSONL file under ~/Library/Logs", () => {
    expect(requestLogDestination({}, "darwin", "/home-x")).toEqual({
      kind: "file",
      path: path.join("/home-x", "Library", "Logs", "google-ads-requests.jsonl"),
    });
  });

  it("Linux, Railway and CI write to the stream instead", () => {
    expect(requestLogDestination({}, "linux", "/home-x")).toEqual({ kind: "stream" });
    expect(requestLogDestination({ RAILWAY_ENVIRONMENT: "production" }, "darwin", "/home-x")).toEqual({ kind: "stream" });
    expect(requestLogDestination({ CI: "true" }, "darwin", "/home-x")).toEqual({ kind: "stream" });
    expect(requestLogDestination({}, "win32", "/home-x")).toEqual({ kind: "stream" });
  });

  it("GOOGLE_ADS_REQUEST_LOG_PATH overrides everything", () => {
    expect(requestLogDestination({ GOOGLE_ADS_REQUEST_LOG_PATH: "/x/y.jsonl", RAILWAY_ENVIRONMENT: "p" }, "linux", "/h")).toEqual({
      kind: "file",
      path: "/x/y.jsonl",
    });
  });
});

describe("callerName", () => {
  it("prefers DRAK_JOB, then RAILWAY_SERVICE_NAME, then the script name", () => {
    expect(callerName({ DRAK_JOB: "id-cache-refresh", RAILWAY_SERVICE_NAME: "svc" }, ["node", "/a/b/run.js"])).toBe("id-cache-refresh");
    expect(callerName({ RAILWAY_SERVICE_NAME: "str-review" }, ["node", "/a/b/run.js"])).toBe("str-review");
    expect(callerName({}, ["node", "/a/b/run.js"])).toBe("run.js");
    expect(callerName({}, ["/usr/bin/node"])).toBe("node");
    expect(callerName({}, [])).toBe("unknown");
  });
});

describe("writeRequestLogLine", () => {
  it("appends one JSON object per line", () => {
    writeRequestLogLine({ a: 1 } as any, { kind: "file", path: logPath });
    writeRequestLogLine({ a: 2 } as any, { kind: "file", path: logPath });
    expect(lines()).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("rotates to .1 once the file reaches the size cap", () => {
    writeFileSync(logPath, "x".repeat(200) + "\n");
    writeRequestLogLine({ a: 3 } as any, { kind: "file", path: logPath }, 100);
    expect(lines()).toEqual([{ a: 3 }]);
    expect(readFileSync(logPath + ".1", "utf-8").startsWith("xxx")).toBe(true);
  });

  it("creates the log directory when it is missing", () => {
    const nested = path.join(dir, "a", "b", "log.jsonl");
    writeRequestLogLine({ a: 4 } as any, { kind: "file", path: nested });
    expect(lines(nested)).toEqual([{ a: 4 }]);
  });

  it("never throws when the path cannot be written", () => {
    const blocker = path.join(dir, "file");
    writeFileSync(blocker, "");
    expect(() => writeRequestLogLine({ a: 5 } as any, { kind: "file", path: path.join(blocker, "x.jsonl") })).not.toThrow();
  });

  it("stream mode writes to stderr, never stdout (stdout carries MCP JSON-RPC)", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    writeRequestLogLine({ a: 6 } as any, { kind: "stream" });
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith('{"a":6}\n');
  });
});

describe("logGoogleAdsRequest", () => {
  it("writes exactly the documented fields", () => {
    vi.stubEnv("DRAK_JOB", "unit-job");
    logGoogleAdsRequest({
      method: "CampaignService.MutateCampaigns",
      customer_id: "123-456-7890",
      operations: 3,
      validate_only: true,
      status: "ok",
    });
    const [line] = lines();
    expect(Object.keys(line).sort()).toEqual([...REQUEST_LOG_FIELDS].sort());
    expect(line).toMatchObject({
      caller: "unit-job",
      method: "CampaignService.MutateCampaigns",
      customer_id: "1234567890",
      operations: 3,
      validate_only: true,
      status: "ok",
      lib: "mcp-google-ads",
      pid: process.pid,
    });
    expect(new Date(line.ts).toISOString()).toBe(line.ts);
    expect(line.ts.endsWith("Z")).toBe(true);
    expect(typeof line.host).toBe("string");
    expect(line.host.length).toBeGreaterThan(0);
  });
});

/** The library's network entry points, replaced on the prototypes. */
function stubNetwork(opts: { serviceClient?: Record<string, (...a: any[]) => any>; searchRows?: any[]; searchError?: Error } = {}) {
  const search = vi.spyOn(Customer.prototype as any, "paginatedSearch").mockImplementation(async () => {
    if (opts.searchError) throw opts.searchError;
    return { response: opts.searchRows ?? [] };
  });
  const load = vi.spyOn(Service.prototype, "loadService").mockImplementation(() => opts.serviceClient ?? {});
  vi.spyOn(Service.prototype, "getAccessToken").mockImplementation(async () => {
    throw new Error("containment: getAccessToken reached");
  });
  vi.spyOn(Service.prototype, "getCredentials").mockImplementation(() => {
    throw new Error("containment: getCredentials reached");
  });
  return { search, load };
}

function realCustomer(hooks = requestLogHooks()): any {
  const api = new GoogleAdsApi({ client_id: "fake-client", client_secret: "fake-secret", developer_token: FAKE_DEV_TOKEN });
  return api.Customer({ customer_id: "1234567890", login_customer_id: "9998887777", refresh_token: FAKE_REFRESH }, hooks);
}

describe("requestLogHooks on the real google-ads-api Customer", () => {
  it("a GAQL read leaves one line: SearchStream, 1 operation, ok, no GAQL text", async () => {
    stubNetwork({ searchRows: [{ campaign: { id: 1 } }] });
    const rows = await realCustomer().query(GAQL);
    expect(rows).toEqual([{ campaign: { id: 1 } }]);
    const got = lines();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      method: "GoogleAdsService.SearchStream",
      customer_id: "1234567890",
      operations: 1,
      validate_only: false,
      status: "ok",
    });
    const raw = readFileSync(logPath, "utf-8");
    expect(raw).not.toContain("Secret Plan");
    expect(raw).not.toContain("SELECT");
    expect(raw).not.toContain(FAKE_REFRESH);
    expect(raw).not.toContain(FAKE_DEV_TOKEN);
  });

  it("a failed read logs status error with a short code and still throws the original error", async () => {
    const boom = new Error("RESOURCE_EXHAUSTED quota text that mentions Secret Plan");
    stubNetwork({ searchError: boom });
    await expect(realCustomer().query(GAQL)).rejects.toBe(boom);
    const got = lines();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ status: "error", error: "Error", operations: 1 });
    expect(readFileSync(logPath, "utf-8")).not.toContain("Secret Plan");
  });

  it("a service mutate counts its operations and reads validate_only off the request", async () => {
    const mutateCampaigns = vi.fn(async () => [{ results: [] }]);
    stubNetwork({ serviceClient: { mutateCampaigns } });
    await realCustomer().campaigns.update(
      [
        { resource_name: "customers/1234567890/campaigns/1", status: 3 },
        { resource_name: "customers/1234567890/campaigns/2", status: 3 },
        { resource_name: "customers/1234567890/campaigns/3", status: 3 },
      ],
      { validate_only: true },
    );
    expect(mutateCampaigns).toHaveBeenCalledTimes(1);
    expect(lines()).toEqual([
      expect.objectContaining({
        method: "CampaignService.mutateCampaigns",
        operations: 3,
        validate_only: true,
        status: "ok",
      }),
    ]);
  });

  it("a failed service mutate logs error and rethrows", async () => {
    const err = new Error("denied");
    stubNetwork({ serviceClient: { mutateCampaigns: async () => { throw err; } } });
    await expect(
      realCustomer().campaigns.update([{ resource_name: "customers/1234567890/campaigns/1", status: 3 }]),
    ).rejects.toBe(err);
    expect(lines()).toEqual([expect.objectContaining({ status: "error", validate_only: false, operations: 1 })]);
  });

  it("mutateResources through withRequestLog records validate_only the hooks cannot see", async () => {
    const mutate = vi.fn(async () => [{ mutate_operation_responses: [] }]);
    stubNetwork({ serviceClient: { mutate } });
    const customer = withRequestLog((hooks) => realCustomer(hooks));
    const ops = [
      { entity: "campaign", operation: "update", resource: { resource_name: "customers/1234567890/campaigns/1", status: 3 } },
      { entity: "campaign", operation: "update", resource: { resource_name: "customers/1234567890/campaigns/2", status: 3 } },
    ];
    await customer.mutateResources(ops, { validate_only: true });
    await customer.mutateResources(ops.slice(0, 1));
    expect(lines()).toEqual([
      expect.objectContaining({ method: "GoogleAdsService.mutate", operations: 2, validate_only: true, status: "ok" }),
      expect.objectContaining({ method: "GoogleAdsService.mutate", operations: 1, validate_only: false, status: "ok" }),
    ]);
  });

  it("a non-mutate service call (applyRecommendation) counts its operations", async () => {
    const applyRecommendation = vi.fn(async () => [{ results: [] }]);
    stubNetwork({ serviceClient: { applyRecommendation } });
    await realCustomer().recommendations.applyRecommendation({
      customer_id: "1234567890",
      operations: [{ resource_name: "a" }, { resource_name: "b" }],
    } as any);
    expect(lines()).toEqual([
      expect.objectContaining({ method: "RecommendationService.ApplyRecommendation", operations: 2, status: "ok" }),
    ]);
  });

  it("a logger that throws never fails the call", async () => {
    stubNetwork({ searchRows: [] });
    const hooks = requestLogHooks({
      log: () => {
        throw new Error("disk full");
      },
    });
    await expect(realCustomer(hooks).query(GAQL)).resolves.toEqual([]);
  });
});

describe("loggedCall (calls outside a Customer, e.g. listAccessibleCustomers)", () => {
  it("logs ok and returns the result", async () => {
    await expect(loggedCall({ method: "CustomerService.ListAccessibleCustomers", customer_id: "" }, async () => 7)).resolves.toBe(7);
    expect(lines()).toEqual([expect.objectContaining({ method: "CustomerService.ListAccessibleCustomers", status: "ok", operations: 1 })]);
  });

  it("logs error and rethrows", async () => {
    const e = new TypeError("x");
    await expect(loggedCall({ method: "M", customer_id: "1" }, async () => { throw e; })).rejects.toBe(e);
    expect(lines()).toEqual([expect.objectContaining({ status: "error", error: "TypeError" })]);
  });
});

describe("GoogleAdsManager.getCustomer wiring", () => {
  function manager(): GoogleAdsManager {
    const mgr = Object.create(GoogleAdsManager.prototype) as any;
    mgr.api = new GoogleAdsApi({ client_id: "fake-client", client_secret: "fake-secret", developer_token: FAKE_DEV_TOKEN });
    mgr.config = { clients: {}, google_ads: { mcc_customer_id: "999-888-7777" } };
    mgr.defaultRefreshToken = FAKE_REFRESH;
    return mgr as GoogleAdsManager;
  }

  it("every read the manager makes leaves a line", async () => {
    stubNetwork({ searchRows: [] });
    await manager().getCustomer("123-456-7890").query(GAQL);
    expect(lines()).toEqual([
      expect.objectContaining({ method: "GoogleAdsService.SearchStream", customer_id: "1234567890", status: "ok" }),
    ]);
  });

  it("every mutateResources the manager makes carries its validate_only", async () => {
    stubNetwork({ serviceClient: { mutate: async () => [{ mutate_operation_responses: [] }] } });
    await (manager().getCustomer("1234567890") as any).mutateResources(
      [{ entity: "campaign", operation: "update", resource: { resource_name: "customers/1234567890/campaigns/1", status: 3 } }],
      { validate_only: true, partial_failure: false },
    );
    expect(lines()).toEqual([expect.objectContaining({ method: "GoogleAdsService.mutate", validate_only: true, operations: 1 })]);
  });
});
