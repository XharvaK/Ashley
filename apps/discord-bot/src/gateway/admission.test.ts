import test from "node:test";
import assert from "node:assert/strict";
import { checkGatewayBotAdmission } from "./admission.js";
import { EXIT_CODES } from "../lifecycle/exit-codes.js";

test("checkGatewayBotAdmission: admits login when remaining > 0 (valid integer) and calls exact literal Gateway URL", async () => {
  let calledUrl: string | undefined;
  let calledUserAgent: string | undefined;

  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    calledUrl = String(url);
    calledUserAgent = (init?.headers as Record<string, string>)?.[
      "User-Agent"
    ];
    return new Response(
      JSON.stringify({
        url: "wss://gateway.discord.gg/",
        shards: 1,
        session_start_limit: {
          total: 1000,
          remaining: 999,
          reset_after: 86400000,
          max_concurrency: 1,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(calledUrl, "https://discord.com/api/v10/gateway/bot");
  assert.equal(
    calledUserAgent,
    "ProjectAshley (https://github.com/XharvaK/project-ashley, 0.1.0)",
  );
  assert.equal(result.admitted, true);
  if (result.admitted) {
    assert.equal(result.total, 1000);
    assert.equal(result.remaining, 999);
  }
});

test("checkGatewayBotAdmission: refuses with INHIBITED_UNTIL when remaining === 0 and reset_after is valid", async () => {
  const fixedNow = 1787377000000;
  const resetAfter = 72000000;
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        url: "wss://gateway.discord.gg/",
        shards: 1,
        session_start_limit: {
          total: 1000,
          remaining: 0,
          reset_after: resetAfter,
          max_concurrency: 1,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
    nowFn: () => fixedNow,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "INHIBITED_UNTIL");
    assert.equal(result.exitCode, EXIT_CODES.INHIBITED_UNTIL);
    assert.equal(result.retryAtMs, fixedNow + resetAfter);
    assert.equal(result.resetAtIso, new Date(fixedNow + resetAfter).toISOString());
  }
});

test("checkGatewayBotAdmission: refuses with RETRYABLE when remaining === 0 but reset_after is missing or invalid", async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        session_start_limit: {
          total: 1000,
          remaining: 0,
          reset_after: "invalid_string",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "RETRYABLE");
    assert.equal(result.exitCode, EXIT_CODES.TRANSIENT);
  }
});

test("checkGatewayBotAdmission (R6): fails closed with RETRYABLE on NaN remaining", async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        session_start_limit: {
          total: 1000,
          remaining: null, // parses as non-number
          reset_after: 5000,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "RETRYABLE");
    assert.equal(result.exitCode, EXIT_CODES.TRANSIENT);
  }
});

test("checkGatewayBotAdmission (R6): fails closed with RETRYABLE on negative remaining", async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        session_start_limit: {
          total: 1000,
          remaining: -5,
          reset_after: 5000,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "RETRYABLE");
    assert.equal(result.exitCode, EXIT_CODES.TRANSIENT);
  }
});

test("checkGatewayBotAdmission (R6): fails closed with RETRYABLE on fractional remaining", async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        session_start_limit: {
          total: 1000,
          remaining: 0.5,
          reset_after: 5000,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "RETRYABLE");
    assert.equal(result.exitCode, EXIT_CODES.TRANSIENT);
  }
});

test("checkGatewayBotAdmission: returns OPERATOR_REQUIRED on HTTP 401 Unauthorized", async () => {
  const mockFetch = async () => {
    return new Response("Unauthorized", { status: 401 });
  };

  const result = await checkGatewayBotAdmission("invalid-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "OPERATOR_REQUIRED");
    assert.equal(result.exitCode, EXIT_CODES.OPERATOR_REQUIRED);
    assert.equal(result.code, "DISCORD_UNAUTHORIZED");
  }
});

test("checkGatewayBotAdmission: returns INHIBITED_UNTIL on HTTP 429 with retry-after header", async () => {
  const fixedNow = 1787377000000;
  const retryAfterSec = 5.5;
  const mockFetch = async () => {
    return new Response(JSON.stringify({ message: "You are being rate limited." }), {
      status: 429,
      headers: { "retry-after": String(retryAfterSec) },
    });
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
    nowFn: () => fixedNow,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "INHIBITED_UNTIL");
    assert.equal(result.exitCode, EXIT_CODES.INHIBITED_UNTIL);
    assert.equal(result.retryAtMs, fixedNow + Math.round(retryAfterSec * 1000));
  }
});

test("checkGatewayBotAdmission: returns RETRYABLE on HTTP 429 without usable retry timing", async () => {
  const mockFetch = async () => {
    return new Response("Too Many Requests", { status: 429 });
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "RETRYABLE");
    assert.equal(result.exitCode, EXIT_CODES.TRANSIENT);
  }
});

test("checkGatewayBotAdmission: returns RETRYABLE on network / fetch error", async () => {
  const mockFetch = async () => {
    throw new Error("connect ECONNREFUSED 162.159.130.233:443");
  };

  const result = await checkGatewayBotAdmission("test-token", {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.admitted, false);
  if (!result.admitted) {
    assert.equal(result.disposition, "RETRYABLE");
    assert.equal(result.exitCode, EXIT_CODES.TRANSIENT);
  }
});
