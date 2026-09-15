import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ARCHITECTURE_EPOCH,
  type ConversationEvidenceRecord,
} from "../types.js";
import type { DataClassification } from "../../privacy/classification.js";
import {
  defaultUnclassifiedConversational,
  mapLegacySensitivity,
} from "../../privacy/classification.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "../../privacy/secrets.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";

export type AppendEvidenceInput = {
  conversationId: string;
  text: string | null;
  discordMessageIds?: string[];
  lineageId?: string;
  version?: number;
  editOfRowId?: string;
  nowMs?: number;
  architectureEpoch?: string;
  sourceStatus?: string;
  dataClassification?: DataClassification;
  legacySensitivity?: "none" | "private" | string | null;
  reservationId?: number | null;
  producingCycleId?: string | null;
  delivered?: boolean;
  speakerPrincipalId?: string | null;
  speakerKind?: EvidenceSpeakerKind;
  location?: unknown;
  audienceAtCapture?: EvidenceAudienceAtCapture;
  sentAtMs?: number | null;
  replyToMessageId?: string | null;
  mentionIds?: string[];
  attachmentRefs?: unknown[];
  provenance?: unknown;
};

export type EvidenceRole = "owner" | "ashley" | "system" | "external_dialog";

type EvidenceSpeakerKind = "owner" | "external_human" | "external_bot" | "ashley";
type EvidenceAudienceAtCapture = "owner_private" | "dm" | "room";

type EvidenceDbRow = {
  row_id?: unknown;
  lineage_id?: unknown;
  version?: unknown;
  conversation_id?: unknown;
  role?: unknown;
  text?: unknown;
  created_at_ms?: unknown;
  discord_message_ids_json?: unknown;
  reservation_id?: unknown;
  producing_cycle_id?: unknown;
  architecture_epoch?: unknown;
  content_hash?: unknown;
  source_status?: unknown;
  data_classification?: unknown;
  secret_omitted?: unknown;
  delivered?: unknown;
  speaker_principal_id?: unknown;
  speaker_kind?: unknown;
  location_json?: unknown;
  audience_at_capture?: unknown;
  sent_at_ms?: unknown;
  reply_to_message_id?: unknown;
  mention_ids_json?: unknown;
  attachment_refs_json?: unknown;
  provenance_json?: unknown;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asClassification(value: unknown): DataClassification {
  if (value === "ordinary" || value === "sensitive" || value === "never_public" || value === "secret") {
    return value;
  }
  return defaultUnclassifiedConversational();
}

function uniqueIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
}

function parseJson(value: unknown): unknown | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function parseJsonArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function hashContent(role: EvidenceRole, text: string | null): string {
  return createHash("sha256")
    .update(`${role}\u0000${text ?? ""}`, "utf8")
    .digest("hex");
}

function isSpeakerKind(value: unknown): value is EvidenceSpeakerKind {
  return value === "owner" || value === "external_human" || value === "external_bot" || value === "ashley";
}

function speakerKindForWrite(role: EvidenceRole, value: unknown): EvidenceSpeakerKind | null {
  if (value !== undefined && !isSpeakerKind(value)) throw new Error("speaker_kind_invalid");
  if (isSpeakerKind(value)) return value;
  if (role === "owner") return "owner";
  if (role === "ashley") return "ashley";
  if (role === "external_dialog") throw new Error("speaker_kind_invalid");
  return null;
}

