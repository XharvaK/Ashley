import type { DatabaseSync } from "node:sqlite";
import { basename } from "node:path";
import { readCognitiveSidecarMeta } from "../sidecar/db.js";
import type { KernelMode } from "../types.js";

export type CognitiveHealthSnapshot = {
  cognitiveKernel: KernelMode;
  cognitiveSidecar: {
    open: boolean;
    schemaVersion: number | null;
    path: string | null;
  };
  cognitiveSidecarSchemaVersion: number | null;
  cognitiveSidecarPath: string | null;
};

/** Public health projection. It never exposes the sidecar directory or secrets. */
export function getCognitiveHealthSnapshot(input: {
  mode: KernelMode;
  sidecar?: DatabaseSync | null;
  sidecarPath?: string | null;
}): CognitiveHealthSnapshot {
  let schemaVersion: number | null = null;
  if (input.sidecar) {
    try {
      schemaVersion = readCognitiveSidecarMeta(input.sidecar).schema_version;
    } catch {
      schemaVersion = null;
    }
  }
  const path = input.sidecarPath ? basename(input.sidecarPath) : null;
  return {
    cognitiveKernel: input.mode,
    cognitiveSidecar: { open: input.sidecar != null, schemaVersion, path },
    cognitiveSidecarSchemaVersion: schemaVersion,
    cognitiveSidecarPath: path,
  };
}

export const cognitiveHealthSnapshot = getCognitiveHealthSnapshot;
