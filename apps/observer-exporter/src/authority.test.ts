import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoAshleyControlCredentialKeys,
  assertNoAshleyControlCredentials,
  CONTROL_CREDENTIAL_ENV_KEYS,
} from "./security.js";

function implementationSource(): string {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  return readdirSync(directory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
}

describe("observer authority boundary", () => {
  it("rejects known Ashley credentials by presence without exposing their values", () => {
    expect(() =>
      assertNoAshleyControlCredentials({
        MISTRAL_API_KEY: "mistral-secret",
      }),
    ).toThrow(/control_credential_present/);
    expect(() =>
      assertNoAshleyControlCredentials({
        DISCORD_BOT_TOKEN: "discord-secret",
      }),
    ).toThrow(/control_credential_present/);
    expect(CONTROL_CREDENTIAL_ENV_KEYS).toContain("ASHLEY_BACKUP_TRANSFER_KEY");
    expect(() => assertNoAshleyControlCredentials({})).not.toThrow();
    expect(() => assertNoAshleyControlCredentialKeys(["GROQ_API_KEY"])).toThrow(
      /control_credential_present/,
    );
  });

  it("does not contain a runtime, control HTTP, provider, Discord, or migration import closure", () => {
    const source = implementationSource();
    expect(source).not.toMatch(/agent-service|openNuclearDb|openContinuityDb|ConversationLogger/);
    expect(source).not.toMatch(/from ["']node:(?:http|https)|fetch\s*\(|\/chat\/text|\/nuclear\/|\/curiosity\/|\/memory\//);
    expect(source).not.toMatch(/from ["'].*(?:runtime|server|db\.js|migration|backup-package)/);
    expect(source).not.toMatch(/from ["'].*(?:@mistralai|discord|github)/i);
  });
});

describe("publisher authority boundary", () => {
  it("rejects Ashley credentials independently of the exporter", async () => {
    const { assertPublisherEnvironmentSafe } = await import("./publisher.js");
    expect(() =>
      assertPublisherEnvironmentSafe({
        GROQ_API_KEY: "provider-secret",
      }),
    ).toThrow(/control_credential_present/);
  });

  it("has no Ashley database or data-plane reader imports", async () => {
    const { publisherImplementationSource } = await import("./publisher.js");
    const source = publisherImplementationSource();
    expect(source).not.toMatch(/node:sqlite|openNuclearDb|openContinuityDb|dataRoot|ConversationLogger/);
    expect(source).not.toMatch(/fetch\s*\(|node:(?:http|https)/);
  });
});
