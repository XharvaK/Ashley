import test from "node:test";
import assert from "node:assert/strict";
import { classifyDiscordStartupError } from "./classify.js";
import { EXIT_CODES } from "./exit-codes.js";

test("classifyDiscordStartupError: classifies config_missing code as OPERATOR_REQUIRED", () => {
  const err = new Error("Missing env: DISCORD_BOT_TOKEN") as Error & { code?: string };
  err.code = "config_missing";
  const res = classifyDiscordStartupError(err);
  assert.equal(res.kind, "OPERATOR_REQUIRED");
  assert.equal(res.exitCode, EXIT_CODES.OPERATOR_REQUIRED);
  assert.equal(res.code, "config_missing");
});

test("classifyDiscordStartupError: changing human wording does not change OPERATOR_REQUIRED when code is config_missing", () => {
  const err = new Error("Totally different Turkish or diagnostic message: Token ve Sahip kimliği eksik") as Error & { code?: string };
  err.code = "config_missing";
  const res = classifyDiscordStartupError(err);
  assert.equal(res.kind, "OPERATOR_REQUIRED");
  assert.equal(res.exitCode, EXIT_CODES.OPERATOR_REQUIRED);
  assert.equal(res.code, "config_missing");
});

test("classifyDiscordStartupError: does NOT classify by English message substring without machine code", () => {
  const err = new Error("Missing env: DISCORD_BOT_TOKEN"); // bare Error without .code
  const res = classifyDiscordStartupError(err);
  assert.equal(res.kind, "RETRYABLE");
  assert.equal(res.exitCode, EXIT_CODES.TRANSIENT);
  assert.equal(res.code, "UNRECOGNIZED_DISCORD_STARTUP_ERROR");
});

test("classifyDiscordStartupError: defaults unknown post-login Discord error to RETRYABLE", () => {
  const err = new Error("Gateway connection reset");
  const res = classifyDiscordStartupError(err);
  assert.equal(res.kind, "RETRYABLE");
  assert.equal(res.exitCode, EXIT_CODES.TRANSIENT);
  assert.equal(res.code, "UNRECOGNIZED_DISCORD_STARTUP_ERROR");
});
