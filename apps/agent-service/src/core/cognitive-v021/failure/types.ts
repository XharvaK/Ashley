import type { DatabaseSync } from "node:sqlite";

export type SidecarDb = DatabaseSync;

export type C3TerminalDisposition = "terminal";
export type C3PublicationState = "published" | "unpublished";
export type C3ExternalEffectTruth =
  | "not_attempted"
  | "no_effect_proven"
  | "effect_verified"
  | "effect_indeterminate";

export type C3RawEvidenceRef = {
  kind: string;
  id: string;
};

export type C3TerminalExperienceRecord = {
  experienceId: string;
  obligationFrontierId: string | null;
  cycleId: string;
  generation: number;
  attemptId: string | null;
  attemptLineageJson: string | null;
  terminalPhase: string;
  failureClass: string;
  terminalDisposition: C3TerminalDisposition;
  publicationState: C3PublicationState;
  externalEffectTruth: C3ExternalEffectTruth;
  receiptRef: string | null;
  unresolvedState: number;
  rawEvidenceRefsJson: string;
  noticeId: string | null;
  occurredAtMs: number;
  sourceDomainOwner: string;
  sourceCurrentnessRef: string | null;
  redacted: number;
};

export type C3TerminalExperienceListOptions = {
  cycleId?: string;
  unresolvedOnly?: boolean;
  unresolvedState?: number;
  limit?: number;
};

export type C3RepairOptions = {
  nowMs?: number;
  limit?: number;
};

export type C3RepairResult = {
  scanned: number;
  recorded: number;
  skipped: number;
  deliveryWatermarkInitialized: boolean;
  recoveredExperienceIds: string[];
};
