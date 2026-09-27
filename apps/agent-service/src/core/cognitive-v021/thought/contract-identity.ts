/** Stable identity for the code-owned Thought output contract. */
export const THOUGHT_OUTPUT_CONTRACT_ID = "ashley.thought.semantic.v2" as const;
export const THOUGHT_OUTPUT_SCHEMA_ID = "ashley.thought.semantic.v2.schema" as const;

/**
 * Stable identity for the code-owned Reflection/Initiative adjudication output
 * contract. This is a DISTINCT contract from the Thought contract and must
 * never be substituted for it. Reflection adjudicates an Open Cognitive Item
 * transition and returns a non-authoritative advisory proposal; it is not a
 * Thought turn and does not carry the Thought semantic envelope.
 */
export const REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID = "ashley.reflection.initiative.v1" as const;
export const REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID = "ashley.reflection.initiative.v1.schema" as const;

