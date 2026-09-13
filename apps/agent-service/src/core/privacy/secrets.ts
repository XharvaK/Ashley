/**
 * Compatibility exports for the shared pure credential detector.
 *
 * The detector has no Ashley runtime, database, or environment imports.
 */
export {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "@composer-assistant/privacy-core";
export type {
  SecretHit,
  SecretMiss,
} from "@composer-assistant/privacy-core";
