import { describe, expect, it } from "vitest";
import { installConsoleRedaction, redactSecretShapes, registerSecretValues } from "./redact-logs.js";

// Built at runtime so no token-shaped literal sits in the repository (secret scanners flag it).
const DISCORD_SHAPED = ["M" + "TIzNDU2Nzg5MDEyMzQ1Njc4", "AbCdEf", "z".repeat(33)].join(".");

describe("secret redaction in logs", () => {
  it("covers the Discord token shape, the named secret assignments and the old shapes", () => {
    const text = [
      `login ${DISCORD_SHAPED}`,
      "COMMAND_CODE_API_KEY=cc-live-0123456789abcdef",
      "X-Ashley-Bot-Service: svc-header-value-123",
      "DOMUS_HELPER_TOKEN: helper-value-456",
      "key sk-abcdefghijklmnop",
    ].join("\n");
    const safe = redactSecretShapes(text);
    expect(safe).not.toContain(DISCORD_SHAPED);
    expect(safe).not.toContain("cc-live-0123456789abcdef");
    expect(safe).not.toContain("svc-header-value-123");
    expect(safe).not.toContain("helper-value-456");
    expect(safe).not.toContain("sk-abcdefghijklmnop");
    expect(safe).toContain("COMMAND_CODE_API_KEY=[redacted-credential]");
  });

  it("redacts registered secret values wherever they appear, however they are shaped", () => {
    registerSecretValues(["plain-helper-secret-value"]);
    const safe = redactSecretShapes("helper said plain-helper-secret-value and failed");
    expect(safe).toBe("helper said [redacted-credential] and failed");
  });

  it("leaves ordinary log text alone", () => {
    expect(redactSecretShapes("[agent-service] listening on port 3710")).toBe("[agent-service] listening on port 3710");
  });

  it("applies to everything the console prints, including an error's message and stack", () => {
    registerSecretValues(["console-secret-value-1"]);
    const printed: unknown[][] = [];
    const fake = {
      log: (...args: unknown[]) => printed.push(args),
      warn: (...args: unknown[]) => printed.push(args),
      error: (...args: unknown[]) => printed.push(args),
    } as unknown as Console;
    installConsoleRedaction(fake);
    const error = new Error("request failed with console-secret-value-1");
    fake.error("[cognitive] failed", error);
    fake.log(DISCORD_SHAPED);
    const flat = JSON.stringify(printed);
    expect(flat).not.toContain("console-secret-value-1");
    expect(flat).not.toContain(DISCORD_SHAPED);
    expect(flat).toContain("[cognitive] failed");
  });
});
