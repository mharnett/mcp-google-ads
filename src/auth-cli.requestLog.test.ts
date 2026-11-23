/**
 * The auth CLI's account enumeration leaves request-log lines too.
 *
 * Containment: the REAL google-ads-api client runs with its network entry
 * points replaced on the prototypes (loadService answers
 * listAccessibleCustomers, paginatedSearch answers GAQL, OAuth throws), and
 * the log goes to a temp file. Nothing reaches Google.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleAdsApi, Customer } from "google-ads-api";

import { enumerateAccounts } from "./auth-cli.js";

const requireCjs = createRequire(import.meta.url);
const { Service } = requireCjs("google-ads-api/build/src/service.js");

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gads-authcli-"));
  logPath = path.join(dir, "requests.jsonl");
  vi.stubEnv("GOOGLE_ADS_REQUEST_LOG_PATH", logPath);
  vi.spyOn(Service.prototype, "loadService").mockImplementation(() => ({
    listAccessibleCustomers: async () => [{ resource_names: ["customers/1112223333"] }],
    close: async () => {},
  }));
  vi.spyOn(Customer.prototype as any, "paginatedSearch").mockImplementation(async () => ({
    response: [{ customer: { id: 1112223333, descriptive_name: "Acct", manager: false } }],
  }));
  vi.spyOn(Service.prototype, "getAccessToken").mockImplementation(async () => {
    throw new Error("containment: getAccessToken reached");
  });
  vi.spyOn(Service.prototype, "getCredentials").mockImplementation(() => {
    throw new Error("containment: getCredentials reached");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth CLI enumerateAccounts", () => {
  it("logs ListAccessibleCustomers and each account read", async () => {
    const api = new GoogleAdsApi({ client_id: "fake-client", client_secret: "fake-secret", developer_token: "fake-dev" });
    const accounts = await enumerateAccounts(api, "fake-refresh");
    expect(accounts).toEqual([{ id: "1112223333", name: "Acct", isManager: false }]);
    expect(existsSync(logPath)).toBe(true);
    const got = readFileSync(logPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(got).toEqual([
      expect.objectContaining({ method: "CustomerService.ListAccessibleCustomers", customer_id: "", status: "ok" }),
      expect.objectContaining({ method: "GoogleAdsService.SearchStream", customer_id: "1112223333", status: "ok" }),
    ]);
  });
});
