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
      "That took too long — try again?",
    );
    assert.equal(
      agentErrorMessage("internal_error"),
      "I glitched on that one — try again?",
    );
    assert.equal(
      agentErrorMessage("mystery"),
      "Something went wrong on my end. Try again?",
    );
  });

  it("uses retryAfterSec for mistral_unavailable when provided", () => {
    const msg = agentErrorMessage("mistral_unavailable", 17);
    assert.match(msg, /17s/);
  });

  it("keeps the plain message when no retry time is known", () => {
    assert.equal(
      agentErrorMessage("mistral_unavailable"),
      "My brain's unreachable right now. Try again in a bit.",
    );
  });

  it("source file has no hardcoded Turkish-only user strings", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "agent-errors.ts"), "utf8");
    assert.doesNotMatch(src, /Not ettim|bir saniye|agent-service/);
  });
});
