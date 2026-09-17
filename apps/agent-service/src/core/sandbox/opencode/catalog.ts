/**
 * Host-owned OpenCode free-model catalog from C1 qualification.
 * Not a Thought/Model Fabric portfolio. Operator-updatable by replacing this
 * map or injecting a catalog into the quota router.
 *
 * Wire IDs observed 2026-09-17 from OpenCode 1.18.30 `opencode models`
 * in an isolated HOME with zero credentials.
 */

export const OPENCODE_PINNED_VERSION = "1.18.30";

export const MODE_B_INVESTIGATE = "project.investigate";
export const MODE_B_DEVELOP = "candidate.develop";

export const MODE_B_HOST_MAX_STEPS = 8;

export type QuotaClass = "NVIDIA_FREE" | "OTHER_FREE";
export type WorkerTaskClass = "delegated_read" | "iterative_engineering";

export type OpenCodeModelCatalog = {
  pinnedOpenCodeVersion: string;
  classes: Record<QuotaClass, readonly string[]>;
  preferred: Record<WorkerTaskClass, readonly string[]>;
  /**
   * Current implementation policy for candidate.develop, not constitutional law.
   * false = OTHER_FREE only (this wave). NVIDIA is never used when OTHER_FREE
   * is quota_exhausted (Owner L3 rule; kinds are not L2/L3-split).
   */
  candidateDevelopAllowsNvidia: boolean;
};

export const C1_OPENCODE_FREE_CATALOG: OpenCodeModelCatalog = {
  pinnedOpenCodeVersion: OPENCODE_PINNED_VERSION,
  classes: {
    NVIDIA_FREE: [
      "opencode/nemotron-3.5-lightning-free",
      "opencode/nemotron-3-ultra-free",
    ],
    OTHER_FREE: [
      "opencode/muse-spark-1.3-contributor-free",
      "opencode/muse-spark-1.2-contributor-free",
      "opencode/mimo-v2.5-free",
      "opencode/ling-3.0-flash-fin-free",
      "opencode/big-pickle",
    ],
  },
  preferred: {
    delegated_read: [
      "opencode/nemotron-3.5-lightning-free",
      "opencode/nemotron-3-ultra-free",
    ],
    iterative_engineering: [
      "opencode/muse-spark-1.3-contributor-free",
    ],
  },
  candidateDevelopAllowsNvidia: false,
};

export function classOfModel(
  modelId: string,
  catalog: OpenCodeModelCatalog = C1_OPENCODE_FREE_CATALOG,
): QuotaClass | null {
  if (catalog.classes.NVIDIA_FREE.includes(modelId)) return "NVIDIA_FREE";
  if (catalog.classes.OTHER_FREE.includes(modelId)) return "OTHER_FREE";
  return null;
}

export function modelsForClass(
  quotaClass: QuotaClass,
  catalog: OpenCodeModelCatalog = C1_OPENCODE_FREE_CATALOG,
): readonly string[] {
  return catalog.classes[quotaClass];
}
