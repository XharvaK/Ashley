import type { MemoryKind } from "../types.js";

/**
 * D4's sole automatic admission class. Any other MemoryKind needs an
 * explicitly governed/owner-directed path and must not be hot-scanned here.
 */
export const FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST = [
  "learned_self_evidence",
] as const satisfies readonly MemoryKind[];

export type FrozenAutomaticAdmissionKind = (typeof FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST)[number];
