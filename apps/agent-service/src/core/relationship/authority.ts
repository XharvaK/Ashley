import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import type {
  WithdrawalInitiator,
  WithdrawalScope,
} from "./types.js";
import { repairCoolingHours } from "./repair.js";
import { relationshipCanInfluence, relationshipCanRecord } from "./influence.js";
import { upsertDocReminder } from "./store.js";
import { env } from "../../env.js";

function textHash(text: string): string {
  return text.slice(0, 32);
}

export function recordWithdrawal(
  db: DatabaseSync,
  input: {
    ownerId: string;
    initiator: WithdrawalInitiator;
    scope: WithdrawalScope;
    reason: string;
    sourceEntityType: string;
    sourceEntityUuid: string;
    expiresAt?: string | null;
    topicHint?: string | null;
  },
): string {
  const now = new Date().toISOString();
  const entityUuid = assignNewEntityUuid();
  const coolingUntil =
    input.scope === "relationship_pause" && !input.expiresAt
      ? new Date(Date.now() + repairCoolingHours() * 3_600_000).toISOString()
      : null;
  db.prepare(
    `INSERT INTO withdrawal_records
       (owner_id, entity_uuid, data_classification, text, status, repair_status,
        initiator, scope, reason, expires_at, topic_hint, turn_consumed,
        source_entity_type, source_entity_uuid, text_hash, created_at, updated_at,
        cooling_until)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ownerId,
    entityUuid,
    defaultUnclassifiedConversational(),
    input.reason.trim().slice(0, 600),
    coolingUntil ? "cooling" : "none",
    input.initiator,
    input.scope,
    input.reason.trim().slice(0, 600),
    input.expiresAt ?? null,
    input.topicHint ?? null,
    input.sourceEntityType,
    input.sourceEntityUuid,
    textHash(input.reason),
    now,
    now,
    coolingUntil,
  );
  return entityUuid;
}

export function detectReminderIntent(message: string): boolean {
  return /\b(?:remind me|set a reminder|don't forget|remember to)\b/i.test(
    message,
  );
}

export function detectSpaceRequest(message: string): {
  scope: WithdrawalScope;
  duration?: string;
} | null {
  if (/\b(?:leave me alone|don't ping|stop messaging)\b/i.test(message)) {
    return { scope: "relationship_pause" };
  }
  if (/\b(?:not now|busy|later)\b/i.test(message)) {
    return { scope: "turn" };
  }
  return null;
}

export function isMutualCoPlanningText(text: string): boolean {
  return /\b(?:we should|let's both|together we(?:'ll| will)|mutual(?:ly)?)\b/i.test(
    text,
  );
}

export function observeReactiveRelationshipSignals(
  db: DatabaseSync,
  input: {
    ownerId: string;
    message: string;
    messageEntityUuid: string;
    /** Only an explicit parsed due time may make a reminder due. */
    dueAt?: string | null;
  },
): void {
  if (!relationshipCanRecord(db, env.cognitionMode)) return;
  if (detectReminderIntent(input.message)) {
    upsertDocReminder(db, {
      ownerId: input.ownerId,
      text: input.message.trim().slice(0, 600),
      dueAt: input.dueAt ?? null,
      sourceEntityType: "message",
      sourceEntityUuid: input.messageEntityUuid,
      classification: defaultUnclassifiedConversational(),
      status: "pending",
      provenance: relationshipCanInfluence(
        db,
        env.cognitionMode,
        "relational_initiative",
      ) ? "live" : "shadow",
      partySubjectScope: "owner",
    });
  }
  const space = detectSpaceRequest(input.message);
  if (space) {
    recordWithdrawal(db, {
      ownerId: input.ownerId,
      initiator: "doc",
      scope: space.scope,
      reason: input.message.trim().slice(0, 600),
      sourceEntityType: "message",
      sourceEntityUuid: input.messageEntityUuid,
    });
  }
}
