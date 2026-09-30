/**
 * Frozen S1 composition bounds. These are logical serializer contracts, not
 * provider quotas and not permission to invent additional model-visible data.
 */
import { MAX_LOGICAL_SERIALIZED_INPUT_BYTES } from "./budget.js";
import type { AllocationFailureDiagnostic } from "./receipt.js";

export const PROTECTED_PRIOR_DIALOGUE_COUNT = 4;
export const ORDINARY_PRIOR_MESSAGE_BYTE_CLASS = 2_048;
export const PROTECTED_HISTORY_ALLOCATION_BYTES = 9_216;

export const REQUIRED_WC_PROJECTED_POOL_BYTES = 2_560;
export const REQUIRED_WC_ITEM_BYTES = 640;

/** Local bounds for required section projections. These do not raise the
 * logical semantic envelope; they keep individual model-visible sections
 * mechanically bounded before the envelope allocator runs. */
export const REQUIRED_LEARNED_SELF_BYTES = REQUIRED_WC_ITEM_BYTES;
/** Each Growth V1 inner-life section (clock, core profile, thread story,
 * episodes, journal, growth, inner pass). Their producers bound them far
 * below this; the allocator fails closed rather than trust that silently. */
export const REQUIRED_INNER_LIFE_SECTION_BYTES = 64 * 1024;
export const REQUIRED_OBSERVATION_COUNT = 8;
/** Bounded concern.inspect representation only; not an allocator admission limit. */
export const REQUIRED_OBSERVATION_ITEM_BYTES = 640;
export const REQUIRED_OCCUPANCY_COUNT = 12;
export const REQUIRED_OBSERVATION_MAX_NESTING_DEPTH = 64;
export const REQUIRED_OBSERVATION_MAX_NODES = MAX_LOGICAL_SERIALIZED_INPUT_BYTES;

export type RequiredObservationInspection =
  | Readonly<{ ok: true; serializedBytes: number }>
  | Readonly<{ ok: false; failure: AllocationFailureDiagnostic }>;

function observationInspectionFailure(
  failure: AllocationFailureDiagnostic,
): RequiredObservationInspection {
  return { ok: false, failure };
}

/**
 * Validate the observation's JSON shape without recursively serializing it.
 * The node ceiling is derived from the whole-request byte envelope, so it
 * cannot reject a request that could fit that envelope. Depth protects the
 * serializer stack; the byte result is measured exactly after shape checks.
 */
export function inspectRequiredObservation(value: unknown): RequiredObservationInspection {
  type Pending = { value: unknown; depth: number; exit?: object };
  const stack: Pending[] = [{ value, depth: 0 }];
  const active = new WeakSet<object>();
  let visitedNodes = 0;
  let rawStringAndKeyBytes = 0;

  const malformed = (): RequiredObservationInspection => observationInspectionFailure({
    kind: "structural_safety",
    constraint: "malformed_json_structure",
    measuredValue: visitedNodes,
    unit: "nodes",
    limit: REQUIRED_OBSERVATION_MAX_NODES,
    stage: "observation_validation",
    measurementBasis: "exact",
  });

  try {
    while (stack.length > 0) {
      const pending = stack.pop()!;
      if (pending.exit) {
        active.delete(pending.exit);
        continue;
      }
      if (pending.depth > REQUIRED_OBSERVATION_MAX_NESTING_DEPTH) {
        return observationInspectionFailure({
          kind: "structural_safety",
          constraint: "max_nesting_depth",
          measuredValue: pending.depth,
          unit: "levels",
          limit: REQUIRED_OBSERVATION_MAX_NESTING_DEPTH,
          stage: "observation_validation",
          measurementBasis: "exact",
        });
      }
      visitedNodes += 1;
      if (visitedNodes > REQUIRED_OBSERVATION_MAX_NODES) {
        return observationInspectionFailure({
          kind: "structural_safety",
          constraint: "max_observation_nodes",
          measuredValue: visitedNodes,
          unit: "nodes",
          limit: REQUIRED_OBSERVATION_MAX_NODES,
          stage: "observation_validation",
          measurementBasis: "exact",
        });
      }

      const current = pending.value;
      if (current === null || typeof current === "boolean") continue;
      if (typeof current === "string") {
        rawStringAndKeyBytes += Buffer.byteLength(current, "utf8");
        if (rawStringAndKeyBytes > MAX_LOGICAL_SERIALIZED_INPUT_BYTES * 2) {
          return observationInspectionFailure({
            kind: "serialized_request_bytes",
            constraint: "logical_input_byte_envelope",
            measuredValue: rawStringAndKeyBytes,
            unit: "bytes",
            limit: MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
            stage: "observation_validation",
            measurementBasis: "lower_bound",
          });
        }
        continue;
      }
      if (typeof current === "number") {
        if (!Number.isFinite(current)) return malformed();
        continue;
      }
      if (typeof current !== "object") return malformed();
      if (active.has(current)) return malformed();
      active.add(current);
      stack.push({ value: null, depth: pending.depth, exit: current });

      if (Array.isArray(current)) {
        if (current.length > REQUIRED_OBSERVATION_MAX_NODES) {
          return observationInspectionFailure({
            kind: "structural_safety",
            constraint: "max_collection_items",
            measuredValue: current.length,
            unit: "items",
            limit: REQUIRED_OBSERVATION_MAX_NODES,
            stage: "observation_validation",
            measurementBasis: "exact",
          });
        }
        for (let index = current.length - 1; index >= 0; index -= 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return malformed();
          stack.push({ value: descriptor.value, depth: pending.depth + 1 });
        }
        const enumerableKeys = Object.keys(current);
        if (
          enumerableKeys.length !== current.length
          || Reflect.ownKeys(current).length !== current.length + 1
        ) return malformed();
        continue;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return malformed();
      const keys = Object.keys(current);
      if (keys.length > REQUIRED_OBSERVATION_MAX_NODES) {
        return observationInspectionFailure({
          kind: "structural_safety",
          constraint: "max_collection_items",
          measuredValue: keys.length,
          unit: "items",
          limit: REQUIRED_OBSERVATION_MAX_NODES,
          stage: "observation_validation",
          measurementBasis: "exact",
        });
      }
      if (Reflect.ownKeys(current).length !== keys.length) return malformed();
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!;
        rawStringAndKeyBytes += Buffer.byteLength(key, "utf8");
        if (rawStringAndKeyBytes > MAX_LOGICAL_SERIALIZED_INPUT_BYTES * 2) {
          return observationInspectionFailure({
            kind: "serialized_request_bytes",
            constraint: "logical_input_byte_envelope",
            measuredValue: rawStringAndKeyBytes,
            unit: "bytes",
            limit: MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
            stage: "observation_validation",
            measurementBasis: "lower_bound",
          });
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return malformed();
        stack.push({ value: descriptor.value, depth: pending.depth + 1 });
      }
    }
  } catch {
    return malformed();
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return malformed();
    return { ok: true, serializedBytes: Buffer.byteLength(serialized, "utf8") };
  } catch {
    return malformed();
  }
}

export const ATTACHMENT_AVAILABILITY = [
  "CONTENT_AVAILABLE",
  "PARTIALLY_AVAILABLE",
  "OMITTED_FROM_THIS_REQUEST",
  "UNAVAILABLE",
  "NO_ASSOCIATED_CONTENT",
] as const;

export type AttachmentAvailability = (typeof ATTACHMENT_AVAILABILITY)[number];

export type DialogueProtection =
  | "current_trigger"
  | "protected_prior_dialogue"
  | "ordinary";

export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}
