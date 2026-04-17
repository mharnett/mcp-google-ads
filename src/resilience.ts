import {
  retry,
  circuitBreaker,
  wrap,
  handleWhen,
  timeout,
  TimeoutStrategy,
  ExponentialBackoff,
  ConsecutiveBreaker,
} from "cockatiel";
import pino from "pino";

// ============================================
// LOGGER
// ============================================

// CRITICAL: all logger output MUST go to stderr (fd 2). stdout is reserved
// for MCP JSON-RPC frames; any bytes on stdout that aren't valid JSON-RPC
// get rejected by Claude Desktop with a schema error listing pino keys
// (level, time, pid, hostname, msg) as unrecognized_keys.
//
// Pass pino.destination(2) as the second arg unconditionally so every path
// (TTY dev run, non-TTY Claude Desktop subprocess, test mode) ends up on
// stderr. The transport config only gates pino-pretty formatting, not the
// destination.
export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    redact: ["access_token", "refresh_token", "client_secret", "*.access_token", "*.refresh_token", "*.client_secret"],
    ...(process.env.NODE_ENV !== "test" && process.stderr.isTTY && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          singleLine: true,
          translateTime: "SYS:standard",
          destination: 2,
        },
      },
    }),
  },
  pino.destination(2),
);

// ============================================
// SAFE RESPONSE (Response Size Limiting)
// ============================================

const MAX_RESPONSE_SIZE = 200_000; // 200KB

export function safeResponse<T>(data: T, context: string): T {
  let current = data;
  for (let pass = 0; pass < 10; pass++) {
    const jsonStr = JSON.stringify(current);
    const sizeBytes = Buffer.byteLength(jsonStr, "utf-8");
    if (sizeBytes <= MAX_RESPONSE_SIZE) return current;

    // Deep clone on first truncation pass to avoid mutating the original object
    if (pass === 0 && typeof current === "object" && current !== null) {
      current = JSON.parse(JSON.stringify(current)) as T;
    }

    logger.warn({ sizeBytes, maxSize: MAX_RESPONSE_SIZE, context, pass }, "Response exceeds size limit, truncating");

    if (Array.isArray(current)) {
      current = (current as any[]).slice(0, Math.max(1, Math.floor((current as any[]).length * 0.5))) as T;
      continue;
    }

    if (typeof current === "object" && current !== null) {
      const obj = current as Record<string, any>;
      let truncated = false;
      for (const key of ["items", "results", "data", "rows", "tags", "triggers", "variables"]) {
        if (Array.isArray(obj[key]) && obj[key].length > 1) {
          obj[key] = obj[key].slice(0, Math.max(1, Math.floor(obj[key].length * 0.5)));
          if ("count" in obj) obj.count = obj[key].length;
          if ("row_count" in obj) obj.row_count = obj[key].length;
          obj.truncated = true;
          truncated = true;
          break;
        }
      }
      if (truncated) continue;
    }

    // Can't truncate further (not an array/object with known keys)
    break;
  }
  return current;
}

// ============================================
// RETRY + CIRCUIT BREAKER + TIMEOUT
// ============================================

const backoff = new ExponentialBackoff({
  initialDelay: 100,
  maxDelay: 5_000,
});

const isTransient = handleWhen((err) => {
  const msg = (err?.message || "").toLowerCase();
  const code = (err as any)?.code || (err as any)?.status;
  // Don't retry auth errors
  if (code === 401 || code === 403 || code === 7 || code === 16) return false;
  if (msg.includes("unauthenticated") || msg.includes("permission_denied") || msg.includes("invalid_grant")) return false;
  // Don't retry client errors (except rate limits)
  if (code === 429 || msg.includes("rate")) return true;
  if (code >= 400 && code < 500) return false;
  // Retry everything else (5xx, timeouts, network errors)
  return true;
});

// Individual policies
const retryPolicy = retry(isTransient, {
  maxAttempts: 3,
  backoff,
});

const circuitBreakerPolicy = circuitBreaker(isTransient, {
  halfOpenAfter: 60_000, // 60s to attempt recovery
  breaker: new ConsecutiveBreaker(5), // Open after 5 consecutive failures
});

const timeoutPolicy = timeout(30_000, TimeoutStrategy.Cooperative);

// Combine policies: timeout -> circuit breaker -> retry
const policy = wrap(timeoutPolicy, circuitBreakerPolicy, retryPolicy);

// ============================================
// WRAPPED API CALL WITH LOGGING
// ============================================

export async function withResilience<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  try {
    logger.debug({ operation: operationName }, "Starting API call");

    const result = await policy.execute(() => fn());

    logger.debug({ operation: operationName }, "API call succeeded");
    return result;
  } catch (err) {
    // Extract a useful message from gRPC/google-ads-api errors
    // where String(err) produces "[object Object]"
    let error: Error;
    if (err instanceof Error) {
      error = err;
    } else {
      // Try to get message from nested errors array (google-ads-api pattern)
      const nested = (err as any)?.errors?.[0];
      const msg = nested?.message
        || (typeof (err as any)?.message === "string" ? (err as any).message : null)
        || (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      error = new Error(msg);
      (error as any).cause = err;
    }
    logger.error(
      { operation: operationName, error: error.message, stack: error.stack },
      "API call failed after retries"
    );
    throw error;
  }
}
