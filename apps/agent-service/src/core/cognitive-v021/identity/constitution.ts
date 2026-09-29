import type { DatabaseSync } from "node:sqlite";
import { listIdentity } from "../../identity/store.js";
import type { IdentitySlice } from "../types.js";
import type { IdentityEntry } from "../../types.js";
import type { StableSelfEntry } from "../thought/orientation-kernel.js";

export type IdentityOrientationSlice = IdentitySlice & {
  /** Category-separated canonical identity, retained alongside the legacy union. */
  values: string[];
  boundaries: string[];
  stableSelfEntries: StableSelfEntry[];
};

const FOUNDATIONAL_KINDS = ["value", "boundary"] as const;
/** Newest current entries of each organic kind that enter orientation. */
const ORGANIC_KIND_CAP = 20;
const ORGANIC_KINDS = ["taste", "trait"] as const;

/**
 * Every current value and boundary always enters orientation (R9): they are
 * the oldest entries, so a shared newest-first window would drop them first
 * as tastes and traits grow. Tastes, traits and any other stable kind are
 * each capped on their own.
 */
function currentStableIdentity(nuclear: DatabaseSync, ownerId: string): IdentityEntry[] {
  const entries = [
    ...listIdentity(nuclear, ownerId, { layer: "stable", kinds: FOUNDATIONAL_KINDS, limit: 100 }),
    ...ORGANIC_KINDS.flatMap((kind) =>
      listIdentity(nuclear, ownerId, { layer: "stable", kinds: [kind], limit: ORGANIC_KIND_CAP, seed: false })),
    ...listIdentity(nuclear, ownerId, {
      layer: "stable",
      excludeKinds: [...FOUNDATIONAL_KINDS, ...ORGANIC_KINDS],
      limit: ORGANIC_KIND_CAP,
      seed: false,
    }),
  ];
  return entries.sort((left, right) => {
    if (left.updatedAt < right.updatedAt) return -1;
    if (left.updatedAt > right.updatedAt) return 1;
    return left.id - right.id;
  });
}

/** Read the canonical nuclear identity source; no sidecar identity table exists. */
export function readIdentitySlice(
  nuclear: DatabaseSync,
  ownerId: string,
): IdentityOrientationSlice {
  const entries = currentStableIdentity(nuclear, ownerId);
  const values = entries
    .filter((entry) => entry.kind === "value")
    .map((entry) => entry.text);
  const boundaries = entries
    .filter((entry) => entry.kind === "boundary")
    .map((entry) => entry.text);
  return {
    constitutional: entries
      .filter((entry) => entry.kind === "value" || entry.kind === "boundary")
      .map((entry) => entry.text),
    stableSelf: entries
      .filter((entry) => entry.kind !== "value" && entry.kind !== "boundary")
      .map((entry) => entry.text),
    values,
    boundaries,
    stableSelfEntries: entries
      .filter((entry) => entry.kind !== "value" && entry.kind !== "boundary")
      .map((entry, sourceOrder) => ({
        id: String(entry.id),
        text: entry.text,
        sourceOrder,
      })),
  };
}

export const buildIdentitySlice = readIdentitySlice;
