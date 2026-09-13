import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "@composer-assistant/privacy-core";
import {
  isSecretClassification,
  redactObserverText,
  REDACTION_PROFILE,
} from "./privacy.js";

describe("observer privacy boundary", () => {
  it("uses the shared detector for every accepted credential family", () => {
    const samples = [
      "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----",
      "AKIA1234567890ABCDEF",
      `ghp_${"a".repeat(36)}`,
      `gho_${"b".repeat(36)}`,
      "xoxb-1234567890-abcdef",
      "Bearer eyJheader.eyJpayload.signature",
      `sk-${"c".repeat(24)}`,
      `api_key = ${"d".repeat(24)}`,
      "recovery codes: ABCD-1234 EFGH-5678",
    ];
    for (const sample of samples) {
      expect(detectCredentialShape(sample).hit, sample).toBe(true);
      expect(redactObserverText(sample), sample).toBe(
        CREDENTIAL_OMITTED_PLACEHOLDER,
      );
    }
  });

  it("retains ordinary private conversation and rejects only secret classification", () => {
    expect(redactObserverText("private conversation about a project")).toBe(
      "private conversation about a project",
    );
    expect(isSecretClassification("secret")).toBe(true);
    expect(isSecretClassification("private")).toBe(false);
    expect(isSecretClassification("never_public")).toBe(false);
    expect(REDACTION_PROFILE).toBe("ashley-credential-omission-v1");
  });

  it("keeps negative controls unredacted", () => {
    const negatives = [
      "we discussed API key rotation",
      "password rotation policy",
      "AKIA is a prefix example, not a complete key",
      "private means owner-custody, not secret",
    ];
    for (const sample of negatives) {
      expect(detectCredentialShape(sample).hit, sample).toBe(false);
      expect(redactObserverText(sample), sample).toBe(sample);
    }
  });
});
