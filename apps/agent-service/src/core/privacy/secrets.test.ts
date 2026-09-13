import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "./secrets.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER as SHARED_PLACEHOLDER,
  detectCredentialShape as sharedDetectCredentialShape,
} from "@composer-assistant/privacy-core";

describe("shared credential detector compatibility", () => {
  it("keeps agent results identical to the extracted pure package", () => {
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
      "we discussed API key rotation",
      "password rotation policy",
    ];
    expect(CREDENTIAL_OMITTED_PLACEHOLDER).toBe(SHARED_PLACEHOLDER);
    for (const sample of samples) {
      expect(detectCredentialShape(sample), sample).toEqual(
        sharedDetectCredentialShape(sample),
      );
    }
  });
});
