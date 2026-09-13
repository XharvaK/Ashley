import type { DatabaseSync } from "node:sqlite";
import { createExternalEntityNote } from "./store.js";
import type { ExternalEntityNoteRecord } from "./types.js";

const FORBIDDEN_UNTRUSTED_PATTERNS = [
  /\balter\s+policy\b/i,
  /\bchange\s+policy\b/i,
  /\bgrant\s+permission\b/i,
  /\bauthorize\s+(dispatch|execution|action)\b/i,
  /\bpassword\b/i,
  /\bapi[_ -]?key\b/i,
  /\bsecret\b/i,
  /\bidentity\s+table\b/i,
  /\bcredential\s+ref\b/i,
];

export function scanUntrustedExternalText(
  values: string[],
): { ok: true } | { ok: false; reason: string } {
  for (const value of values) {
    for (const pattern of FORBIDDEN_UNTRUSTED_PATTERNS) {
      if (pattern.test(value)) {
        return { ok: false, reason: "eth_ext_policy_mutation_forbidden" };
      }
    }
  }
  return { ok: true };
}

export function createUntrustedEntityNote(
  db: DatabaseSync,
  input: {
    ownerId: string;
    sourceEntityUuid: string;
    channel: "private" | "public";
    claims: string[];
    verifiedFacts?: string[];
    ashleyOpinion?: string;
    evidenceRefs?: string[];
    sourceEntityId?: string;
  },
): ExternalEntityNoteRecord | { ok: false; reason: string } {
  const scan = scanUntrustedExternalText([
    ...input.claims,
    ...(input.verifiedFacts ?? []),
    ...(input.ashleyOpinion ? [input.ashleyOpinion] : []),
  ]);
  if (!scan.ok) {
    return scan;
  }
  return createExternalEntityNote(db, input);
}
