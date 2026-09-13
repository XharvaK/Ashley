import { EXIT_CODES } from "../lifecycle/exit-codes.js";

export type GatewayAdmissionResult =
  | {
      admitted: true;
      total: number;
      remaining: number;
      resetAfterMs: number;
      maxConcurrency: number;
    }
  | {
      admitted: false;
      disposition: "INHIBITED_UNTIL";
      reason: "session_start_limit_exhausted" | "rate_limited";
      total?: number;
      remaining?: number;
      retryAtMs: number;
      resetAfterMs: number;
      resetAtIso: string;
      exitCode: typeof EXIT_CODES.INHIBITED_UNTIL;
    }
  | {
      admitted: false;
      disposition: "OPERATOR_REQUIRED";
      reason: "unauthorized";
      code: string;
      message: string;
      exitCode: typeof EXIT_CODES.OPERATOR_REQUIRED;
    }
  | {
      admitted: false;
      disposition: "RETRYABLE";
      reason: "network_error" | "rate_limited_unknown" | "malformed_gateway_response";
      error: string;
      exitCode: typeof EXIT_CODES.TRANSIENT;
    };

function isValidSafeIntegerGteZero(val: unknown): val is number {
  return typeof val === "number" && Number.isSafeInteger(val) && val >= 0;
}

function isValidFiniteGteZero(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val) && val >= 0;
}

export async function checkGatewayBotAdmission(
  token: string,
  dependencies: {
    fetchFn?: typeof fetch;
    nowFn?: () => number;
  } = {},
): Promise<GatewayAdmissionResult> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const nowFn = dependencies.nowFn ?? Date.now;

  let res: Response;
  try {
    res = await fetchFn("https://discord.com/api/v10/gateway/bot", {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "ProjectAshley (https://github.com/XharvaK/project-ashley, 0.1.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "network_error",
      error: err instanceof Error ? err.message : String(err),
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  if (res.status === 401) {
    return {
      admitted: false,
      disposition: "OPERATOR_REQUIRED",
      reason: "unauthorized",
      code: "DISCORD_UNAUTHORIZED",
      message: "Discord bot token is invalid (HTTP 401)",
      exitCode: EXIT_CODES.OPERATOR_REQUIRED,
    };
  }

  if (res.status === 429) {
    let retryAfterSec: number | null = null;
    const headerVal = res.headers.get("retry-after");
    if (headerVal) {
      const parsed = Number(headerVal);
      if (Number.isFinite(parsed) && parsed > 0) retryAfterSec = parsed;
    }
    if (retryAfterSec == null) {
      try {
        const body = (await res.json()) as { retry_after?: number };
        if (typeof body.retry_after === "number" && Number.isFinite(body.retry_after) && body.retry_after > 0) {
          retryAfterSec = body.retry_after;
        }
      } catch {
        // ignore json parse error
      }
    }

    if (retryAfterSec != null && retryAfterSec > 0) {
      const resetAfterMs = Math.round(retryAfterSec * 1000);
      const retryAtMs = nowFn() + resetAfterMs;
      return {
        admitted: false,
        disposition: "INHIBITED_UNTIL",
        reason: "rate_limited",
        retryAtMs,
        resetAfterMs,
        resetAtIso: new Date(retryAtMs).toISOString(),
        exitCode: EXIT_CODES.INHIBITED_UNTIL,
      };
    }

    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "rate_limited_unknown",
      error: "HTTP 429 without usable retry timing",
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  if (!res.ok) {
    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "network_error",
      error: `HTTP ${res.status}: ${res.statusText}`,
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  let data: {
    session_start_limit?: {
      total?: unknown;
      remaining?: unknown;
      reset_after?: unknown;
      max_concurrency?: unknown;
    };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch (err) {
    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "malformed_gateway_response",
      error: `Invalid gateway JSON: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  const limit = data?.session_start_limit;
  if (!limit) {
    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "malformed_gateway_response",
      error: "Missing session_start_limit in Discord response",
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  // R6: Strict validation of remaining
  if (!isValidSafeIntegerGteZero(limit.remaining)) {
    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "malformed_gateway_response",
      error: `Malformed session_start_limit.remaining: ${String(limit.remaining)}`,
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  // R6: Strict validation of total
  if (!isValidSafeIntegerGteZero(limit.total) || limit.total === 0) {
    return {
      admitted: false,
      disposition: "RETRYABLE",
      reason: "malformed_gateway_response",
      error: `Malformed session_start_limit.total: ${String(limit.total)}`,
      exitCode: EXIT_CODES.TRANSIENT,
    };
  }

  const maxConcurrency = isValidSafeIntegerGteZero(limit.max_concurrency) && limit.max_concurrency > 0
    ? limit.max_concurrency
    : 1;

  if (limit.remaining === 0) {
    // R6: Validate reset_after before deriving retryAtMs
    if (!isValidFiniteGteZero(limit.reset_after)) {
      return {
        admitted: false,
        disposition: "RETRYABLE",
        reason: "malformed_gateway_response",
        error: `Malformed session_start_limit.reset_after with 0 remaining: ${String(limit.reset_after)}`,
        exitCode: EXIT_CODES.TRANSIENT,
      };
    }

    const resetAfterMs = limit.reset_after;
    const retryAtMs = nowFn() + resetAfterMs;
    return {
      admitted: false,
      disposition: "INHIBITED_UNTIL",
      reason: "session_start_limit_exhausted",
      total: limit.total,
      remaining: 0,
      retryAtMs,
      resetAfterMs,
      resetAtIso: new Date(retryAtMs).toISOString(),
      exitCode: EXIT_CODES.INHIBITED_UNTIL,
    };
  }

  // remaining > 0 (proven positive safe integer)
  const resetAfterMs = isValidFiniteGteZero(limit.reset_after) ? limit.reset_after : 0;
  return {
    admitted: true,
    total: limit.total,
    remaining: limit.remaining,
    resetAfterMs,
    maxConcurrency,
  };
}