function mapEvidence(row: unknown): ConversationEvidenceRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as EvidenceDbRow;
  const role = asString(value.role);
  if (role !== "owner" && role !== "ashley" && role !== "system" && role !== "external_dialog") return null;
  const speakerKind = isSpeakerKind(value.speaker_kind) ? value.speaker_kind : undefined;
  if (speakerKind === undefined && role !== "system") return null;
  if (value.speaker_kind != null && speakerKind === undefined) return null;
  const audienceAtCapture: EvidenceAudienceAtCapture = value.audience_at_capture === "dm" || value.audience_at_capture === "room"
    ? value.audience_at_capture
    : "owner_private";
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(asString(value.discord_message_ids_json, "[]"));
    if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    ids = [];
  }
  return {
    rowId: asString(value.row_id),
    lineageId: asString(value.lineage_id),
    version: asNumber(value.version),
    conversationId: asString(value.conversation_id),
    role,
    text: value.text == null ? null : asString(value.text),
    createdAtMs: asNumber(value.created_at_ms),
    discordMessageIds: ids,
    reservationId: value.reservation_id == null ? null : asNumber(value.reservation_id),
    producingCycleId: value.producing_cycle_id == null ? null : asString(value.producing_cycle_id),
    architectureEpoch: asString(value.architecture_epoch, ARCHITECTURE_EPOCH),
    contentHash: asString(value.content_hash),
    sourceStatus: asString(value.source_status, "received"),
    dataClassification: asClassification(value.data_classification),
    secretOmitted: asNumber(value.secret_omitted) === 1,
    delivered: asNumber(value.delivered) === 1,
    speakerPrincipalId: value.speaker_principal_id == null ? null : asString(value.speaker_principal_id),
    speakerKind,
    location: parseJson(value.location_json),
    audienceAtCapture,
    sentAtMs: value.sent_at_ms == null ? null : asNumber(value.sent_at_ms),
    replyToMessageId: value.reply_to_message_id == null ? null : asString(value.reply_to_message_id),
    mentionIds: parseStringArray(value.mention_ids_json),
    attachmentRefs: parseJsonArray(value.attachment_refs_json),
    provenance: parseJson(value.provenance_json),
  };
}

function byId(db: DatabaseSync, rowId: string): ConversationEvidenceRecord | null {
  return mapEvidence(
    db.prepare("SELECT * FROM conversation_evidence_log WHERE row_id = ?").get(rowId),
  );
}

function existingByDiscordId(
  db: DatabaseSync,
  discordMessageId: string,
): ConversationEvidenceRecord | null {
  const row = db
    .prepare(
      `SELECT e.*
       FROM conversation_evidence_discord_ids d
       JOIN conversation_evidence_log e ON e.lineage_id = d.lineage_id
       WHERE d.discord_message_id = ?
       ORDER BY e.version DESC
       LIMIT 1`,
    )
    .get(discordMessageId);
  return mapEvidence(row);
}

function normalizeClassification(input: AppendEvidenceInput, sourceText: string | null): {
  text: string | null;
  classification: DataClassification;
  secretOmitted: boolean;
} {
  if (sourceText !== null) {
    const secret = detectCredentialShape(sourceText);
    if (secret.hit) {
      return {
        text: CREDENTIAL_OMITTED_PLACEHOLDER,
        classification: "secret",
        secretOmitted: true,
      };
    }
  }
  return {
    text: sourceText,
    classification:
      input.dataClassification ??
      mapLegacySensitivity(input.legacySensitivity) ??
      defaultUnclassifiedConversational(),
    secretOmitted: false,
  };
}

