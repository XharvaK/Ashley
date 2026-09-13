import type { DatabaseSync } from "node:sqlite";
import { sha256, stableJson } from "../../model-fabric/hash.js";
import type { DataClassification } from "../../privacy/classification.js";
import type { Observation } from "../types.js";

export type CanonicalObservation = {
  observationId: string;
  derived: boolean;
  replaySafe: boolean;
  modality: Observation["modality"];
  payload: unknown;
  provenance: string;
  rawOutranksDerivedOf: string | null;
  dataClassification: DataClassification;
  secretOmitted: boolean;
};

export type PersistedObservationBinding = {
  canonicalObservations: CanonicalObservation[];
  observationIds: string[];
  observationCount: number;
  observationBindingHash: string;
};

export type ObservationBindingResolution =
  | ({ kind: "known"; capture: "none" | "present"; } & PersistedObservationBinding & { observations: Observation[] })
  | { kind: "unknown"; reason: string };

const MODALITIES = new Set<Observation["modality"]>([
  "text", "image", "page", "tool", "subscription", "receipt",
]);
const CLASSIFICATIONS = new Set<DataClassification>([
  "ordinary", "sensitive", "never_public", "secret",
]);

export class ObservationBindingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ObservationBindingError";
    this.code = code;
  }
}

function row(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ObservationBindingError(code);
  return value;
}

function integer(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ObservationBindingError(code);
  }
  return value;
}

function boolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new ObservationBindingError(code);
  return value;
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") throw new ObservationBindingError("observation_payload_invalid");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ObservationBindingError("observation_payload_invalid");
  }
}

function canonicalFromObservation(observation: Observation): CanonicalObservation {
  const observationId = requiredText(observation.observationId, "observation_id_invalid");
  requiredText(observation.cycleId, "observation_cycle_invalid");
  integer(observation.generation, "observation_generation_invalid");
  const derived = boolean(observation.derived, "observation_derived_invalid");
  const replaySafe = boolean(observation.replaySafe, "observation_replay_safe_invalid");
  if (!MODALITIES.has(observation.modality)) throw new ObservationBindingError("observation_modality_invalid");
  const provenance = requiredText(observation.provenance, "observation_provenance_invalid");
  const rawOutranksDerivedOf = observation.rawOutranksDerivedOf == null
    ? null
    : requiredText(observation.rawOutranksDerivedOf, "observation_raw_outranks_invalid");
  if (!CLASSIFICATIONS.has(observation.dataClassification)) {
    throw new ObservationBindingError("observation_classification_invalid");
  }
  const secretOmitted = boolean(observation.secretOmitted, "observation_secret_omitted_invalid");
  let payload: unknown;
  try {
    const serialized = JSON.stringify(observation.payload ?? null);
    if (serialized === undefined) throw new Error("payload_undefined");
    payload = JSON.parse(serialized) as unknown;
  } catch {
    throw new ObservationBindingError("observation_payload_invalid");
  }
  return {
    observationId,
    derived,
    replaySafe,
    modality: observation.modality,
    payload,
    provenance,
    rawOutranksDerivedOf,
    dataClassification: observation.dataClassification,
    secretOmitted,
  };
}

function canonicalFromRow(value: unknown): CanonicalObservation {
  const found = row(value);
  if (!found) throw new ObservationBindingError("observation_row_invalid");
  const observationId = requiredText(found.observation_id, "observation_row_invalid");
  const modality = found.modality;
  if (typeof modality !== "string" || !MODALITIES.has(modality as Observation["modality"])) {
    throw new ObservationBindingError("observation_row_invalid");
  }
  const provenance = requiredText(found.provenance, "observation_row_invalid");
  const dataClassification = found.data_classification;
  if (typeof dataClassification !== "string" || !CLASSIFICATIONS.has(dataClassification as DataClassification)) {
    throw new ObservationBindingError("observation_row_invalid");
  }
  if ((found.derived !== 0 && found.derived !== 1)
    || (found.replay_safe !== 0 && found.replay_safe !== 1)
    || (found.secret_omitted !== 0 && found.secret_omitted !== 1)) {
    throw new ObservationBindingError("observation_row_invalid");
  }
  const derived = found.derived === 1;
  const replaySafe = found.replay_safe === 1;
  const secretOmitted = found.secret_omitted === 1;
  const rawOutranksDerivedOf = found.raw_outranks_derived_of == null
    ? null
    : requiredText(found.raw_outranks_derived_of, "observation_row_invalid");
  return {
    observationId,
    derived,
    replaySafe,
    modality: modality as Observation["modality"],
    payload: parsePayload(found.payload_json),
    provenance,
    rawOutranksDerivedOf,
    dataClassification: dataClassification as DataClassification,
    secretOmitted,
  };
}

