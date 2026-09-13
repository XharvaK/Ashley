import type { ReflectionWriteClassification } from "../types.js";

/**
 * Frozen P5 authority classification for every existing Reflection/initiative
 * path. The map is descriptive and intentionally contains no semantic logic.
 */
export const REFLECTION_WRITE_PATH_CLASSIFICATION = Object.freeze({
  recordInitiativeReaction: "MECHANICAL_CALIBRATION",
  processPendingReflectionEvents: "MECHANICAL_CALIBRATION",
  saveInitiativeLearning: "MECHANICAL_CALIBRATION",
  applyInitiativeLearning: "MECHANICAL_CALIBRATION",
  modelReflectionAdjudicator: "NON_AUTHORITATIVE_ADVISORY_OUTPUT",
  transitionOpenCognitiveItemFromReflection:
    "NON_AUTHORITATIVE_ADVISORY_OUTPUT",
  recordOpenCognitiveDecision: "THOUGHT_AUTHORED_SEMANTIC_STATE",
} as const satisfies Record<string, ReflectionWriteClassification>);

export const REFLECTION_AUTHORITY_CLASSES = Object.freeze({
  mechanicalCalibration: "MECHANICAL_CALIBRATION",
  advisoryOutput: "NON_AUTHORITATIVE_ADVISORY_OUTPUT",
  thoughtAuthoredSemanticState: "THOUGHT_AUTHORED_SEMANTIC_STATE",
  disallowedUnderFrozenAuthority: "DISALLOWED_UNDER_FROZEN_AUTHORITY",
} as const satisfies Record<string, ReflectionWriteClassification>);
