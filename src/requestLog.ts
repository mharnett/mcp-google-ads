// Per-request Google Ads log: one JSONL line for every API call this package
// makes, so a quota burst can be traced to the process that made it.
//
// The line names the call, never its content: no tokens, no headers, no
// request body, no GAQL text, no error message (messages can quote the query).
//
// Fields (REQUEST_LOG_FIELDS):
//   ts             UTC ISO-8601 timestamp
//   caller         DRAK_JOB, else RAILWAY_SERVICE_NAME, else the script name
//   host           os.hostname()
//   pid, ppid      this process and its parent (ties MCP lines to a session)
//   lib            "mcp-google-ads"
//   method         e.g. "GoogleAdsService.SearchStream", "CampaignService.mutateCampaigns"
//   customer_id    digits only
//   operations     mutate operations in the request; 1 for a read
//   validate_only  true for a dry-run mutate
//   status         "ok" | "error" | "sent" ("sent": a stream, logged when opened)
//   error          short error code or class name when status is "error", else null
//   resources      what a successful, non-validate_only mutate wrote: one
//                  { operation, resource_name } per operation whose result
//                  names a resource (operation: "create" | "update" |
//                  "remove"). null on reads, service calls, errors and
//                  validate_only. Read by the write-identity audit
//                  (quality-control cron/unauthorized_change_sweep.py) as an
//                  independent record to hold change_event against.
//
// Destination:
//   GOOGLE_ADS_REQUEST_LOG_PATH set     -> that file
//   macOS, not Railway, not CI         -> ~/Library/Logs/google-ads-requests.jsonl
//   anything else (Linux, Railway, CI) -> stderr. stderr rather than stdout
//                                         because stdout carries the MCP's
//                                         JSON-RPC frames; Railway captures both.
// The file rotates to <path>.1 at REQUEST_LOG_MAX_BYTES.
//
// Hook point: google-ads-api calls the Customer's hooks around every query,
// stream, mutate and service call, inside the retry wrapper, so each attempt
// is one line. Logging must never fail or alter the call: every hook body is
// wrapped, and nothing here calls resolve()/cancel().

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import type { Hooks } from "google-ads-api";

export const REQUEST_LOG_FILENAME = "google-ads-requests.jsonl";
export const REQUEST_LOG_MAX_BYTES = 20 * 1024 * 1024;
const LIB = "mcp-google-ads";

export const REQUEST_LOG_FIELDS = [
  "ts",
  "caller",
  "host",
  "pid",
  "ppid",
  "lib",
  "method",
  "customer_id",
  "operations",
  "validate_only",
  "status",
  "error",
  "resources",
] as const;

export type RequestStatus = "ok" | "error" | "sent";

export interface WrittenResource {
  operation: string;
  resource_name: string;
}

export interface RequestFields {
  method: string;
  customer_id: string;
  operations: number;
  validate_only: boolean;
  status: RequestStatus;
  error?: string | null;
  resources?: WrittenResource[] | null;
}

export type RequestLogDestination = { kind: "file"; path: string } | { kind: "stream" };

export function requestLogDestination(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): RequestLogDestination {
  if (env.GOOGLE_ADS_REQUEST_LOG_PATH) return { kind: "file", path: env.GOOGLE_ADS_REQUEST_LOG_PATH };
  if (env.RAILWAY_ENVIRONMENT || env.CI || platform !== "darwin") return { kind: "stream" };
  return { kind: "file", path: path.join(home, "Library", "Logs", REQUEST_LOG_FILENAME) };
}

export function callerName(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): string {
  if (env.DRAK_JOB) return env.DRAK_JOB;
  if (env.RAILWAY_SERVICE_NAME) return env.RAILWAY_SERVICE_NAME;
  // Node's argv[0] is the node binary; argv[1] is the script, the equivalent
  // of Python's sys.argv[0].
  const script = argv[1] || argv[0];
  return script ? path.basename(script) : "unknown";
}

