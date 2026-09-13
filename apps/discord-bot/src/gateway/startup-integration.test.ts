import test from "node:test";
import assert from "node:assert/strict";
import { runDiscordMain } from "../index.js";
import { EXIT_CODES } from "../lifecycle/exit-codes.js";
import type { GatewayAdmissionResult } from "./admission.js";

test("startup-integration (R1): remaining === 0 refuses startup, sets exit 75, and NEVER calls startBot", async () => {
  let startBotCallCount = 0;
  let exitCodeRecorded: number | undefined;

  const mockCheckAdmission = async (): Promise<GatewayAdmissionResult> => ({
    admitted: false,
    disposition: "INHIBITED_UNTIL",
    reason: "session_start_limit_exhausted",
    total: 1000,
    remaining: 0,
    retryAtMs: 1787377072000,
    resetAfterMs: 72000000,
    resetAtIso: new Date(1787377072000).toISOString(),
    exitCode: EXIT_CODES.INHIBITED_UNTIL,
  });

  const mockStartBot = async () => {
    startBotCallCount += 1;
    throw new Error("startBot should never be called when admission is refused");
  };

  const code = await runDiscordMain({
    validateConfig: () => {},
    checkAdmission: mockCheckAdmission,
    startBot: mockStartBot,
    setExitCode: (c) => { exitCodeRecorded = c; },
    token: "mock-token",
    registerSignalHandlers: false,
  });

  assert.equal(startBotCallCount, 0, "startBot call count MUST be 0 on remaining === 0");
  assert.equal(exitCodeRecorded, 75);
  assert.equal(code, 75);
});

test("startup-integration (R1): HTTP 401 Unauthorized refuses startup, sets exit 78, and NEVER calls startBot", async () => {
  let startBotCallCount = 0;
  let exitCodeRecorded: number | undefined;

  const mockCheckAdmission = async (): Promise<GatewayAdmissionResult> => ({
    admitted: false,
    disposition: "OPERATOR_REQUIRED",
    reason: "unauthorized",
    code: "DISCORD_UNAUTHORIZED",
    message: "Discord bot token is invalid (HTTP 401)",
    exitCode: EXIT_CODES.OPERATOR_REQUIRED,
  });

  const mockStartBot = async () => {
    startBotCallCount += 1;
    throw new Error("startBot should never be called on 401");
  };

  const code = await runDiscordMain({
    validateConfig: () => {},
    checkAdmission: mockCheckAdmission,
    startBot: mockStartBot,
    setExitCode: (c) => { exitCodeRecorded = c; },
    token: "invalid-token",
    registerSignalHandlers: false,
  });

  assert.equal(startBotCallCount, 0, "startBot call count MUST be 0 on HTTP 401");
  assert.equal(exitCodeRecorded, 78);
  assert.equal(code, 78);
});

test("startup-integration (R1): HTTP 429 with usable timing refuses startup, sets exit 75, and NEVER calls startBot", async () => {
  let startBotCallCount = 0;
  let exitCodeRecorded: number | undefined;

  const mockCheckAdmission = async (): Promise<GatewayAdmissionResult> => ({
    admitted: false,
    disposition: "INHIBITED_UNTIL",
    reason: "rate_limited",
    retryAtMs: 1787377005000,
    resetAfterMs: 5000,
    resetAtIso: new Date(1787377005000).toISOString(),
    exitCode: EXIT_CODES.INHIBITED_UNTIL,
  });

  const mockStartBot = async () => {
    startBotCallCount += 1;
    throw new Error("startBot should never be called on 429");
  };

  const code = await runDiscordMain({
    validateConfig: () => {},
    checkAdmission: mockCheckAdmission,
    startBot: mockStartBot,
    setExitCode: (c) => { exitCodeRecorded = c; },
    token: "mock-token",
    registerSignalHandlers: false,
  });

  assert.equal(startBotCallCount, 0, "startBot call count MUST be 0 on HTTP 429 with usable retry");
  assert.equal(exitCodeRecorded, 75);
  assert.equal(code, 75);
});

test("startup-integration (R1): HTTP 429 without usable timing refuses startup, sets exit 1, and NEVER calls startBot", async () => {
  let startBotCallCount = 0;
  let exitCodeRecorded: number | undefined;

  const mockCheckAdmission = async (): Promise<GatewayAdmissionResult> => ({
    admitted: false,
    disposition: "RETRYABLE",
    reason: "rate_limited_unknown",
    error: "HTTP 429 without usable retry timing",
    exitCode: EXIT_CODES.TRANSIENT,
  });

  const mockStartBot = async () => {
    startBotCallCount += 1;
    throw new Error("startBot should never be called on 429 unknown");
  };

  const code = await runDiscordMain({
    validateConfig: () => {},
    checkAdmission: mockCheckAdmission,
    startBot: mockStartBot,
    setExitCode: (c) => { exitCodeRecorded = c; },
    token: "mock-token",
    registerSignalHandlers: false,
  });

  assert.equal(startBotCallCount, 0, "startBot call count MUST be 0 on HTTP 429 without retry time");
  assert.equal(exitCodeRecorded, 1);
  assert.equal(code, 1);
});

test("startup-integration (R1): network/preflight failure refuses startup, sets exit 1, and NEVER calls startBot", async () => {
  let startBotCallCount = 0;
  let exitCodeRecorded: number | undefined;

  const mockCheckAdmission = async (): Promise<GatewayAdmissionResult> => ({
    admitted: false,
    disposition: "RETRYABLE",
    reason: "network_error",
    error: "ECONNREFUSED",
    exitCode: EXIT_CODES.TRANSIENT,
  });

  const mockStartBot = async () => {
    startBotCallCount += 1;
    throw new Error("startBot should never be called on network error");
  };

  const code = await runDiscordMain({
    validateConfig: () => {},
    checkAdmission: mockCheckAdmission,
    startBot: mockStartBot,
    setExitCode: (c) => { exitCodeRecorded = c; },
    token: "mock-token",
    registerSignalHandlers: false,
  });

  assert.equal(startBotCallCount, 0, "startBot call count MUST be 0 on network error");
  assert.equal(exitCodeRecorded, 1);
  assert.equal(code, 1);
});

test("startup-integration: admission allowed calls startBot exactly once", async () => {
  let startBotCallCount = 0;

  const mockCheckAdmission = async (): Promise<GatewayAdmissionResult> => ({
    admitted: true,
    total: 1000,
    remaining: 500,
    resetAfterMs: 36000000,
    maxConcurrency: 1,
  });

  const mockStartBot = async () => {
    startBotCallCount += 1;
    return {} as any;
  };

  await runDiscordMain({
    validateConfig: () => {},
    checkAdmission: mockCheckAdmission,
    startBot: mockStartBot,
    token: "valid-token",
    registerSignalHandlers: false,
  });

  assert.equal(startBotCallCount, 1, "startBot MUST be called exactly once when admission is granted");
});
