import type { AttachmentIntakeRef } from "../../perception/types.js";

/**
 * RA-P0 implementation-start reconciliation (2026-09-15; types are not imported by live behavior).
 * - social_conversations: sidecar ownership remains the default from the frozen plan; no named transaction proof overrides it.
 * - Artifact bytes: use <dataDir>/conversations/artifact-bytes/, beside the nuclear DB; data-plane.ts permits sibling files.
 *   Mint exposes the data root, conversations, nuclear DB, continuity DB, sidecar, and backups; artifact-bytes is absent.
 *   Current backup tools snapshot only nuclear.db and continuity.db; artifact-byte backup scope remains a later-packet finding.
 * - Assertion FTS: cognitive-v021/retrieval/derived-store.ts owns memory_fts/conversation_fts creation, rebuild, and sync.
 * - Artifact retention: no current perception due-sweep exists; later GC belongs to core/perception beside retention/forget.
 * - commitment_state: free TEXT plus a code enum; existing relationship status columns use CHECK and must remain unchanged.
 * - Unbatched capture recovery: 10_000 ms = TurnBuffer hard-cap 5_000 ms × 2; TurnBuffer owns those current constants.
 * - Capture receipt: service capture owns extcap:<evidenceRowId>; bot messageCreate owns transient grouping grammar.
 *   Keys are dm:<bot>:<author> or room:<guild>:<channel>; durable conversation resolution remains service/sidecar-owned later.
 * - Preflight booleans: perception/preflight.ts resolves visionAllowed, attachmentTextAllowed, and conversational-read allow.
 * - C5 POST callers: server.ts declares the route; route-surface.test.ts is the only current POST caller found.
 * - Fulfillment pump: client.ts calls startFulfillmentPump once from ClientReady; fulfillment-pump.ts has a singleton guard.
 * - Discord thread API: no ThreadChannel, threads.create, createThread, or isThread usage exists in the current bot source.
 * - Periodic source defaults: env.example sets PERIODIC_COGNITION_ENABLED=false; missing/malformed env is disabled;
 *   cadence and due window are 21_600_000 ms in periodic-schedule.ts.
 * - Read-only Mint process-environment observation: PERIODIC_COGNITION_ENABLED classified ENABLED; raw environment was not printed.
 * - PROACTIVE_MAX_PER_DAY, PROACTIVE_CHECK_INTERVAL_MIN, PERIODIC_COGNITION_ENABLED, MISTRAL_*, and
 *   DISCORD_ALLOWED_CHANNELS values remain in the environment owner.
 */

export type SocialPrincipalId = string;              // Discord snowflake, never a handle
export type SpeakerKind = "owner" | "external_human" | "external_bot" | "ashley";
export type SocialAudience =
  | { kind: "owner_private" }
  | { kind: "owner_dm"; threadId: string }
  | { kind: "dm"; principalId: SocialPrincipalId }
  | { kind: "room"; roomId: string };                // stable room identity, NOT a member digest

/** Host facts offered to Thought; the Host does not choose a destination. */
export type AvailableSocialDestination = {
  audience: SocialAudience;
  source: "owner_identity" | "social_permit" | "trusted_room";
  permitScope: "person_wide" | "dm_only" | "room_only" | null;
};
export type SocialLocation =
  | { kind: "owner_dm"; threadId: string }
  | { kind: "external_dm"; principalId: SocialPrincipalId; channelId: string }
  | { kind: "room"; guildId: string; channelId: string; threadId?: string };
export type AttributedEnvelope = {
  speakerPrincipalId: string; speakerKind: SpeakerKind; speakerHandleHint?: string;
  location: SocialLocation; audienceAtCapture: SocialAudience; sentAtMs: number;
  discordMessageId: string; replyToMessageId?: string; mentionIds: string[];
  attachmentRefs: AttachmentIntakeRef[]; provenance: { source: "discord"; receivedAtMs: number };
};
export type AttemptInputBasis = {
  schemaVersion: 1; orderedRefs: string[];   // evidence row_ids in conversation order
  versions: Record<string, number>; speakerAttributionHash: string;
  replyEdges: Array<[string, string]>; attachmentCoverage: Record<string, "complete" | "truncated_at_limit" | "failed" | "unsupported">;
  projectionVersion: string;
};
export type HardDependencyBundle = {
  permit: DepRef; prohibitionAbsence: DepRef; roomState: DepRef;
  recipientRestrictionAbsence: DepRef; ashleyBoundaryAbsence: DepRef;
  licenses: DepRef[]; capability: DepRef; destinationAccess: DepRef;
  barrier: { epoch: number; revision: number };   // §4-M1R: single coherent revision
};
// DepRef.rowRevision = per-row version (permit version, 1 for singleton rows, null if absent).
// For disclosure licenses rowRevision is the REAL `disclosure_licenses.version`
// (incremented by every consume/revoke, §4-M1 item 6) — never a placeholder.
// A reservation that consumes a one-shot use carries the POST-CONSUMPTION binding
// (barrier N+1 + license DepRef at post-consume version + reservation-owned use entry
// in `license_refs_json`, §7.3); dispatch rechecks THAT binding, not general availability.
// DepRef.barrier = the M1R (epoch, revision) read atomically WITH the row in the same
// nuclear read txn. Absence proofs bind (barrier.epoch, barrier.revision, absentAsOfMs):
// final admission re-reads the barrier and requires equality — any intervening hard-policy
// mutation (even revoke→regrant / set→clear that restores row equivalence) advanced the
// revision and invalidates the candidate. There is NO free-floating monotonicSeq.
export type DepRef = { table: string; key: string; rowRevision: number | null;
  barrier: { epoch: number; revision: number }; absentAsOfMs: number };
export type InteractionIntent = "continue" | "initiate";

/** Thought-owned future action proposal. The Host assigns the durable id. */
export type CommitmentProposal = {
  ordinal: number;
  action: string;
  beneficiary: SocialPrincipalId | "owner";
  destination: SocialAudience;
  temporal:
    | { kind: "exact"; atMs: number }
    | { kind: "bounded"; windowStartMs: number; windowEndMs: number }
    | { kind: "open" };
  /** Exact Thought-authored realization clause carried into Expression. */
  realizationClause: string;
  thoughtCycle: { cycleId: string; attemptId: string };
};

export type HostCommitmentProposal = CommitmentProposal & {
  proposalId: string;
  sourceRef: string;
};

export type CommitmentRealizationBinding = {
  commitmentId: string;
  realizationClauseHash: string;
  admissionRevision: number;
};