/** Append one JSON line. Never throws. */
export function writeRequestLogLine(
  entry: Record<string, unknown>,
  dest: RequestLogDestination = requestLogDestination(),
  maxBytes: number = REQUEST_LOG_MAX_BYTES,
): void {
  try {
    const line = JSON.stringify(entry) + "\n";
    if (dest.kind === "stream") {
      process.stderr.write(line);
      return;
    }
    mkdirSync(path.dirname(dest.path), { recursive: true });
    try {
      if (statSync(dest.path).size >= maxBytes) renameSync(dest.path, dest.path + ".1");
    } catch {
      // no file yet, or a concurrent writer rotated it first
    }
    appendFileSync(dest.path, line);
  } catch {
    // Logging never fails the caller.
  }
}

function digits(id: unknown): string {
  return String(id ?? "").replace(/\D/g, "");
}

/** Build the full line from the call's fields and write it. Never throws. */
export function logGoogleAdsRequest(fields: RequestFields): void {
  try {
    writeRequestLogLine({
      ts: new Date().toISOString(),
      caller: callerName(),
      host: hostname(),
      pid: process.pid,
      ppid: process.ppid,
      lib: LIB,
      method: fields.method,
      customer_id: digits(fields.customer_id),
      operations: fields.operations,
      validate_only: fields.validate_only,
      status: fields.status,
      error: fields.status === "error" ? fields.error ?? "Error" : null,
      resources: fields.resources ?? null,
    });
  } catch {
    // Logging never fails the caller.
  }
}

/**
 * A short, content-free error label: the first GoogleAdsFailure error code
 * ("quota_error:2") when there is one, else the error's class name.
 */
export function errorCode(err: unknown): string {
  try {
    const first = (err as any)?.errors?.[0]?.error_code;
    if (first && typeof first === "object") {
      const [k, v] = Object.entries(first)[0] ?? [];
      if (k) return `${k}:${String(v)}`;
    }
    const name = (err as any)?.constructor?.name;
    return typeof name === "string" && name ? name : typeof err;
  } catch {
    return "unknown";
  }
}

type Log = (fields: RequestFields) => void;

const OPERATION_KEYS = ["create", "update", "remove"] as const;

function typedOperation(op: any): string {
  if (typeof op?.operation === "string" && op.operation) return op.operation;
  for (const k of OPERATION_KEYS) if (op?.[k] != null) return k;
  return "unknown";
}

/** The resource name inside one GoogleAdsService.mutate response entry ({ campaign_result: { resource_name } }). */
function mutateResultName(entry: any): string | null {
  if (!entry || typeof entry !== "object") return null;
  for (const key of Object.keys(entry)) {
    const rn = entry[key]?.resource_name;
    if (typeof rn === "string" && rn) return rn;
  }
  return null;
}

/**
 * What a successful mutate wrote, from its onMutationEnd hook arguments: one
 * entry per operation whose result names a resource. A partial-failure
 * operation comes back with an empty result and is left out. Never throws.
 */
export function writtenResources(a: any): WrittenResource[] {
  const out: WrittenResource[] = [];
  try {
    if (a?.isServiceCall) {
      const ops = a?.mutation?.operations;
      const results = a?.response?.results;
      if (!Array.isArray(results)) return out;
      results.forEach((r: any, i: number) => {
        const rn = r?.resource_name;
        if (typeof rn === "string" && rn) {
          out.push({ operation: typedOperation(Array.isArray(ops) ? ops[i] : undefined), resource_name: rn });
        }
      });
      return out;
    }
    const mutations = a?.mutations;
    const responses = a?.response?.mutate_operation_responses;
    if (!Array.isArray(responses)) return out;
    responses.forEach((r: any, i: number) => {
      const rn = mutateResultName(r);
      if (!rn) return;
      // google-ads-api defaults a mutateResources operation to "create".
      const op = Array.isArray(mutations) ? mutations[i]?.operation : undefined;
      out.push({ operation: typeof op === "string" && op ? op : "create", resource_name: rn });
    });
  } catch {
    // an unexpected response shape never fails the mutate
  }
  return out;
}

function opCount(list: unknown): number {
  return Array.isArray(list) ? list.length : 1;
}

