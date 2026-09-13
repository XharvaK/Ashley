import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "@composer-assistant/privacy-core";

export const REDACTION_PROFILE = "ashley-credential-omission-v1" as const;

export function isSecretClassification(value: unknown): boolean {
  return value === "secret";
}

export function redactObserverText(text: string): string {
  return detectCredentialShape(text).hit
    ? CREDENTIAL_OMITTED_PLACEHOLDER
    : text;
}
