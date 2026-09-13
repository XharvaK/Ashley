import type {
  AuthorizedReadingClaim,
  OwnTimeReportReason,
  OwnTimeReportStatus,
} from "../types.js";

/**
 * Typed pre-Thought own-time constraint. In-memory only — no schema migration.
 * Not a MotivationKind disguise.
 */
export type OwnTimeReportConstraint = {
  canInfluence: boolean;
  status: OwnTimeReportStatus;
  reason: OwnTimeReportReason;
  sessionId: number | null;
  selectedTakeIds: number[];
  readingClaims: AuthorizedReadingClaim[];
};