/**
 * Hooks for `api.Customer(options, hooks)`. `mutateOptions` carries the
 * options of each mutateResources call (the library does not pass them to
 * its hooks); withRequestLog fills it.
 */
export function requestLogHooks(
  opts: { log?: Log; mutateOptions?: WeakMap<object, any> } = {},
): Hooks {
  const log = opts.log ?? logGoogleAdsRequest;
  const emit = (fields: RequestFields) => {
    try {
      log(fields);
    } catch {
      // Logging never fails the caller.
    }
  };
  const read = (a: any, status: RequestStatus, error?: unknown) =>
    emit({
      method: "GoogleAdsService.SearchStream",
      customer_id: a?.credentials?.customer_id,
      operations: 1,
      validate_only: false,
      status,
      error: error === undefined ? null : errorCode(error),
    });
  const mutation = (a: any, status: RequestStatus, error?: unknown) => {
    let operations = 1;
    let validateOnly = false;
    try {
      if (a?.isServiceCall) {
        operations = opCount(a?.mutation?.operations);
        validateOnly = a?.mutation?.validate_only === true;
      } else {
        operations = opCount(a?.mutations);
        validateOnly = opts.mutateOptions?.get(a?.mutations)?.validate_only === true;
      }
    } catch {
      // fall through with the defaults
    }
    emit({
      method: String(a?.method ?? "unknown"),
      customer_id: a?.credentials?.customer_id,
      operations,
      validate_only: validateOnly,
      status,
      error: error === undefined ? null : errorCode(error),
      resources: status === "ok" && !validateOnly ? writtenResources(a) : null,
    });
  };
  const service = (a: any, status: RequestStatus, error?: unknown) => {
    const req = a?.requestOptions;
    emit({
      method: String(a?.method ?? "unknown"),
      customer_id: a?.credentials?.customer_id,
      operations: Array.isArray(req?.operations) ? req.operations.length : 1,
      validate_only: req?.validate_only === true,
      status,
      error: error === undefined ? null : errorCode(error),
    });
  };
  return {
    onQueryEnd: (a) => read(a, "ok"),
    onQueryError: (a) => read(a, "error", a.error),
    // A stream has no end hook in google-ads-api: log it when it opens.
    onStreamStart: (a) => read(a, "sent"),
    onMutationEnd: (a) => mutation(a, "ok"),
    onMutationError: (a) => mutation(a, "error", a.error),
    onServiceEnd: (a) => service(a, "ok"),
    onServiceError: (a) => service(a, "error", a.error),
  };
}

/**
 * Open a Customer with request-log hooks. Also records each mutateResources
 * call's options so its line carries validate_only.
 */
export function withRequestLog<C>(open: (hooks: Hooks) => C, log?: Log): C {
  const mutateOptions = new WeakMap<object, any>();
  const customer = open(requestLogHooks({ log, mutateOptions }));
  try {
    const target = customer as any;
    const original = target?.mutateResources;
    if (typeof original === "function") {
      target.mutateResources = function (mutations: any, options?: any) {
        try {
          if (mutations && typeof mutations === "object") mutateOptions.set(mutations, options ?? {});
        } catch {
          // never block the mutate
        }
        return original.call(target, mutations, options);
      };
    }
  } catch {
    // never block opening the customer
  }
  return customer;
}

/** Log a call made outside a Customer (e.g. api.listAccessibleCustomers). */
export async function loggedCall<T>(
  call: { method: string; customer_id: string; operations?: number; validate_only?: boolean },
  fn: () => Promise<T>,
  log: Log = logGoogleAdsRequest,
): Promise<T> {
  const base = {
    method: call.method,
    customer_id: call.customer_id,
    operations: call.operations ?? 1,
    validate_only: call.validate_only ?? false,
  };
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    try {
      log({ ...base, status: "error", error: errorCode(err) });
    } catch {
      // Logging never fails the caller.
    }
    throw err;
  }
  try {
    log({ ...base, status: "ok", error: null });
  } catch {
    // Logging never fails the caller.
  }
  return result;
}
