export type DocReminderStatus =
  | "pending"
  | "due"
  | "deferred"
  | "fulfilled"
  | "cancelled"
  | "missed"
  | "motivated";

export type AshleySelfCommitmentStatus =
  | "active"
  | "fulfilled"
  | "released"
  | "forgotten"
  | "motivated";

export type MutualCommitmentStatus =
  | "proposed"
  | "active"
  | "fulfilled"
  | "released";

export type ScheduledProactiveStatus =
  | "scheduled"
  | "motivated"
  | "sent"
  | "cancelled"
  | "missed"
  | "deferred";

export type RelationalTensionStatus = "open" | "resolved";

export type TensionRepairStatus = "none" | "open" | "repairing" | "resolved";

export type WithdrawalStatus = "active" | "expired" | "lifted";

export type WithdrawalRepairStatus =
  | "none"
  | "cooling"
  | "eligible"
  | "attempted"
  | "backoff";

export type C5Mode = "observe" | "dark_apply" | "apply";
export type C5Provenance = "shadow" | "live";

export type RelationshipProjectionKind =
  | "current_shared_culture"
  | "historical_as_of";

export type InteractionContractKind =
  | "owner_standing_instruction"
  | "ashley_standing_boundary"
  | "mutual_contract"
  | "implicit_hypothesis";

export type InteractionContractLifecycle =
  | "recorded"
  | "in_force"
  | "withdrawn"
  | "superseded"
  | "proposed"
  | "bilaterally_evidenced"
  | "hypothesis";

export type ConsentGrantorRole = "doc" | "ashley";
export type ConsentEventKind = "grant" | "revoke" | "expire" | "supersede";

export type RepairProposalOrigin =
  | "model"
  | "worker"
  | "deterministic_extractor"
  | "owner";

export type RepairDisposition =
  | "repaired"
  | "not_repaired"
  | "unresolved"
  | "withdrawn";

export type WithdrawalScope =
  | "turn"
  | "topic"
  | "initiative"
  | "relationship_pause"
  | "boundary_repair";

export type WithdrawalInitiator = "doc" | "ashley" | "system";

export type SilenceReasonCode =
  | "user_requested_space"
  | "withdrawal_turn"
  | "withdrawal_topic"
  | "withdrawal_initiative"
  | "withdrawal_pause"
  | "withdrawal_boundary_repair"
  | "constitutional_refusal"
  | "thought_hold"
  | "coercion_blocked";

export type HoldReasonCode =
  | "proactive_paused"
  | "daily_cap"
  | "relationship_observe"
  | "repair_backoff"
  | "delivery_in_progress"
  | "own_time";

export type ClaimState = "claimed" | "released" | "committed" | "aborted";

export type RelationshipRecordKind =
  | "doc_reminder"
  | "ashley_self_commitment"
  | "mutual_commitment"
  | "scheduled_proactive"
  | "relational_tension"
  | "withdrawal";
