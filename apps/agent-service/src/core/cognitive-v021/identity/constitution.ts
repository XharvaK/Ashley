import type { DatabaseSync } from "node:sqlite";
import { listIdentity } from "../../identity/store.js";
import type { IdentitySlice } from "../types.js";
import type { StableSelfEntry } from "../thought/orientation-kernel.js";

export type IdentityOrientationSlice = IdentitySlice & {
  /** Category-separated canonical identity, retained alongside the legacy union. */
  values: string[];
  boundaries: string[];
  stableSelfEntries: StableSelfEntry[];
};

/** Read the canonical nuclear identity source; no sidecar identity table exists. */
export function readIdentitySlice(
  nuclear: DatabaseSync,
  ownerId: string,
): IdentityOrientationSlice {
  const entries = listIdentity(nuclear, ownerId, { layer: "stable" });
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
