/**
 * Mutate lines in the per-request log carry what was written: one
 * { operation, resource_name } per successful operation, so the write-identity
 * audit has an independent record to hold change_event against.
 *
 * Containment: the same as requestLog.test.ts. These tests drive the REAL
 * google-ads-api Customer with its network entry points replaced on the
 * prototypes (`paginatedSearch`, `loadService`), and `getAccessToken` /
 * `getCredentials` throwing so a path that slipped past the stubs fails the
 * test instead of calling out. Lines go to a temp file through
 * GOOGLE_ADS_REQUEST_LOG_PATH, never to ~/Library/Logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleAdsApi, Customer } from "google-ads-api";

import { REQUEST_LOG_FIELDS, requestLogHooks, withRequestLog } from "./requestLog.js";
import { GoogleAdsManager } from "./index.js";

const requireCjs = createRequire(import.meta.url);
const { Service } = requireCjs("google-ads-api/build/src/service.js");

const CID = "1234567890";
const CAMP_1 = `customers/${CID}/campaigns/111`;
const CAMP_2 = `customers/${CID}/campaigns/222`;
const BUDGET = `customers/${CID}/campaignBudgets/333`;
const CRIT = `customers/${CID}/adGroupCriteria/444~555`;

let dir: string;
let logPath: string;

function lines(): any[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gads-reqlog-res-"));
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

function stubNetwork(opts: { serviceClient?: Record<string, (...a: any[]) => any>; searchRows?: any[] } = {}) {
  vi.spyOn(Customer.prototype as any, "paginatedSearch").mockImplementation(async () => ({ response: opts.searchRows ?? [] }));
  vi.spyOn(Service.prototype, "loadService").mockImplementation(() => opts.serviceClient ?? {});
  vi.spyOn(Service.prototype, "getAccessToken").mockImplementation(async () => {
    throw new Error("containment: getAccessToken reached");
  });
  vi.spyOn(Service.prototype, "getCredentials").mockImplementation(() => {
    throw new Error("containment: getCredentials reached");
  });
}

function realCustomer(hooks = requestLogHooks()): any {
  const api = new GoogleAdsApi({ client_id: "fake-client", client_secret: "fake-secret", developer_token: "fake-dev-token" });
  return api.Customer({ customer_id: CID, login_customer_id: "9998887777", refresh_token: "fake-refresh" }, hooks);
}

describe("resources on the request-log line", () => {
  it("is part of the documented field list, so every line carries it", () => {
    expect(REQUEST_LOG_FIELDS).toContain("resources");
  });

  it("a read carries resources: null", async () => {
    stubNetwork({ searchRows: [] });
    await realCustomer().query("SELECT campaign.id FROM campaign");
    const [line] = lines();
    expect(Object.keys(line).sort()).toEqual([...REQUEST_LOG_FIELDS].sort());
    expect(line.resources).toBeNull();
  });

  it("a typed-service create names each created resource", async () => {
    stubNetwork({
      serviceClient: { mutateCampaigns: async () => [{ results: [{ resource_name: CAMP_1 }, { resource_name: CAMP_2 }] }] },
    });
    await realCustomer().campaigns.create([{ name: "a" }, { name: "b" }] as any);
    expect(lines()).toEqual([
      expect.objectContaining({
        method: "CampaignService.mutateCampaigns",
        customer_id: CID,
        status: "ok",
        operations: 2,
        resources: [
          { operation: "create", resource_name: CAMP_1 },
          { operation: "create", resource_name: CAMP_2 },
        ],
      }),
    ]);
  });

  it("typed-service update and remove carry their own operation", async () => {
    stubNetwork({
      serviceClient: {
        mutateCampaigns: async () => [{ results: [{ resource_name: CAMP_1 }] }],
        mutateAdGroupCriteria: async () => [{ results: [{ resource_name: CRIT }] }],
      },
    });
    const c = realCustomer();
    await c.campaigns.update([{ resource_name: CAMP_1, status: 3 }]);
    await c.adGroupCriteria.remove([CRIT]);
    const got = lines();
    expect(got.map((l) => l.resources)).toEqual([
      [{ operation: "update", resource_name: CAMP_1 }],
      [{ operation: "remove", resource_name: CRIT }],
    ]);
  });

  it("mutateResources names each entity's result, defaulting the operation to create", async () => {
    stubNetwork({
      serviceClient: {
        mutate: async () => [
          {
            mutate_operation_responses: [
              { campaign_budget_result: { resource_name: BUDGET } },
              { campaign_result: { resource_name: CAMP_1 } },
            ],
          },
        ],
      },
    });
    const customer = withRequestLog((hooks) => realCustomer(hooks));
    await customer.mutateResources([
      { entity: "campaign_budget", resource: { resource_name: BUDGET, amount_micros: 1 } },
      { entity: "campaign", operation: "create", resource: { name: "x" } },
    ]);
    expect(lines()).toEqual([
      expect.objectContaining({
        method: "GoogleAdsService.mutate",
        operations: 2,
        validate_only: false,
        resources: [
          { operation: "create", resource_name: BUDGET },
          { operation: "create", resource_name: CAMP_1 },
        ],
      }),
    ]);
  });

  it("a partial-failure op with an empty result is not recorded as written", async () => {
    stubNetwork({
      serviceClient: {
        mutateCampaigns: async () => [{ results: [{ resource_name: "" }, { resource_name: CAMP_2 }] }],
      },
    });
    await realCustomer().campaigns.update(
      [
        { resource_name: CAMP_1, status: 3 },
        { resource_name: CAMP_2, status: 3 },
      ],
      { partial_failure: true },
    );
    expect(lines()[0].resources).toEqual([{ operation: "update", resource_name: CAMP_2 }]);
  });

  it("a validate_only mutate wrote nothing: resources is null", async () => {
    stubNetwork({ serviceClient: { mutateCampaigns: async () => [{ results: [{ resource_name: CAMP_1 }] }] } });
    await realCustomer().campaigns.update([{ resource_name: CAMP_1, status: 3 }], { validate_only: true });
    const [line] = lines();
    expect(line.validate_only).toBe(true);
    expect(line.resources).toBeNull();
  });

  it("a validate_only mutateResources wrote nothing: resources is null", async () => {
    stubNetwork({
      serviceClient: { mutate: async () => [{ mutate_operation_responses: [{ campaign_result: { resource_name: CAMP_1 } }] }] },
    });
    const customer = withRequestLog((hooks) => realCustomer(hooks));
    await customer.mutateResources([{ entity: "campaign", operation: "update", resource: { resource_name: CAMP_1, status: 3 } }], {
      validate_only: true,
    });
    expect(lines()[0].resources).toBeNull();
  });

  it("a failed mutate carries resources: null and still rethrows", async () => {
    const err = new Error("denied");
    stubNetwork({ serviceClient: { mutateCampaigns: async () => { throw err; } } });
    await expect(realCustomer().campaigns.update([{ resource_name: CAMP_1, status: 3 }])).rejects.toBe(err);
    const [line] = lines();
    expect(line.status).toBe("error");
    expect(line.resources).toBeNull();
  });

  it("an unexpected response shape never fails the mutate", async () => {
    stubNetwork({ serviceClient: { mutateCampaigns: async () => [{ results: "not-a-list" }] } });
    await expect(realCustomer().campaigns.update([{ resource_name: CAMP_1, status: 3 }])).resolves.toEqual({ results: "not-a-list" });
    expect(lines()[0]).toMatchObject({ status: "ok", resources: [] });
  });
});

describe("GoogleAdsManager.getCustomer wiring", () => {
  it("a mutate made through the manager's customer names what it wrote", async () => {
    const mgr = Object.create(GoogleAdsManager.prototype) as any;
    mgr.api = new GoogleAdsApi({ client_id: "fake-client", client_secret: "fake-secret", developer_token: "fake-dev-token" });
    mgr.config = { clients: {}, google_ads: { mcc_customer_id: "999-888-7777" } };
    mgr.defaultRefreshToken = "fake-refresh";
    stubNetwork({ serviceClient: { mutateCampaigns: async () => [{ results: [{ resource_name: CAMP_1 }] }] } });
    await (mgr as GoogleAdsManager).getCustomer("123-456-7890").campaigns.update([{ resource_name: CAMP_1, status: 3 }] as any);
    expect(lines()).toEqual([
      expect.objectContaining({
        customer_id: CID,
        status: "ok",
        resources: [{ operation: "update", resource_name: CAMP_1 }],
      }),
    ]);
  });
});
