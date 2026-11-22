/**
 * Recording stand-ins for the Google Ads client and the credential chain, for
 * tests that drive the real CallTool dispatch in src/index.ts.
 *
 * Containment: a test file that uses this swaps `GoogleAdsApi` (the only
 * network entry point index.ts uses: `new GoogleAdsApi(...)` and
 * `.Customer(...)`) for FakeGoogleAdsApi, and `resolveCredentials` /
 * `readStoredCredentials` for fakes, with vi.mock. Nothing it does can reach
 * Google Ads, read the per-user credentials file or the Keychain. Every call
 * the dispatch makes on a customer is recorded instead, so a test can assert
 * "no API call happened" or inspect the exact payload a mutate would send.
 *
 * Usage (vi.mock is hoisted, so import the helper inside the factory):
 *
 *   vi.mock("google-ads-api", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("google-ads-api")>()),
 *     GoogleAdsApi: (await import("../tests/helpers/recordingGoogleAds.js")).FakeGoogleAdsApi,
 *   }));
 *   vi.mock("./credentials.js", async (importOriginal) =>
 *     (await import("../tests/helpers/recordingGoogleAds.js")).fakeCredentialsModule(
 *       await importOriginal<typeof import("../src/credentials.js")>(),
 *     ),
 *   );
 *
 * Fidelity: the fake customer exposes only the service namespaces the real
 * google-ads-api Customer has (read off its ServiceFactory getters at load
 * time). Any other name is undefined, exactly as in production, so a typo'd
 * or non-existent service (`customer.asset_sets`, `customer.assetLabels`)
 * fails here instead of being recorded as if it worked.
 */

import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

/** Service namespaces on the real Customer, e.g. "campaigns", "adGroupAdLabels". */
export const REAL_SERVICE_NAMES: ReadonlySet<string> = (() => {
  const ServiceFactory = requireCjs("google-ads-api/build/src/protos/autogen/serviceFactory.js").default;
  const descriptors = Object.getOwnPropertyDescriptors(ServiceFactory.prototype);
  return new Set(
    Object.entries(descriptors)
      .filter(([, d]) => typeof d.get === "function")
      .map(([name]) => name),
  );
})();

export const FAKE_CUSTOMER_ID = "1234567890";

export interface RecordedCall {
  /** "query", "mutateResources", or "<service>.<method>" e.g. "adGroupAds.create". */
  method: string;
  args: any[];
}

/**
 * A test-supplied GAQL answer: rows for any query the pattern matches. A
 * function gets the GAQL string, so a test can apply the query's own WHERE
 * the way Google would (a static answer ignores it).
 */
export interface QueryAnswer {
  pattern: RegExp;
  rows: any[] | ((gaql: string) => any[]);
}

export const recorder = {
  apiConstructed: 0,
  customersOpened: 0,
  credentialReads: 0,
  calls: [] as RecordedCall[],
  /** Checked first, in order, before the built-in answers in rowsFor(). */
  queryAnswers: [] as QueryAnswer[],
  /** Service methods ("<service>.<method>") that reject instead of resolving. */
  failingMethods: new Map<string, Error>(),
  reset(): void {
    this.apiConstructed = 0;
    this.customersOpened = 0;
    this.credentialReads = 0;
    this.calls = [];
    this.queryAnswers = [];
    this.failingMethods = new Map();
  },
  /** Answer every query matching `pattern` with `rows` (or what `rows(gaql)` returns). */
  answerQuery(pattern: RegExp, rows: QueryAnswer["rows"]): void {
    this.queryAnswers.push({ pattern, rows });
  },
  /** Make one service method reject, e.g. failMethod("campaignLabels.create", new Error("x")). */
  failMethod(method: string, error: Error): void {
    this.failingMethods.set(method, error);
  },
  /** Every recorded GAQL string, in call order. */
  queries(): string[] {
    return this.calls.filter((c) => c.method === "query").map((c) => String(c.args[0]));
  },
  /** Every recorded call that is not a GAQL read. */
  writes(): RecordedCall[] {
    return this.calls.filter((c) => c.method !== "query");
  },
  /** Recorded calls to one method, e.g. callsTo("adGroupAds.create"). */
  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  },
};

