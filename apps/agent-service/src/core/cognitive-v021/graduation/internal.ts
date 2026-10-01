// The Host validates evidence shape and lineage without supplying semantic judgment.
import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import { detectCredentialShape } from "../../privacy/secrets.js";
import { stableJson } from "../../model-fabric/hash.js";

export function assertCompatible(db: DatabaseSync): void {
  const version = Number(db.prepare("SELECT highest_contract_version FROM graduation_contract_state WHERE id=1").get()?.highest_contract_version);
  if (version !== 1) throw new Error(`cognitive_graduation_contract_unsupported:${version}>1`);
}
export function boundedText(value: unknown, name: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`cognitive_graduation_${name}_required`);
  if (text.length > max) throw new Error(`cognitive_graduation_${name}_too_long`);
  if (detectCredentialShape(text).hit) throw new Error("cognitive_graduation_credential_shape_refused");
  return text;
}
export function combinedClassification(...values: Array<DataClassification | null | undefined>): DataClassification {
  const result = maxClassification(...values);
  if (result === "secret") throw new Error("cognitive_graduation_secret_evidence_refused");
  return result;
}
export function stableEqual(left: unknown, right: unknown): boolean { return stableJson(left) === stableJson(right); }
export function provenance(db: DatabaseSync): "live" | "shadow" {
  return db.prepare("SELECT mode FROM graduation_contract_state WHERE id=1").get()?.mode === "observe" ? "shadow" : "live";
}