function rowFor(db: DatabaseSync, observationId: string): Record<string, unknown> | null {
  return row(db.prepare(
    `SELECT observation_id, derived, replay_safe, modality, payload_json,
            provenance, raw_outranks_derived_of, data_classification, secret_omitted
       FROM observations
      WHERE observation_id = ?`,
  ).get(observationId));
}

function remapObservation(
  canonical: CanonicalObservation,
  cycle: { cycleId: string; generation: number },
): Observation {
  return {
    observationId: canonical.observationId,
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    derived: canonical.derived,
    replaySafe: canonical.replaySafe,
    modality: canonical.modality,
    payload: canonical.payload,
    provenance: canonical.provenance,
    ...(canonical.rawOutranksDerivedOf === null ? {} : { rawOutranksDerivedOf: canonical.rawOutranksDerivedOf }),
    dataClassification: canonical.dataClassification,
    secretOmitted: canonical.secretOmitted,
  };
}

export function canonicalObservation(observation: Observation): CanonicalObservation {
  return canonicalFromObservation(observation);
}

export function observationBindingHash(input: {
  observationIds: readonly string[];
  observations: readonly CanonicalObservation[];
}): string {
  return sha256({
    observationIds: [...input.observationIds],
    observations: input.observations.map((observation) => ({ ...observation })),
  });
}

