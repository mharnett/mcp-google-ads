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
 */

export const FAKE_CUSTOMER_ID = "1234567890";

export interface RecordedCall {
  /** "query", "mutateResources", or "<service>.<method>" e.g. "adGroupAds.create". */
  method: string;
  args: any[];
}

export const recorder = {
  apiConstructed: 0,
  customersOpened: 0,
  credentialReads: 0,
  calls: [] as RecordedCall[],
  reset(): void {
    this.apiConstructed = 0;
    this.customersOpened = 0;
    this.credentialReads = 0;
    this.calls = [];
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
        recorder.calls.push({ method: `${name}.${method}`, args });
        return resultsFor(name, args[0]);
      };
    },
    apply(_target, _this, args) {
      recorder.calls.push({ method: name, args });
      return Promise.resolve([]);
    },
  });
}

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
            resource_name: `customers/${FAKE_CUSTOMER_ID}/adGroupAds/111~222`,
          },
        })),
      };
    },
  };
  return new Proxy(own, {
    get(target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop in target) return target[prop];
      return service(prop);
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