export function appendEvidenceInTransaction(
  db: DatabaseSync,
  role: EvidenceRole,
  input: AppendEvidenceInput,
): ConversationEvidenceRecord {
  if (!input.conversationId.trim()) throw new Error("conversation_id_required");
  const ids = uniqueIds(input.discordMessageIds);
  const nowMs = input.nowMs ?? Date.now();
  const normalized = normalizeClassification(input, input.text);
  const speakerKind = speakerKindForWrite(role, input.speakerKind);
  const explicitEdit = Boolean(input.editOfRowId);

  if (!explicitEdit) {
    for (const id of ids) {
      const existing = existingByDiscordId(db, id);
      if (existing) {
        return existing;
      }
    }
  }

  const parent = input.editOfRowId ? byId(db, input.editOfRowId) : null;
  if (input.editOfRowId && !parent) throw new Error("evidence_edit_parent_missing");
  const lineageId = input.lineageId ?? parent?.lineageId ?? randomUUID();
  const latest = db
    .prepare("SELECT MAX(version) AS version FROM conversation_evidence_log WHERE lineage_id = ?")
    .get(lineageId) as { version?: unknown } | undefined;
  const version = Math.max(
    1,
    input.version ?? 0,
    asNumber(latest?.version, 0) + (parent || latest?.version != null ? 1 : 0),
  );
  const rowId = randomUUID();
  const storedIds = ids.length > 0 ? ids : parent?.discordMessageIds ?? [];
  if (role === "external_dialog") {
    db.prepare(
      `INSERT INTO conversation_evidence_log
         (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
          discord_message_ids_json, reservation_id, producing_cycle_id, architecture_epoch,
          content_hash, source_status, data_classification, secret_omitted, delivered,
          speaker_principal_id, speaker_kind, location_json, audience_at_capture,
          sent_at_ms, reply_to_message_id, mention_ids_json, attachment_refs_json, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rowId,
      lineageId,
      version,
      input.conversationId,
      role,
      normalized.text,
      nowMs,
      JSON.stringify(storedIds),
      input.reservationId ?? null,
      input.producingCycleId ?? null,
      input.architectureEpoch ?? ARCHITECTURE_EPOCH,
      hashContent(role, normalized.text),
      input.sourceStatus ?? (explicitEdit ? "edited" : "received"),
      normalized.classification,
      normalized.secretOmitted ? 1 : 0,
      input.delivered ? 1 : 0,
      input.speakerPrincipalId ?? null,
      speakerKind,
      input.location == null ? null : JSON.stringify(input.location),
      input.audienceAtCapture ?? null,
      input.sentAtMs ?? null,
      input.replyToMessageId ?? null,
      JSON.stringify(input.mentionIds ?? []),
      JSON.stringify(input.attachmentRefs ?? []),
      input.provenance == null ? null : JSON.stringify(input.provenance),
    );
  } else {
    db.prepare(
      `INSERT INTO conversation_evidence_log
         (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
          discord_message_ids_json, reservation_id, producing_cycle_id, architecture_epoch,
          content_hash, source_status, data_classification, secret_omitted, delivered,
          speaker_principal_id, speaker_kind, location_json, audience_at_capture,
          sent_at_ms, reply_to_message_id, mention_ids_json, attachment_refs_json, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rowId,
      lineageId,
      version,
      input.conversationId,
      role,
      normalized.text,
      nowMs,
      JSON.stringify(storedIds),
      input.reservationId ?? null,
      input.producingCycleId ?? null,
      input.architectureEpoch ?? ARCHITECTURE_EPOCH,
      hashContent(role, normalized.text),
      input.sourceStatus ?? (explicitEdit ? "edited" : "received"),
      normalized.classification,
      normalized.secretOmitted ? 1 : 0,
      input.delivered ? 1 : 0,
      input.speakerPrincipalId ?? null,
      speakerKind,
      input.location == null ? null : JSON.stringify(input.location),
      input.audienceAtCapture ?? null,
      input.sentAtMs ?? null,
      input.replyToMessageId ?? null,
      JSON.stringify(input.mentionIds ?? []),
      JSON.stringify(input.attachmentRefs ?? []),
      input.provenance == null ? null : JSON.stringify(input.provenance),
    );
  }

  const mapping = db.prepare(
    `INSERT OR IGNORE INTO conversation_evidence_discord_ids
       (discord_message_id, conversation_id, lineage_id, ordinal)
     VALUES (?, ?, ?, ?)`,
  );
  storedIds.forEach((id, ordinal) => mapping.run(id, input.conversationId, lineageId, ordinal));
  const result = byId(db, rowId);
  if (!result) throw new Error("evidence_append_lost");
  return result;
}

function appendEvidence(
  db: DatabaseSync,
  role: EvidenceRole,
  input: AppendEvidenceInput,
): ConversationEvidenceRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = appendEvidenceInTransaction(db, role, input);
    db.exec("COMMIT");
    try {
      notifySidecarPostCommit(db, { changedRowIds: [result.rowId] });
    } catch {
      // Derived sync failures must never disturb authoritative sidecar commit
    }
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the write error.
    }
    throw error;
  }
}