export function persistOrVerifyObservation(
  db: DatabaseSync,
  observation: Observation,
  createdAtMs = Date.now(),
): CanonicalObservation {
  const canonical = canonicalFromObservation(observation);
  integer(createdAtMs, "observation_created_at_invalid");
  const existing = rowFor(db, canonical.observationId);
  if (!existing) {
    db.prepare(
      `INSERT INTO observations
         (observation_id, cycle_id, generation, derived, replay_safe, modality,
          payload_json, provenance, raw_outranks_derived_of, data_classification,
          secret_omitted, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      canonical.observationId,
      observation.cycleId,
      observation.generation,
      canonical.derived ? 1 : 0,
      canonical.replaySafe ? 1 : 0,
      canonical.modality,
      JSON.stringify(canonical.payload),
      canonical.provenance,
      canonical.rawOutranksDerivedOf,
      canonical.dataClassification,
      canonical.secretOmitted ? 1 : 0,
      createdAtMs,
    );
    return canonical;
  }
  let stored: CanonicalObservation;
  try {
    stored = canonicalFromRow(existing);
  } catch {
    throw new ObservationBindingError("observation_binding_conflict");
  }
  if (stableJson(stored) !== stableJson(canonical)) {
    throw new ObservationBindingError("observation_binding_conflict");
  }
  // cycle_id and generation are mechanical attachment, not semantic identity.
  db.prepare(
    "UPDATE observations SET cycle_id = ?, generation = ? WHERE observation_id = ?",
  ).run(observation.cycleId, observation.generation, canonical.observationId);
  return stored;
}

export function persistOrVerifyObservations(
  db: DatabaseSync,
  observations: readonly Observation[],
  createdAtMs = Date.now(),
): PersistedObservationBinding {
  const canonicalObservations: CanonicalObservation[] = [];
  const observationIds = new Set<string>();
  for (const observation of observations) {
    const canonical = persistOrVerifyObservation(db, observation, createdAtMs);
    if (observationIds.has(canonical.observationId)) {
      throw new ObservationBindingError("observation_binding_duplicate_id");
    }
    observationIds.add(canonical.observationId);
    canonicalObservations.push(canonical);
  }
  const ids = canonicalObservations.map((observation) => observation.observationId);
  return {
    canonicalObservations,
    observationIds: ids,
    observationCount: ids.length,
    observationBindingHash: observationBindingHash({ observationIds: ids, observations: canonicalObservations }),
  };
}

/**
 * Recover a pre-event periodic binding from the existing observations owner.
 * An empty result is UNKNOWN because this owner has no durable marker that
 * distinguishes an original empty capture from a crash before persistence.
 * Multiple rows are also UNKNOWN: created_at_ms and observation_id are not an
 * admission-order witness, and reused semantic IDs preserve their original
 * timestamp across mechanical cycle remapping.
 */
export function recoverObservationBindingForCycle(
  db: DatabaseSync,
  cycle: { cycleId: string; generation: number },
): ObservationBindingResolution {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = db.prepare(
      "SELECT observation_id, derived, replay_safe, modality, payload_json, " +
      "provenance, raw_outranks_derived_of, data_classification, secret_omitted, created_at_ms " +
      "FROM observations WHERE cycle_id = ? AND generation = ?",
    ).all(cycle.cycleId, cycle.generation) as Array<Record<string, unknown>>;
  } catch {
    return unknown("observation_binding_unreadable");
  }
  if (rows.length === 0) return unknown("observation_binding_missing");
  if (rows.length > 1) return unknown("observation_binding_order_unproven");

  const canonicalObservations: CanonicalObservation[] = [];
  try {
    for (const found of rows) canonicalObservations.push(canonicalFromRow(found));
  } catch {
    return unknown("observation_row_invalid");
  }
  const observationIds = canonicalObservations.map((observation) => observation.observationId);
  const bindingHash = observationBindingHash({
    observationIds,
    observations: canonicalObservations,
  });
  return {
    kind: "known",
    capture: "present",
    canonicalObservations,
    observationIds,
    observationCount: observationIds.length,
    observationBindingHash: bindingHash,
    observations: canonicalObservations.map((observation) => remapObservation(observation, cycle)),
  };
}

function unknown(reason: string): ObservationBindingResolution {
  return { kind: "unknown", reason };
}

export function resolveObservationBinding(
  db: DatabaseSync,
  payload: Record<string, unknown>,
  cycle: { cycleId: string; generation: number },
): ObservationBindingResolution {
  if (payload.observationsCapture !== "none" && payload.observationsCapture !== "present") {
    return unknown("legacy_observation_binding_missing");
  }
  if (!Array.isArray(payload.observationIds)
    || payload.observationIds.some((value) => typeof value !== "string" || value.trim() === "")) {
    return unknown("observation_binding_ids_invalid");
  }
  const observationIds = payload.observationIds as string[];
  if (new Set(observationIds).size !== observationIds.length) return unknown("observation_binding_ids_duplicate");
  if (!Number.isSafeInteger(payload.observationCount) || (payload.observationCount as number) < 0) {
    return unknown("observation_binding_count_invalid");
  }
  if (payload.observationCount !== observationIds.length) return unknown("observation_binding_count_mismatch");
  if (typeof payload.observationBindingHash !== "string" || payload.observationBindingHash.trim() === "") {
    return unknown("observation_binding_hash_invalid");
  }
  if (payload.observationsCapture === "none") {
    if (observationIds.length !== 0 || payload.observationCount !== 0) return unknown("observation_empty_binding_nonempty");
    const expected = observationBindingHash({ observationIds: [], observations: [] });
    return payload.observationBindingHash === expected
      ? {
        kind: "known",
        capture: "none",
        canonicalObservations: [],
        observationIds: [],
        observationCount: 0,
        observationBindingHash: expected,
        observations: [],
      }
      : unknown("observation_binding_hash_mismatch");
  }
  if (observationIds.length === 0) return unknown("observation_present_empty");
  const canonicalObservations: CanonicalObservation[] = [];
  for (const observationId of observationIds) {
    const found = rowFor(db, observationId);
    if (!found) return unknown("observation_row_missing");
    let canonical: CanonicalObservation;
    try {
      canonical = canonicalFromRow(found);
    } catch {
      return unknown("observation_row_invalid");
    }
    if (canonical.observationId !== observationId) return unknown("observation_id_mismatch");
    canonicalObservations.push(canonical);
  }
  const expected = observationBindingHash({ observationIds, observations: canonicalObservations });
  if (expected !== payload.observationBindingHash) return unknown("observation_binding_hash_mismatch");
  return {
    kind: "known",
    capture: "present",
    canonicalObservations,
    observationIds: [...observationIds],
    observationCount: observationIds.length,
    observationBindingHash: expected,
    observations: canonicalObservations.map((observation) => remapObservation(observation, cycle)),
  };
}