/**
 * GAQL answers the create paths need: labels already exist (so label helpers
 * attach rather than create), and an ad group looked up by id is a Demand Gen
 * ad group. Everything else returns no rows.
 */
function rowsFor(gaql: string): any[] {
  for (const answer of recorder.queryAnswers) {
    if (answer.pattern.test(gaql)) return typeof answer.rows === "function" ? answer.rows(gaql) : answer.rows;
  }
  const label = gaql.match(/label\.name\s*=\s*'([^']*)'/);
  if (label) {
    return [{ label: { resource_name: `customers/${FAKE_CUSTOMER_ID}/labels/1`, name: label[1] } }];
  }
  if (/FROM\s+ad_group\s+WHERE\s+ad_group\.id\s*=/i.test(gaql)) {
    return [{ ad_group: { id: 111 }, campaign: { advertising_channel_type: "DEMAND_GEN" } }];
  }
  return [];
}

function resultsFor(service: string, ops: unknown): { results: Array<{ resource_name: string }> } {
  const list = Array.isArray(ops) ? ops : [];
  return {
    results: list.map((_, i) => ({ resource_name: `customers/${FAKE_CUSTOMER_ID}/${service}/${i + 1}` })),
  };
}

/** A service namespace (customer.adGroupAds etc.) whose every method records and resolves. */
function service(name: string): any {
  return new Proxy(function () {}, {
    get(_target, method) {
      if (typeof method === "symbol" || method === "then") return undefined;
      return async (...args: any[]) => {
        const full = `${name}.${method}`;
        recorder.calls.push({ method: full, args });
        const failure = recorder.failingMethods.get(full);
        if (failure) throw failure;
        return resultsFor(name, args[0]);
      };
    },
    apply(_target, _this, args) {
      recorder.calls.push({ method: name, args });
      return Promise.resolve([]);
    },
  });
}

/** Resource name a mutateResources create returns, per entity. */
const MUTATE_RESOURCE_NAMES: Record<string, string> = {
  campaign: `customers/${FAKE_CUSTOMER_ID}/campaigns/1`,
  ad_group: `customers/${FAKE_CUSTOMER_ID}/adGroups/1`,
  ad_group_ad: `customers/${FAKE_CUSTOMER_ID}/adGroupAds/111~222`,
};

function makeCustomer(): any {
  const own: Record<string, any> = {
    async query(gaql: string) {
      recorder.calls.push({ method: "query", args: [gaql] });
      return rowsFor(gaql);
    },
    async mutateResources(ops: any[]) {
      recorder.calls.push({ method: "mutateResources", args: [ops] });
      return {
        mutate_operation_responses: (ops ?? []).map((op: any) => ({
          [`${op?.entity}_result`]: {
            resource_name: MUTATE_RESOURCE_NAMES[op?.entity] ?? `customers/${FAKE_CUSTOMER_ID}/adGroupAds/111~222`,
          },
        })),
      };
    },
  };
  return new Proxy(own, {
    get(target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop in target) return target[prop];
      return REAL_SERVICE_NAMES.has(prop) ? service(prop) : undefined;
    },
  });
}

export class FakeGoogleAdsApi {
  constructor(_options: unknown) {
    recorder.apiConstructed += 1;
  }

  Customer(_options: unknown): any {
    recorder.customersOpened += 1;
    return makeCustomer();
  }
}

/**
 * Format-valid, obviously fake values (validateResolvedCredentials passes).
 * Letters only: scripts/scan-history-secrets.mjs treats a 16+ char value with
 * digits on a client_secret / developer_token line as a leaked literal.
 */
export const FAKE_CREDENTIALS = {
  client_id: "fake-client-id",
  client_secret: "fake-client-secret",
  developer_token: "fake-developer-token",
  refresh_token: "fake-refresh-token",
  customer_id: FAKE_CUSTOMER_ID,
  mcc_customer_id: "",
  source: "env" as const,
};

/** The real credentials module with every read of real credentials replaced. */
export function fakeCredentialsModule<T extends object>(actual: T): T {
  return {
    ...actual,
    resolveCredentials: () => {
      recorder.credentialReads += 1;
      return { ...FAKE_CREDENTIALS };
    },
    readStoredCredentials: () => {
      recorder.credentialReads += 1;
      return null;
    },
  };
}