export function appendOwnerUtterance(
  db: DatabaseSync,
  input: AppendEvidenceInput,
): ConversationEvidenceRecord {
  return appendOwnerUtteranceWithStatus(db, input).evidence;
}

export type AppendOwnerUtteranceResult = {
  evidence: ConversationEvidenceRecord;
  duplicate: boolean;
};

export type AppendExternalUtteranceResult = {
  evidence: ConversationEvidenceRecord;
  duplicate: boolean;
};

/** Admit owner evidence within an existing caller-managed transaction. */
export function appendOwnerUtteranceInTransaction(
  db: DatabaseSync,
  input: AppendEvidenceInput,
): AppendOwnerUtteranceResult {
  if (!input.editOfRowId) {
    for (const id of uniqueIds(input.discordMessageIds)) {
      const existing = existingByDiscordId(db, id);
      if (existing) return { evidence: existing, duplicate: true };
    }
  }
  return { evidence: appendEvidenceInTransaction(db, "owner", input), duplicate: false };
}

/** Admit attributed external evidence within an existing caller-managed transaction. */
export function appendExternalUtteranceInTransaction(
  db: DatabaseSync,
  input: AppendEvidenceInput,
): AppendExternalUtteranceResult {
  for (const id of uniqueIds(input.discordMessageIds)) {
    const existing = existingByDiscordId(db, id);
    if (existing) {
      if (existing.role !== "external_dialog") throw new Error("external_evidence_discord_id_conflict");
      return { evidence: existing, duplicate: true };
    }
  }
  return { evidence: appendEvidenceInTransaction(db, "external_dialog", input), duplicate: false };
}

/** Admit owner evidence while exposing the Discord-id replay bit to ingress. */
export function appendOwnerUtteranceWithStatus(
  db: DatabaseSync,
  input: AppendEvidenceInput,
): AppendOwnerUtteranceResult {
  if (!input.editOfRowId) {
    for (const id of uniqueIds(input.discordMessageIds)) {
      const existing = existingByDiscordId(db, id);
      if (existing) return { evidence: existing, duplicate: true };
    }
  }
  return { evidence: appendEvidence(db, "owner", input), duplicate: false };
}

export function appendSystemEvent(
  db: DatabaseSync,
  input: AppendEvidenceInput,
): ConversationEvidenceRecord {
  return appendEvidence(db, "system", input);
}

export function appendAshleyEvidence(
  db: DatabaseSync,
  input: AppendEvidenceInput,
): ConversationEvidenceRecord {
  return appendEvidence(db, "ashley", input);
}

export function getConversationEvidence(
  db: DatabaseSync,
  rowId: string,
): ConversationEvidenceRecord | null {
  return byId(db, rowId);
}

export function getEvidenceByRowId(
  db: DatabaseSync,
  rowId: string,
): ConversationEvidenceRecord | null {
  return byId(db, rowId);
}

export function listConversationEvidence(
  db: DatabaseSync,
  conversationId: string,
  options: { limit?: number; includeOlderVersions?: boolean } = {},
): ConversationEvidenceRecord[] {
  const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
  const rows = db
    .prepare(
      `SELECT * FROM conversation_evidence_log
       WHERE conversation_id = ?
       ${options.includeOlderVersions === false ? "AND version = (SELECT MAX(e2.version) FROM conversation_evidence_log e2 WHERE e2.lineage_id = conversation_evidence_log.lineage_id)" : ""}
       ORDER BY created_at_ms ASC, rowid ASC
       LIMIT ?`,
    )
    .all(conversationId, limit);
  return rows.map(mapEvidence).filter((row): row is ConversationEvidenceRecord => row !== null);
}

export function markEvidenceDelivered(db: DatabaseSync, rowId: string): void {
  db.prepare("UPDATE conversation_evidence_log SET delivered = 1 WHERE row_id = ?").run(rowId);
}
