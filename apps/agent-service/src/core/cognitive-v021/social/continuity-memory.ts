import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canEnterModelContext,
  maxClassification,
  type DataClassification,
} from "../../privacy/classification.js";
import { detectCredentialShape } from "../../privacy/secrets.js";
import {
  getEvidenceByRowId,
  listConversationEvidence,
} from "../evidence/conversation-log.js";
import {
  getCycleFreshnessState,
  type CycleDisposition,
} from "../cycle/inbox.js";
import type {
  ConversationEvidenceRecord,
  EpistemicDimensions,
  MemoryAssertion,
  MemoryKind,
} from "../types.js";
import {
  getMemoryAssertion,
  upsertMemoryAssertion,
} from "../memory/assertions.js";
import { appendMemorySupport } from "../memory/supports.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";
import {
  classifyEligibility,
  readEligibilityBundle,
} from "../../relationship/social-authority.js";
import type { SocialAudience } from "./types.js";

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function payload(value: unknown): Row {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function payloadValue(value: unknown): Row {
  return isRecord(value) ? value : {};
}

function audienceKey(audience: SocialAudience): string {
  if (audience.kind === "dm") return `dm:${audience.principalId}`;
  if (audience.kind === "room") return `room:${audience.roomId}`;
  return "owner_private";
}

function sameAudience(left: SocialAudience | null | undefined, right: SocialAudience): boolean {
  return left != null && audienceKey(left) === audienceKey(right);
}

function audienceForEvidence(evidence: ConversationEvidenceRecord): SocialAudience | null {
  const location = payloadValue(evidence.location);
  if (evidence.audienceAtCapture === "dm" && location.kind === "external_dm") {
    const principalId = text(location.principalId);
    if (principalId && principalId === text(evidence.speakerPrincipalId)) {
      return { kind: "dm", principalId };
    }
  }
  if (evidence.audienceAtCapture === "room" && location.kind === "room") {
    const guildId = text(location.guildId);
    const channelId = text(location.channelId);
    if (guildId && channelId) return { kind: "room", roomId: `room:${guildId}:${channelId}` };
  }
  return null;
}

function audienceForConversation(conversationId: string): SocialAudience | null {
  const dm = /^dm:[^:]+:([^:]+)$/.exec(conversationId);
  if (dm) return { kind: "dm", principalId: dm[1] };
  const room = /^room:([^:]+):([^:]+)(?::thread:.+)?$/.exec(conversationId);
  if (room) return { kind: "room", roomId: `room:${room[1]}:${room[2]}` };
  return null;
}

function safeProvenance(value: unknown): { source: "discord"; receivedAtMs: number } | null {
  const record = payloadValue(value);
  const receivedAtMs = integer(record.receivedAtMs);
  return record.source === "discord" && receivedAtMs != null
    ? { source: "discord", receivedAtMs }
    : null;
}

export type ExternalBacklogAvailability =
  | "captured"
  | "eligible_pending"
  | "quarantined"
  | "unresolved_deferred";

export type ExternalBacklogManifestEntry = Readonly<{
  evidenceRowId: string;
  lineageId: string;
  version: number;
  createdAtMs: number;
  speakerPrincipalId: string | null;
  speakerKind: ConversationEvidenceRecord["speakerKind"];
  audience: SocialAudience;
  sourceStatus: string;
  contentAvailable: boolean;
  provenance: { source: "discord"; receivedAtMs: number } | null;
  availability: ExternalBacklogAvailability;
  cycleId?: string;
}>;

export type ExternalBacklogManifest = Readonly<{
  conversationId: string;
  audience: SocialAudience;
  generatedAtMs: number;
  entries: readonly ExternalBacklogManifestEntry[];
  truncated: boolean;
}>;

type InboxMarker = {
  id: string;
  kind: string;
  state: string;
  status: string;
  payload_json: string;
  quarantine_reason: string | null;
  created_at_ms: number;
};

function markersForEvidence(db: DatabaseSync, evidence: ConversationEvidenceRecord): InboxMarker[] {
  return db.prepare(
    `SELECT id, kind, state, status, payload_json, quarantine_reason, created_at_ms
       FROM inbox_events
      WHERE conversation_id = ?
        AND (id IN (?, ?, ?)
          OR json_extract(payload_json, '$.evidenceRowId') = ?)
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(
    evidence.conversationId,
    `external:capture:${evidence.rowId}`,
    `external:eligible:${evidence.rowId}`,
    `external:quarantine:${evidence.rowId}`,
    evidence.rowId,
  ) as InboxMarker[];
}

function cycleIdFromMarker(marker: InboxMarker): string | null {
  return text(payload(marker.payload_json).cycleId);
}

function dispositionForCycle(db: DatabaseSync, cycleId: string | null): CycleDisposition | null {
  if (!cycleId) return null;
  try {
    return getCycleFreshnessState(db, cycleId).disposition;
  } catch {
    return null;
  }
}

function unresolvedCycleForEvidence(
  db: DatabaseSync,
  evidence: ConversationEvidenceRecord,
  markers: readonly InboxMarker[],
): string | null {
  for (const marker of markers) {
    const cycleId = cycleIdFromMarker(marker);
    if (dispositionForCycle(db, cycleId) === "unresolved_deferred") return cycleId;
  }
  if (evidence.producingCycleId && dispositionForCycle(db, evidence.producingCycleId) === "unresolved_deferred") {
    return evidence.producingCycleId;
  }
  return null;
}

function manifestEntry(
  evidence: ConversationEvidenceRecord,
  audience: SocialAudience,
  availability: ExternalBacklogAvailability,
  cycleId?: string | null,
): ExternalBacklogManifestEntry {
  return {
    evidenceRowId: evidence.rowId,
    lineageId: evidence.lineageId,
    version: evidence.version,
    createdAtMs: evidence.createdAtMs,
    speakerPrincipalId: evidence.speakerPrincipalId ?? null,
    speakerKind: evidence.speakerKind,
    audience,
    sourceStatus: evidence.sourceStatus,
    contentAvailable: evidence.text !== null && !evidence.secretOmitted && evidence.dataClassification !== "secret",
    provenance: safeProvenance(evidence.provenance),
    availability,
    ...(cycleId ? { cycleId } : {}),
  };
}

/**
 * Build the bounded manifest that a later Thought pass may adjudicate. The
 * manifest contains references and source facts only; it never carries the
 * captured message text or an old authority snapshot.
 */
export function buildExternalBacklogManifest(
  db: DatabaseSync,
  input: { conversationId: string; limit?: number; nowMs?: number },
): ExternalBacklogManifest {
  const conversationId = input.conversationId.trim();
  if (!conversationId) throw new Error("external_backlog_conversation_required");
  const audience = audienceForConversation(conversationId);
  if (!audience || audience.kind === "owner_private") throw new Error("external_backlog_audience_invalid");
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 32)));
  const evidence = listConversationEvidence(db, conversationId, {
    limit: Math.min(1000, limit * 4),
    includeOlderVersions: false,
  }).filter((row) => row.role === "external_dialog");
  const entries: ExternalBacklogManifestEntry[] = [];

  for (const row of evidence) {
    const rowAudience = audienceForEvidence(row);
    if (!rowAudience || !sameAudience(rowAudience, audience)) continue;
    const markers = markersForEvidence(db, row);
    const eligible = markers.some((marker) =>
      marker.kind === "external_eligible_pending" && marker.state === "pending" && marker.status === "pending",
    );
    const quarantine = markers.find((marker) =>
      marker.kind === "quarantined_external"
        && marker.state === "quarantined"
        && marker.status === "failed_terminal"
        && marker.quarantine_reason !== "initial_contact_pending"
        && marker.quarantine_reason !== "initial_contact_reopened",
    );
    const unresolvedCycleId = unresolvedCycleForEvidence(db, row, markers);
    const intentionalSilence = markers.some((marker) =>
      dispositionForCycle(db, cycleIdFromMarker(marker)) === "intentional_silence",
    );
    if (intentionalSilence) continue;
    if (unresolvedCycleId) {
      entries.push(manifestEntry(row, audience, "unresolved_deferred", unresolvedCycleId));
    } else if (quarantine) {
      entries.push(manifestEntry(row, audience, eligible ? "eligible_pending" : "quarantined"));
    }
    if (entries.length >= limit) break;
  }

  return {
    conversationId,
    audience,
    generatedAtMs: input.nowMs ?? Date.now(),
    entries,
    truncated: evidence.length > limit || entries.length >= limit && evidence.length > entries.length,
  };
}

export type ExternalUnresolvedReference = ExternalBacklogManifestEntry;

/** Read unresolved social input without changing its inbox or cycle state. */
export function listUnresolvedDeferredExternal(
  db: DatabaseSync,
  input: { conversationId?: string; limit?: number } = {},
): ExternalUnresolvedReference[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 100)));
  const conversationId = input.conversationId?.trim() || null;
  const cycleRows = db.prepare(
    `SELECT cycle_id, conversation_id, compose_log_ids_json
       FROM cycle_records
      WHERE disposition = 'unresolved_deferred'
        AND (? IS NULL OR conversation_id = ?)
      ORDER BY updated_at_ms ASC, cycle_id ASC
      LIMIT ?`,
  ).all(conversationId, conversationId, limit * 2) as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const result: ExternalUnresolvedReference[] = [];
  for (const cycle of cycleRows) {
    const cycleId = text(cycle.cycle_id);
    const id = text(cycle.conversation_id);
    if (!cycleId || !id) continue;
    const audience = audienceForConversation(id);
    if (!audience || audience.kind === "owner_private") continue;
    let refs: string[] = [];
    try {
      const parsed = JSON.parse(typeof cycle.compose_log_ids_json === "string" ? cycle.compose_log_ids_json : "[]");
      if (Array.isArray(parsed)) refs = parsed.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0);
    } catch {
      refs = [];
    }
    const eventRows = db.prepare(
      `SELECT payload_json FROM inbox_events
        WHERE conversation_id = ?
          AND (json_extract(payload_json, '$.cycleId') = ? OR kind IN ('external_utterance','external_message'))
        ORDER BY created_at_ms ASC, id ASC`,
    ).all(id, cycleId) as Array<{ payload_json?: unknown }>;
    for (const event of eventRows) {
      const evidenceRowId = text(payload(event.payload_json).evidenceRowId);
      if (evidenceRowId) refs.push(evidenceRowId);
    }
    for (const ref of [...new Set(refs)]) {
      if (seen.has(ref)) continue;
      const evidence = getEvidenceByRowId(db, ref);
      if (!evidence || evidence.role !== "external_dialog") continue;
      const rowAudience = audienceForEvidence(evidence);
      if (!rowAudience || !sameAudience(rowAudience, audience)) continue;
      seen.add(evidence.rowId);
      result.push(manifestEntry(evidence, audience, "unresolved_deferred", cycleId));
      if (result.length >= limit) return result;
    }
  }
  return result;
}

export type ExternalBacklogAdjudication = Readonly<{
  status: "ready" | "retained";
  manifest: ExternalBacklogManifest;
  requiresThought: true;
  replayed: false;
  restoredDrafts: false;
  reusedOldAuthoritySnapshot: false;
  answer: null;
}>;

/**
 * Surface a manifest as a Thought obligation. This function deliberately has
 * no replay, draft restoration, or mechanical answer branch.
 */
export function surfaceExternalBacklogForThought(
  manifest: ExternalBacklogManifest,
): ExternalBacklogAdjudication {
  const valid = isRecord(manifest)
    && typeof manifest.conversationId === "string"
    && isRecord(manifest.audience)
    && Array.isArray(manifest.entries)
    && manifest.entries.every((entry) => isRecord(entry) && typeof entry.evidenceRowId === "string");
  return {
    status: valid ? "ready" : "retained",
    manifest,
    requiresThought: true,
    replayed: false,
    restoredDrafts: false,
    reusedOldAuthoritySnapshot: false,
    answer: null,
  };
}

export const adjudicateExternalBacklog = surfaceExternalBacklogForThought;

type InitialContactCandidate = {
  quarantine: InboxMarker;
  evidence: ConversationEvidenceRecord;
  capturePayload: Row;
  envelopeJson: string | null;
};

function externalDmLocation(evidence: ConversationEvidenceRecord): { principalId: string; channelId: string } | null {
  const location = payloadValue(evidence.location);
  const principalId = text(evidence.speakerPrincipalId);
  const channelId = text(location.channelId);
  if (location.kind !== "external_dm" || !principalId || text(location.principalId) !== principalId || !channelId) return null;
  return { principalId, channelId };
}

function captureMarkerFor(
  db: DatabaseSync,
  evidence: ConversationEvidenceRecord,
): { payload: Row; envelopeJson: string | null } | null {
  const row = db.prepare(
    `SELECT payload_json, envelope_json
       FROM inbox_events
      WHERE id = ? AND kind = 'external_captured'`,
  ).get(`external:capture:${evidence.rowId}`) as { payload_json?: unknown; envelope_json?: unknown } | undefined;
  if (!row) return null;
  const capturePayload = payload(row.payload_json);
  const envelopeJson = typeof row.envelope_json === "string" ? row.envelope_json : null;
  return { payload: capturePayload, envelopeJson };
}

function insertEligibleMarker(
  db: DatabaseSync,
  candidate: InitialContactCandidate,
  nowMs: number,
): boolean {
  const evidence = candidate.evidence;
  const captureRef = text(candidate.capturePayload.captureRef) ?? `extcap:${evidence.rowId}`;
  const messageId = text(candidate.capturePayload.discordMessageId) ?? evidence.discordMessageIds[0] ?? evidence.rowId;
  const result = db.prepare(
    `INSERT OR IGNORE INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status, state,
        terminal_reason, quarantine_reason, wake_id, envelope_json)
     VALUES (?, ?, 'external_eligible_pending', ?, ?, 'pending', 'pending',
             NULL, NULL, NULL, ?)`,
  ).run(
    `external:eligible:${evidence.rowId}`,
    evidence.conversationId,
    JSON.stringify({
      captureRef,
      evidenceRowId: evidence.rowId,
      conversationKey: evidence.conversationId,
      discordMessageId: messageId,
    }),
    nowMs,
    candidate.envelopeJson,
  );
  db.prepare(
    `UPDATE inbox_events
        SET quarantine_reason = 'initial_contact_reopened'
      WHERE id = ? AND kind = 'quarantined_external'
        AND state = 'quarantined' AND status = 'failed_terminal'`,
  ).run(candidate.quarantine.id);
  return Number(result.changes) === 1;
}

export type InitialContactRecoveryResult = Readonly<{
  scanned: number;
  reopened: number;
  waiting: number;
  failures: number;
}>;

/** Reopen the exact pending initial knock after current Owner permission. */
export function recoverInitialContactEligibility(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  options: { nowMs?: number; principalId?: string; limit?: number } = {},
): InitialContactRecoveryResult {
  const nowMs = options.nowMs ?? Date.now();
  const principalFilter = options.principalId?.trim() || null;
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const rows = sidecar.prepare(
    `SELECT id, conversation_id, state, status, payload_json, quarantine_reason, created_at_ms
       FROM inbox_events
      WHERE kind = 'quarantined_external'
        AND state = 'quarantined'
        AND status = 'failed_terminal'
        AND quarantine_reason = 'initial_contact_pending'
        AND (? IS NULL OR json_extract(payload_json, '$.conversationKey') LIKE 'dm:%')
      ORDER BY created_at_ms ASC, id ASC
      LIMIT ?`,
  ).all(principalFilter, limit) as InboxMarker[];
  let reopened = 0;
  let waiting = 0;
  let failures = 0;
  const candidates: InitialContactCandidate[] = [];

  for (const quarantine of rows) {
    const quarantinePayload = payload(quarantine.payload_json);
    const evidenceRowId = text(quarantinePayload.evidenceRowId);
    if (!evidenceRowId) {
      failures += 1;
      continue;
    }
    const evidence = getEvidenceByRowId(sidecar, evidenceRowId);
    const location = evidence ? externalDmLocation(evidence) : null;
    if (!evidence || !location || (principalFilter && location.principalId !== principalFilter)) {
      waiting += 1;
      continue;
    }
    const capture = captureMarkerFor(sidecar, evidence);
    if (!capture) {
      failures += 1;
      continue;
    }
    try {
      const bundle = readEligibilityBundle(nuclear, {
        principalId: location.principalId,
        channelId: location.channelId,
        nowMs,
      });
      if (classifyEligibility(bundle, "dm").verdict !== "allow_social") {
        waiting += 1;
        continue;
      }
      candidates.push({ quarantine, evidence, capturePayload: capture.payload, envelopeJson: capture.envelopeJson });
    } catch {
      failures += 1;
    }
  }

  if (candidates.length === 0) return { scanned: rows.length, reopened, waiting, failures };
  sidecar.exec("BEGIN IMMEDIATE");
  try {
    for (const candidate of candidates) {
      if (insertEligibleMarker(sidecar, candidate, nowMs)) reopened += 1;
    }
    sidecar.exec("COMMIT");
  } catch {
    try { sidecar.exec("ROLLBACK"); } catch { /* preserve the failure result */ }
    failures += candidates.length;
  }
  return { scanned: rows.length, reopened, waiting, failures };
}

export type ExternalDeletionRequestInput = {
  ownerId: string;
  requestId: string;
  evidenceRowId: string;
  requesterPrincipalId: string;
  nowMs?: number;
  projectSystemNotice?: (noticeId: number) => Promise<void> | void;
};

export type ExternalDeletionRequestResult = Readonly<{
  captured: boolean;
  duplicate: boolean;
  notificationQueued: boolean;
  mechanicalEffect: false;
}>;

/** Capture a platform deletion request without granting it deletion authority. */
export function captureExternalDeletionRequest(
  db: DatabaseSync,
  input: ExternalDeletionRequestInput,
): ExternalDeletionRequestResult {
  const ownerId = text(input.ownerId);
  const requestId = text(input.requestId);
  const evidenceRowId = text(input.evidenceRowId);
  const requesterPrincipalId = text(input.requesterPrincipalId);
  if (!ownerId || !requestId || !evidenceRowId || !requesterPrincipalId) throw new Error("external_deletion_request_invalid");
  const evidence = getEvidenceByRowId(db, evidenceRowId);
  if (!evidence || evidence.role !== "external_dialog" || text(evidence.speakerPrincipalId) !== requesterPrincipalId) {
    throw new Error("external_deletion_request_evidence_invalid");
  }
  const nowMs = input.nowMs ?? Date.now();
  const requestMarkerId = `external:deletion-request:${requestId}`;
  const noticeKey = `external_deletion_request:${ownerId}:${requestId}`;
  let noticeId: number | null = null;
  let created = false;
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const existing = db.prepare("SELECT id FROM inbox_events WHERE id = ?").get(requestMarkerId);
    if (!existing) {
      db.prepare(
        `INSERT INTO inbox_events
           (id, conversation_id, kind, payload_json, created_at_ms, status, state,
            terminal_reason, quarantine_reason, wake_id)
         VALUES (?, ?, 'external_deletion_request', ?, ?, 'pending', 'pending', NULL, NULL, NULL)`,
      ).run(
        requestMarkerId,
        evidence.conversationId,
        JSON.stringify({ requestId, evidenceRowId, conversationKey: evidence.conversationId, requesterPrincipalId }),
        nowMs,
      );
      created = true;
    }
    const existingNotice = db.prepare("SELECT notice_id FROM system_notice_outbox WHERE notice_key = ?").get(noticeKey) as { notice_id?: unknown } | undefined;
    if (existingNotice?.notice_id != null) {
      noticeId = Number(existingNotice.notice_id);
    } else {
      const inserted = db.prepare(
        `INSERT INTO system_notice_outbox
           (notice_key, projection_key, cycle_id, conversation_id, notice_text,
            send_status, nuclear_reservation_id, discord_message_id, origin, delivery_intent_json)
         VALUES (?, ?, NULL, ?, ?, 'pending', NULL, NULL, 'live', ?)`,
      ).run(
        noticeKey,
        `system:external-deletion:${randomUUID()}`,
        evidence.conversationId,
        "An external deletion request for a retained Discord contact was received and is awaiting Owner review.",
        JSON.stringify({
          ownerId,
          channel: "discord",
          threadId: `social_notify:${ownerId}`,
          conversationId: evidence.conversationId,
          trigger: "recovery",
          deliveryLane: "social_notify",
          purpose: "system_notice",
        }),
      );
      noticeId = Number(inserted.lastInsertRowid);
    }
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    }
    throw error;
  }
  if (noticeId != null && input.projectSystemNotice && created) {
    try {
      const projected = input.projectSystemNotice(noticeId);
      if (projected && typeof (projected as Promise<void>).then === "function") {
        void (projected as Promise<void>).catch(() => undefined);
      }
    } catch {
      // The durable notice remains for the existing recovery projector.
    }
  }
  return {
    captured: true,
    duplicate: !created,
    notificationQueued: noticeId != null,
    mechanicalEffect: false,
  };
}

export type ExternalSocialRevisionKind = "shared_episode" | "learned_self_evidence";

export type ExternalSocialRevisionInput = {
  assertionKey: string;
  statement: string;
  memoryKind: ExternalSocialRevisionKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  evidenceRefs: readonly string[];
  audience: SocialAudience;
  sourcePrincipal?: string | null;
  subject?: readonly string[] | null;
  protectionBasisRefs: readonly string[];
  protectionStatus: "admitted" | "unresolved";
  licenseRefs?: readonly string[];
  thoughtInterpretationRef: string;
  lineageParentKey?: string | null;
  admittedGeneration: number;
  settlementId?: string | null;
  nowMs?: number;
};

export type ExternalSocialFacets = Readonly<{
  sourcePrincipal: string | null;
  subject: string[] | null;
  audienceScope: SocialAudience;
  sourceEvidenceRef: string;
  protectionBasisRefs: string[];
  protectionStatus: "admitted";
  licenseRefs: string[];
}>;

export type PreparedExternalSocialRevision = Readonly<{
  evidence: readonly ConversationEvidenceRecord[];
  effectiveClassification: DataClassification;
  facets: ExternalSocialFacets;
}>;

type ExternalRevisionPreparation =
  | { ok: true; value: PreparedExternalSocialRevision }
  | { ok: false; reason: string };

function evidenceForRef(db: DatabaseSync, ref: string): ConversationEvidenceRecord | null {
  const normalized = ref.trim();
  if (!normalized) return null;
  const direct = getEvidenceByRowId(db, normalized);
  if (direct) return direct.role === "external_dialog" ? direct : null;
  const row = db.prepare(
    `SELECT row_id
       FROM conversation_evidence_log
      WHERE lineage_id = ? AND role = 'external_dialog'
      ORDER BY version DESC, created_at_ms DESC, row_id DESC
      LIMIT 1`,
  ).get(normalized) as { row_id?: unknown } | undefined;
  return typeof row?.row_id === "string" ? getEvidenceByRowId(db, row.row_id) : null;
}

function parentProtectionPreserved(
  parent: MemoryAssertion,
  input: {
    audience: SocialAudience;
    sourcePrincipal: string | null;
    subject: string[] | null;
    protectionBasisRefs: string[];
    licenseRefs: string[];
    protectionStatus: "admitted" | "unresolved";
  },
): string | null {
  if (!parent.audienceScope || !sameAudience(parent.audienceScope, input.audience)) return "social_revision_audience_widening";
  if (parent.protectionStatus === "admitted" && input.protectionStatus !== "admitted") return "social_revision_protection_dropped";
  const basis = new Set(input.protectionBasisRefs);
  for (const ref of parent.protectionBasisRefs ?? []) if (!basis.has(ref)) return "social_revision_basis_dropped";
  const licenses = new Set(input.licenseRefs);
  for (const ref of parent.licenseRefs ?? []) if (!licenses.has(ref)) return "social_revision_license_dropped";
  if (parent.sourcePrincipal && parent.sourcePrincipal !== input.sourcePrincipal) return "social_revision_source_dropped";
  if (parent.subject && parent.subject.some((subject) => !input.subject?.includes(subject))) return "social_revision_subject_dropped";
  return null;
}

function prepareExternalSocialRevision(
  db: DatabaseSync,
  input: Pick<ExternalSocialRevisionInput, "statement" | "memoryKind" | "dimensions" | "dataClassification" | "evidenceRefs" | "audience" | "sourcePrincipal" | "subject" | "protectionBasisRefs" | "protectionStatus" | "licenseRefs" | "thoughtInterpretationRef" | "lineageParentKey">,
): ExternalRevisionPreparation {
  if (input.audience.kind === "owner_private") return { ok: false, reason: "social_revision_owner_audience_invalid" };
  if (input.memoryKind !== "shared_episode" && input.memoryKind !== "learned_self_evidence") {
    return { ok: false, reason: "social_revision_tier3_forbidden" };
  }
  const statement = input.statement.trim();
  if (!statement) return { ok: false, reason: "social_revision_statement_required" };
  if (detectCredentialShape(statement).hit || input.dataClassification === "secret") {
    return { ok: false, reason: "social_revision_secret_refused" };
  }
  if (input.dimensions.source !== "ashley_interpretation" || input.dimensions.status !== "interpreted") {
    return { ok: false, reason: "social_revision_thought_interpretation_required" };
  }
  if (input.dimensions.reliability !== "inferred") {
    return { ok: false, reason: "social_revision_interpretation_reliability_required" };
  }
  if (!input.thoughtInterpretationRef.trim()) return { ok: false, reason: "social_revision_interpretation_ref_required" };
  if (input.protectionStatus !== "admitted") return { ok: false, reason: "social_revision_protection_unresolved" };

  const refs = [...new Set(input.evidenceRefs.map((ref) => ref.trim()).filter(Boolean))];
  if (refs.length === 0) return { ok: false, reason: "social_revision_evidence_required" };
  const evidence: ConversationEvidenceRecord[] = [];
  for (const ref of refs) {
    const row = evidenceForRef(db, ref);
    if (!row || row.role !== "external_dialog") return { ok: false, reason: "social_revision_external_evidence_required" };
    if (row.text === null || row.secretOmitted || row.dataClassification === "secret") {
      return { ok: false, reason: "social_revision_secret_or_missing_evidence" };
    }
    const rowAudience = audienceForEvidence(row);
    if (!rowAudience || !sameAudience(rowAudience, input.audience)) {
      return { ok: false, reason: "social_revision_audience_mismatch" };
    }
    evidence.push(row);
  }
  const uniqueEvidence = [...new Map(evidence.map((row) => [row.rowId, row])).values()];
  if (input.memoryKind === "learned_self_evidence") {
    if (uniqueEvidence.length < 2) return { ok: false, reason: "social_revision_tier2_evidence_minimum" };
    if (new Set(uniqueEvidence.map((row) => row.createdAtMs)).size < 2) {
      return { ok: false, reason: "social_revision_tier2_temporal_span_required" };
    }
  }

  const speakers = [...new Set(uniqueEvidence.map((row) => text(row.speakerPrincipalId)).filter((value): value is string => value !== null))];
  if (input.memoryKind === "learned_self_evidence" && speakers.length !== 1) {
    return { ok: false, reason: "social_revision_tier2_single_principal_required" };
  }
  const sourcePrincipal = input.sourcePrincipal?.trim() || (speakers.length === 1 ? speakers[0] : null);
  if (input.sourcePrincipal && (!sourcePrincipal || !speakers.includes(sourcePrincipal))) {
    return { ok: false, reason: "social_revision_source_principal_mismatch" };
  }
  const subject = input.subject == null ? null : [...new Set(input.subject.map((item) => item.trim()).filter(Boolean))];
  const basisRefs = [...new Set(input.protectionBasisRefs.map((ref) => ref.trim()).filter(Boolean))];
  if (basisRefs.length === 0) return { ok: false, reason: "social_revision_protection_basis_required" };
  const basisSet = new Set(basisRefs);
  if (uniqueEvidence.some((row) => !basisSet.has(row.rowId) && !basisSet.has(row.lineageId))) {
    return { ok: false, reason: "social_revision_protection_basis_incomplete" };
  }
  const licenseRefs = [...new Set((input.licenseRefs ?? []).map((ref) => ref.trim()).filter(Boolean))];
  const effectiveClassification = maxClassification(
    input.dataClassification,
    ...uniqueEvidence.map((row) => row.dataClassification),
  );
  if (!canEnterModelContext(effectiveClassification, "private")) {
    return { ok: false, reason: "social_revision_secret_refused" };
  }
  if (input.lineageParentKey) {
    const parent = getMemoryAssertion(db, input.lineageParentKey);
    if (!parent) return { ok: false, reason: "social_revision_parent_missing" };
    const preserved = parentProtectionPreserved(parent, {
      audience: input.audience,
      sourcePrincipal,
      subject,
      protectionBasisRefs: basisRefs,
      licenseRefs,
      protectionStatus: input.protectionStatus,
    });
    if (preserved) return { ok: false, reason: preserved };
  }
  return {
    ok: true,
    value: {
      evidence: uniqueEvidence,
      effectiveClassification,
      facets: {
        sourcePrincipal,
        subject,
        audienceScope: input.audience,
        sourceEvidenceRef: uniqueEvidence[0].rowId,
        protectionBasisRefs: basisRefs,
        protectionStatus: "admitted",
        licenseRefs,
      },
    },
  };
}

/** Prepare the same social admission fence used by the revision writer. */
export function prepareExternalSocialNomination(
  db: DatabaseSync,
  input: {
    statement: string;
    memoryKind: MemoryKind;
    dimensions: EpistemicDimensions;
    dataClassification: DataClassification;
    sourceRefs: readonly string[];
    lineageParentKey?: string | null;
  },
): ExternalRevisionPreparation {
  const evidence = input.sourceRefs.map((ref) => evidenceForRef(db, ref)).filter((row): row is ConversationEvidenceRecord => row !== null);
  if (evidence.length === 0) return { ok: false, reason: "social_revision_external_evidence_required" };
  const audiences = evidence.map(audienceForEvidence);
  const audience = audiences[0];
  if (!audience || audience.kind === "owner_private" || audiences.some((item) => !item || !sameAudience(item, audience))) {
    return { ok: false, reason: "social_revision_audience_mismatch" };
  }
  const speakers = [...new Set(evidence.map((row) => text(row.speakerPrincipalId)).filter((value): value is string => value !== null))];
  return prepareExternalSocialRevision(db, {
    statement: input.statement,
    memoryKind: input.memoryKind === "shared_episode" || input.memoryKind === "learned_self_evidence" ? input.memoryKind : "shared_episode",
    dimensions: input.dimensions,
    dataClassification: input.dataClassification,
    evidenceRefs: input.sourceRefs,
    audience,
    sourcePrincipal: speakers.length === 1 ? speakers[0] : null,
    subject: null,
    protectionBasisRefs: evidence.map((row) => row.rowId),
    protectionStatus: "admitted",
    licenseRefs: [],
    thoughtInterpretationRef: input.lineageParentKey ?? input.sourceRefs[0] ?? "social-interpretation",
    lineageParentKey: input.lineageParentKey,
  });
}

function equivalentRevision(
  db: DatabaseSync,
  input: ExternalSocialRevisionInput,
  prepared: PreparedExternalSocialRevision,
): MemoryAssertion | null {
  const rows = db.prepare(
    `SELECT assertion_key FROM sidecar_memory_assertions
      WHERE statement = ? AND memory_kind = ? AND live = 1
      ORDER BY assertion_key ASC`,
  ).all(input.statement.trim(), input.memoryKind) as Array<{ assertion_key?: unknown }>;
  for (const row of rows) {
    const assertionKey = text(row.assertion_key);
    if (!assertionKey) continue;
    const existing = getMemoryAssertion(db, assertionKey);
    if (!existing || !sameAudience(existing.audienceScope, input.audience)) continue;
    if (existing.lineageParentKey !== (input.lineageParentKey ?? null)) continue;
    if (JSON.stringify(existing.dimensions) !== JSON.stringify(input.dimensions)) continue;
    if (existing.dataClassification !== prepared.effectiveClassification) continue;
    if (existing.sourcePrincipal !== prepared.facets.sourcePrincipal) continue;
    if (JSON.stringify(existing.subject ?? null) !== JSON.stringify(prepared.facets.subject ?? null)) continue;
    if (existing.sourceEvidenceRef !== prepared.facets.sourceEvidenceRef) continue;
    if (JSON.stringify(existing.protectionBasisRefs ?? []) !== JSON.stringify(prepared.facets.protectionBasisRefs)) continue;
    if (existing.protectionStatus !== prepared.facets.protectionStatus) continue;
    if (JSON.stringify(existing.licenseRefs ?? []) !== JSON.stringify(prepared.facets.licenseRefs)) continue;
    return existing;
  }
  return null;
}

export type ExternalSocialRevisionResult = Readonly<{
  status: "admitted" | "unresolved";
  assertion: MemoryAssertion | null;
  evidenceRowIds: readonly string[];
  reason?: string;
}>;

/**
 * Admit a Thought-authored social revision. Validation happens before the
 * transaction; any failed validation leaves the captured evidence untouched.
 */
export function admitExternalSocialRevision(
  db: DatabaseSync,
  input: ExternalSocialRevisionInput,
): ExternalSocialRevisionResult {
  const prepared = prepareExternalSocialRevision(db, input);
  if (!prepared.ok) {
    return { status: "unresolved", assertion: null, evidenceRowIds: [], reason: prepared.reason };
  }
  const evidenceRowIds = prepared.value.evidence.map((row) => row.rowId);
  const equivalent = equivalentRevision(db, input, prepared.value);
  if (equivalent) return { status: "admitted", assertion: equivalent, evidenceRowIds };
  const admittedGeneration = integer(input.admittedGeneration);
  if (admittedGeneration == null || admittedGeneration < 1) {
    return { status: "unresolved", assertion: null, evidenceRowIds, reason: "social_revision_generation_invalid" };
  }
  const nowMs = input.nowMs ?? Date.now();
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const assertion = upsertMemoryAssertion(db, {
      assertionKey: input.assertionKey,
      statement: input.statement.trim(),
      memoryKind: input.memoryKind,
      dimensions: input.dimensions,
      dataClassification: prepared.value.effectiveClassification,
      lineageParentKey: input.lineageParentKey ?? null,
      admittedGeneration,
      live: true,
      ...prepared.value.facets,
    });
    for (const row of prepared.value.evidence) {
      appendMemorySupport(db, {
        supportId: `social:evidence:${input.assertionKey}:${row.rowId}`,
        assertionKey: input.assertionKey,
        source: "perception",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: row.rowId,
        settlementId: input.settlementId ?? null,
        evidenceLineageId: row.lineageId,
        observationId: null,
        receiptId: null,
        dimensions: {
          source: "perception",
          status: "asserted",
          time: "historical",
          reliability: "fallible_observation",
        },
        dataClassification: row.dataClassification,
        createdAtMs: row.createdAtMs,
      });
    }
    appendMemorySupport(db, {
      supportId: `social:interpretation:${input.assertionKey}`,
      assertionKey: input.assertionKey,
      source: "ashley_interpretation",
      provenance: "native",
      sourceArchitectureEpoch: "v0.2.1",
      sourceRef: input.thoughtInterpretationRef.trim(),
      settlementId: input.settlementId ?? null,
      evidenceLineageId: prepared.value.evidence[0].lineageId,
      observationId: null,
      receiptId: null,
      dimensions: input.dimensions,
      dataClassification: prepared.value.effectiveClassification,
      createdAtMs: nowMs,
    });
    if (input.lineageParentKey && input.lineageParentKey !== input.assertionKey) {
      db.prepare(
        "UPDATE sidecar_memory_assertions SET live = 0, admitted_generation = NULL WHERE assertion_key = ? AND live = 1",
      ).run(input.lineageParentKey);
    }
    db.exec("COMMIT");
    transactionOpen = false;
    try { notifySidecarPostCommit(db, { changedAssertionKeys: [input.assertionKey, ...(input.lineageParentKey ? [input.lineageParentKey] : [])] }); } catch { /* derived views are best effort */ }
    return { status: "admitted", assertion, evidenceRowIds };
  } catch (error) {
    if (transactionOpen) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the unresolved result */ }
    }
    return {
      status: "unresolved",
      assertion: null,
      evidenceRowIds,
      reason: error instanceof Error ? "social_revision_write_failed" : "social_revision_write_failed",
    };
  }
}

export const writeExternalSocialRevision = admitExternalSocialRevision;
