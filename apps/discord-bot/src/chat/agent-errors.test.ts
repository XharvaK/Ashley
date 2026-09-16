import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentErrorMessage } from "./agent-errors.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("agentErrorMessage", () => {
  it("never names agent-service or Mistral", () => {
    const codes = [
      "agent_not_ready",
      "mistral_unavailable",
      "rate_limited",
      "message_too_long",
      "forbidden",
      "chat_in_progress",
      "agent_timeout",
      "internal_error",
      "mystery",
    ];
    for (const code of codes) {
      const msg = agentErrorMessage(code, 12);
      assert.doesNotMatch(msg, /agent-service|Mistral|mistral/i);
    }
  });

  it("maps timeout and internal_error distinctly from the default", () => {
    assert.equal(
      agentErrorMessage("agent_timeout"),
      "System status: request timed out. Try again.",
    );
    assert.equal(
      agentErrorMessage("internal_error"),
      "System status: request failed. Try again.",
    );
    assert.equal(
      agentErrorMessage("mystery"),
      "System status: request could not be completed. Try again.",
    );
  });

  it("uses retryAfterSec for mistral_unavailable when provided", () => {
    const msg = agentErrorMessage("mistral_unavailable", 17);
    assert.equal(
      msg,
      "System status: response service is unavailable. Try again in about 17s.",
    );
  });

  it("keeps the plain message when no retry time is known", () => {
    assert.equal(
      agentErrorMessage("mistral_unavailable"),
      "System status: response service is unavailable. Try again shortly.",
    );
  });

  it("attributes every Host status mechanically", () => {
    const codes = [
      "agent_not_ready",
      "mistral_unavailable",
      "rate_limited",
      "message_too_long",
      "forbidden",
      "chat_in_progress",
      "agent_timeout",
      "internal_error",
      "mystery",
    ];
    for (const code of codes) {
      const message = agentErrorMessage(code, 12);
      assert.match(message, /^System status:/);
      assert.doesNotMatch(message, /I've accepted|I want|I glitched|\bI'm\b|\bmy\b/i);
    }
  });

  it("source file has no hardcoded Turkish-only user strings", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "agent-errors.ts"), "utf8");
    assert.doesNotMatch(src, /Not ettim|bir saniye|agent-service/);
  });
});
