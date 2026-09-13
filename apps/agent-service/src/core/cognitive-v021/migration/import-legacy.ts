import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import {
  defaultUnclassifiedConversational,
  mapLegacySensitivity,
} from "../../privacy/classification.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "../../privacy/secrets.js";
import {
  appendAshleyEvidence,
  appendOwnerUtterance,
  appendSystemEvent,
} from "../evidence/conversation-log.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { isReservedProductionStoragePath } from "../../data-plane.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { appendMemorySupport } from "../memory/supports.js";
import type { EpistemicDimensions, MemoryKind } from "../types.js";

type Row = Record<string, unknown>;

export type LegacyImportMode = "dry-run" | "apply" | "verify";

export type LegacyImportCounts = {
  messages: number;
  assertions: number;
  supports: number;
  concerns: number;
  occupancy: number;
};

export type LegacyImportReport = {
  mode: LegacyImportMode;
  counts: LegacyImportCounts;
  duplicateCount: number;
  sourceHash: string;
  verified: boolean;
};

export type LegacyImportDatabases = {
  nuclear: DatabaseSync;
  continuity?: DatabaseSync;
  sidecar: DatabaseSync;
  mode: LegacyImportMode;
  nuclearPath?: string;
  continuityPath?: string;
  sidecarPath?: string;
};

export type LegacyImportPaths = {
  nuclearPath: string;
  continuityPath: string;
  sidecarPath: string;
  mode: LegacyImportMode;
};

export class LegacyImportError extends Error {
  readonly code: "INPUT_UNREADABLE" | "SCHEMA_UNSUPPORTED" | "COUNT_MISMATCH" | "HASH_MISMATCH" | "PROVENANCE_MISMATCH" | "RESERVED_PATH_REFUSED";

  constructor(code: LegacyImportError["code"], message: string = code) {
    super(message);
    this.name = "LegacyImportError";
    this.code = code;
  }
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1").get(name) !== undefined;
}

function columns(db: DatabaseSync, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().flatMap((row) => isRow(row) && typeof row.name === "string" ? [row.name] : []));
}

function rows(db: DatabaseSync, table: string): Row[] {
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${table}`).all().filter(isRow);
}

function databasePath(db: DatabaseSync | undefined): string {
  if (!db) return "";
  const row = db.prepare("PRAGMA database_list").all().find((item) => isRow(item) && item.name === "main");
  return isRow(row) ? text(row.file) : "";
}

function assertSafePath(path: string | undefined): void {
  if (path && isReservedProductionStoragePath(path)) throw new LegacyImportError("RESERVED_PATH_REFUSED", path);
}

function assertSafeDatabases(input: LegacyImportDatabases): void {
  for (const path of [input.nuclearPath, input.continuityPath, input.sidecarPath, databasePath(input.nuclear), databasePath(input.continuity), databasePath(input.sidecar)]) {
    assertSafePath(path);
  }
}

function classification(value: unknown): DataClassification {
  if (value === "ordinary" || value === "sensitive" || value === "never_public" || value === "secret") return value;
  if (value === "none" || value === "private") return mapLegacySensitivity(value) ?? defaultUnclassifiedConversational();
  return defaultUnclassifiedConversational();
}

function normalizeText(value: unknown, requestedClassification: DataClassification): { text: string; dataClassification: DataClassification; secretOmitted: boolean } {
  const source = value == null ? "" : text(value);
  const secret = detectCredentialShape(source).hit || requestedClassification === "secret";
  return secret
    ? { text: CREDENTIAL_OMITTED_PLACEHOLDER, dataClassification: "secret", secretOmitted: true }
    : { text: source, dataClassification: requestedClassification, secretOmitted: false };
}

function messageRole(value: unknown): "owner" | "ashley" | "system" {
  const role = text(value).toLowerCase();
  if (role === "user" || role === "owner") return "owner";
  if (role === "assistant" || role === "ashley") return "ashley";
  return "system";
}

function messageLineage(row: Row, id: string): string {
  const entity = text(row.entity_uuid);
  return entity ? `legacy:message:${entity}` : `legacy:message:${id}`;
}

function messageIds(row: Row, rowColumns: Set<string>): string[] {
  const result: string[] = [];
  if (rowColumns.has("discord_message_id") && text(row.discord_message_id)) result.push(text(row.discord_message_id));
  if (rowColumns.has("discord_message_ids_json")) {
    try {
      const parsed = JSON.parse(text(row.discord_message_ids_json, "[]"));
      if (Array.isArray(parsed)) result.push(...parsed.filter((id): id is string => typeof id === "string"));
    } catch {
      // Ignore malformed optional historical ids; the deterministic fallback remains.
    }
  }
  return [...new Set(result)];
}

function sourceFor(row: Row): EpistemicDimensions {
  const raw = text(row.source_kind || row.source || row.provenance).toLowerCase();
  const source = raw.includes("owner") || raw.includes("user") || raw.includes("message") || row.source_message_id != null
    ? "owner_utterance"
    : raw.includes("tool")
      ? "tool"
      : raw.includes("perception")
        ? "perception"
        : raw.includes("receipt")
          ? "receipt"
          : raw.includes("settlement")
            ? "prior_settlement"
            : "ashley_interpretation";
  return {
    source,
    status: text(row.termination_reason).toLowerCase() === "superseded" ? "superseded" : "asserted",
    time: "historical",
    reliability: source === "owner_utterance" ? "owner_supplied" : source === "receipt" ? "receipt_backed" : source === "ashley_interpretation" ? "inferred" : "fallible_observation",
  };
}

type ImportedMessage = {
  id: string;
  lineageId: string;
  conversationId: string;
  role: "owner" | "ashley" | "system";
  text: string;
  dataClassification: DataClassification;
  secretOmitted: boolean;
  discordMessageIds: string[];
};

function importedMessages(nuclear: DatabaseSync): ImportedMessage[] {
  const messageColumns = columns(nuclear, "mem_messages");
  return rows(nuclear, "mem_messages").map((row, index) => {
    const id = text(row.id, String(index + 1));
    const requested = classification(row.data_classification ?? row.sensitivity);
    const normalized = normalizeText(row.text, requested);
    return {
      id,
      lineageId: messageLineage(row, id),
      conversationId: text(row.thread_id, `legacy:${text(row.owner_id, "unknown")}`),
      role: messageRole(row.role),
      text: normalized.text,
      dataClassification: normalized.dataClassification,
      secretOmitted: normalized.secretOmitted,
      discordMessageIds: messageIds(row, messageColumns),
    };
  });
}

type ImportedAssertion = {
  assertionKey: string;
  statement: string;
  memoryKind: MemoryKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  sourceRef: string;
  supportId: string;
};

function assertionStatement(row: Row): string {
  const claim = text(row.claim_text || row.statement);
  if (claim) return claim;
  const key = text(row.key);
  const value = text(row.value);
  if (key || value) return `${key}${key && value ? ": " : ""}${value}`;
  return text(row.text);
}

function assertionKind(row: Row): MemoryKind {
  const kind = text(row.kind).toLowerCase();
  if (kind === "owner_interpretation" || kind === "ashley_interpretation") return "ashley_interpretation";
  const category = text(row.category).toLowerCase();
  if (category === "preference") return "owner_preference";
  if (category === "ongoing") return "owner_goal";
  return "owner_world_claim";
}

function importedAssertions(nuclear: DatabaseSync): ImportedAssertion[] {
  const sourceTable = tableExists(nuclear, "memory_assertions") && rows(nuclear, "memory_assertions").length > 0 ? "memory_assertions" : "mem_facts";
  return rows(nuclear, sourceTable).flatMap((row, index) => {
    const id = text(row.entity_uuid || row.id, String(index + 1));
    const rawStatement = assertionStatement(row);
    if (!rawStatement) return [];
    const normalized = normalizeText(rawStatement, classification(row.data_classification ?? row.sensitivity));
    const dimensions = sourceFor(row);
    return [{
      assertionKey: `legacy:${sourceTable === "mem_facts" ? "fact" : "assertion"}:${id}`,
      statement: normalized.text,
      memoryKind: assertionKind(row),
      dimensions,
      dataClassification: normalized.dataClassification,
      sourceRef: id,
      supportId: `legacy-support:${sourceTable}:${id}`,
    }];
  });
}

type ImportedMindState = {
  id: string;
  conversationId: string;
  statement: string;
  priority: number;
};

function importedMindState(nuclear: DatabaseSync): ImportedMindState[] {
  return rows(nuclear, "mind_state_items")
    .filter((row) => text(row.status, "active") === "active")
    .map((row, index) => ({
      id: text(row.id, String(index + 1)),
      conversationId: text(row.conversation_id || row.owner_id, `legacy:${text(row.owner_id, "unknown")}`),
      statement: normalizeText(row.text, classification(row.data_classification ?? row.sensitivity)).text,
      priority: Math.round(Math.max(0, number(row.urgency, number(row.activation, 0))) * 100),
    }));
}

function sourceHash(input: { messages: ImportedMessage[]; assertions: ImportedAssertion[]; mind: ImportedMindState[] }): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function existingEvidence(db: DatabaseSync, message: ImportedMessage): Row | undefined {
  const lineage = db.prepare("SELECT * FROM conversation_evidence_log WHERE lineage_id = ? AND version = 1 LIMIT 1").get(message.lineageId) as Row | undefined;
  if (lineage) return lineage;
  for (const id of message.discordMessageIds) {
    const byDiscord = db.prepare(
      `SELECT e.* FROM conversation_evidence_discord_ids d
       JOIN conversation_evidence_log e ON e.lineage_id = d.lineage_id
       WHERE d.discord_message_id = ? LIMIT 1`,
    ).get(id) as Row | undefined;
    if (byDiscord) return byDiscord;
  }
  return db.prepare(
    "SELECT * FROM conversation_evidence_log WHERE conversation_id = ? AND role = ? AND text = ? LIMIT 1",
  ).get(message.conversationId, message.role, message.text) as Row | undefined;
}

function existingAssertion(db: DatabaseSync, key: string): Row | undefined {
  return db.prepare("SELECT * FROM sidecar_memory_assertions WHERE assertion_key = ? LIMIT 1").get(key) as Row | undefined;
}

function existingSupport(db: DatabaseSync, supportId: string): Row | undefined {
  return db.prepare("SELECT * FROM sidecar_memory_supports WHERE support_id = ? LIMIT 1").get(supportId) as Row | undefined;
}

function applyMessage(db: DatabaseSync, message: ImportedMessage): boolean {
  if (existingEvidence(db, message)) return false;
  const input = {
    conversationId: message.conversationId,
    text: message.text,
    discordMessageIds: message.discordMessageIds,
    lineageId: message.lineageId,
    version: 1,
    architectureEpoch: "legacy",
    sourceStatus: "legacy_import",
    dataClassification: message.dataClassification,
    delivered: message.role === "ashley",
  };
  if (message.role === "owner") appendOwnerUtterance(db, input);
  else if (message.role === "ashley") appendAshleyEvidence(db, input);
  else appendSystemEvent(db, input);
  return true;
}

function applyAssertion(db: DatabaseSync, assertion: ImportedAssertion): { assertionNew: boolean; supportNew: boolean } {
  const existing = existingAssertion(db, assertion.assertionKey);
  const assertionNew = !existing;
  upsertMemoryAssertion(db, {
    assertionKey: assertion.assertionKey,
    statement: assertion.statement,
    memoryKind: assertion.memoryKind,
    dimensions: assertion.dimensions,
    dataClassification: assertion.dataClassification,
    lineageParentKey: null,
    admittedGeneration: null,
    live: false,
  });
  const supportNew = !existingSupport(db, assertion.supportId);
  appendMemorySupport(db, {
    supportId: assertion.supportId,
    assertionKey: assertion.assertionKey,
    source: assertion.dimensions.source,
    provenance: "legacy_import",
    sourceArchitectureEpoch: "legacy",
    sourceRef: assertion.sourceRef,
    settlementId: null,
    evidenceLineageId: null,
    observationId: null,
    receiptId: null,
    dimensions: assertion.dimensions,
    dataClassification: assertion.dataClassification,
    createdAtMs: 0,
  });
  return { assertionNew, supportNew };
}

function applyMindState(db: DatabaseSync, mind: ImportedMindState): { concernNew: boolean; occupancyNew: boolean } {
  const concernId = `legacy:concern:${mind.id}`;
  const existing = db.prepare("SELECT concern_id FROM concerns WHERE concern_id = ?").get(concernId);
  const concernNew = !existing;
  if (concernNew) {
    const snapshotHash = createHash("sha256").update(`${concernId}\u0000${mind.statement}`, "utf8").digest("hex");
    db.prepare(
      `INSERT INTO concerns
         (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
          assertion_key, status, snapshot_hash, updated_cycle)
       VALUES (?, ?, ?, '[]', ?, NULL, 'quarantined', ?, NULL)`,
    ).run(concernId, mind.conversationId, mind.statement, JSON.stringify({ source: "prior_settlement", status: "unverified", time: "historical", reliability: "unavailable_source" }), snapshotHash);
  }
  const occupancy = db.prepare("SELECT 1 AS present FROM mind_occupancy WHERE conversation_id = ? AND concern_id = ?").get(mind.conversationId, concernId);
  const occupancyNew = !occupancy;
  if (occupancyNew) {
    db.prepare(
      `INSERT INTO mind_occupancy
         (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
       VALUES (?, ?, 'quarantined', ?, 'legacy-import', 0)`,
    ).run(mind.conversationId, concernId, mind.priority);
  }
  return { concernNew, occupancyNew };
}

function verifyImported(
  db: DatabaseSync,
  messages: ImportedMessage[],
  assertions: ImportedAssertion[],
  mind: ImportedMindState[],
): void {
  const messageCount = messages.filter((message) => existingEvidence(db, message)).length;
  const assertionCount = assertions.filter((assertion) => existingAssertion(db, assertion.assertionKey)).length;
  const supportCount = assertions.filter((assertion) => existingSupport(db, assertion.supportId)).length;
  const concernCount = mind.filter((item) => db.prepare("SELECT 1 AS present FROM concerns WHERE concern_id = ?").get(`legacy:concern:${item.id}`)).length;
  const occupancyCount = mind.filter((item) => db.prepare("SELECT 1 AS present FROM mind_occupancy WHERE conversation_id = ? AND concern_id = ?").get(item.conversationId, `legacy:concern:${item.id}`)).length;
  if (messageCount !== messages.length || assertionCount !== assertions.length || supportCount !== assertions.length || concernCount !== mind.length || occupancyCount !== mind.length) {
    throw new LegacyImportError("COUNT_MISMATCH", JSON.stringify({ messageCount, assertionCount, supportCount, concernCount, occupancyCount }));
  }
  for (const message of messages) {
    const row = existingEvidence(db, message);
    if (!row || text(row.text) !== message.text || text(row.data_classification) !== message.dataClassification || text(row.source_status) !== "legacy_import") throw new LegacyImportError("HASH_MISMATCH", `message:${message.id}`);
  }
  for (const assertion of assertions) {
    const row = existingAssertion(db, assertion.assertionKey);
    if (!row || text(row.statement) !== assertion.statement || text(row.memory_kind) !== assertion.memoryKind || text(row.data_classification) !== assertion.dataClassification || number(row.live) !== 0 || row.admitted_generation != null) throw new LegacyImportError("HASH_MISMATCH", `assertion:${assertion.assertionKey}`);
    const support = existingSupport(db, assertion.supportId);
    if (!support || text(support.provenance) !== "legacy_import" || text(support.source_architecture_epoch) !== "legacy" || text(support.source) !== assertion.dimensions.source) throw new LegacyImportError("PROVENANCE_MISMATCH", assertion.supportId);
  }
}

export function importLegacySemanticState(input: LegacyImportDatabases): LegacyImportReport {
  assertSafeDatabases(input);
  if (!tableExists(input.sidecar, "cognitive_sidecar_meta")) {
    if (input.mode === "dry-run") throw new LegacyImportError("SCHEMA_UNSUPPORTED", "sidecar_schema_missing_for_read_only_dry_run");
    openCognitiveSidecarDb(input.sidecar, { dataPlane: { kind: "isolated" } });
  }
  const messages = importedMessages(input.nuclear);
  const assertions = importedAssertions(input.nuclear);
  const mind = importedMindState(input.nuclear);
  if (!tableExists(input.nuclear, "mem_messages") && !tableExists(input.nuclear, "mem_facts") && !tableExists(input.nuclear, "memory_assertions")) {
    throw new LegacyImportError("SCHEMA_UNSUPPORTED", "legacy_semantic_tables_missing");
  }
  const hash = sourceHash({ messages, assertions, mind });
  const counts: LegacyImportCounts = { messages: 0, assertions: 0, supports: 0, concerns: 0, occupancy: 0 };
  let duplicateCount = 0;

  if (input.mode === "verify") {
    verifyImported(input.sidecar, messages, assertions, mind);
    return { mode: input.mode, counts: { messages: messages.length, assertions: assertions.length, supports: assertions.length, concerns: mind.length, occupancy: mind.length }, duplicateCount: 0, sourceHash: hash, verified: true };
  }

  for (const message of messages) {
    if (input.mode === "dry-run") {
      if (existingEvidence(input.sidecar, message)) duplicateCount += 1;
      else counts.messages += 1;
    } else if (applyMessage(input.sidecar, message)) counts.messages += 1;
    else duplicateCount += 1;
  }
  for (const assertion of assertions) {
    if (input.mode === "dry-run") {
      if (existingAssertion(input.sidecar, assertion.assertionKey)) duplicateCount += 1;
      else counts.assertions += 1;
      if (existingSupport(input.sidecar, assertion.supportId)) duplicateCount += 1;
      else counts.supports += 1;
    } else {
      const result = applyAssertion(input.sidecar, assertion);
      if (result.assertionNew) counts.assertions += 1; else duplicateCount += 1;
      if (result.supportNew) counts.supports += 1; else duplicateCount += 1;
    }
  }
  for (const item of mind) {
    if (input.mode === "dry-run") {
      const concern = input.sidecar.prepare("SELECT 1 AS present FROM concerns WHERE concern_id = ?").get(`legacy:concern:${item.id}`);
      const occupancy = input.sidecar.prepare("SELECT 1 AS present FROM mind_occupancy WHERE conversation_id = ? AND concern_id = ?").get(item.conversationId, `legacy:concern:${item.id}`);
      if (concern) duplicateCount += 1; else counts.concerns += 1;
      if (occupancy) duplicateCount += 1; else counts.occupancy += 1;
    } else {
      const result = applyMindState(input.sidecar, item);
      if (result.concernNew) counts.concerns += 1; else duplicateCount += 1;
      if (result.occupancyNew) counts.occupancy += 1; else duplicateCount += 1;
    }
  }
  return { mode: input.mode, counts, duplicateCount, sourceHash: hash, verified: false };
}

export function importLegacySemanticStateFromPaths(input: LegacyImportPaths): LegacyImportReport {
  for (const path of [input.nuclearPath, input.continuityPath, input.sidecarPath]) {
    if (isReservedProductionStoragePath(path)) throw new LegacyImportError("RESERVED_PATH_REFUSED", path);
    if (!existsSync(path)) throw new LegacyImportError("INPUT_UNREADABLE", path);
  }
  const nuclear = new DatabaseSync(input.nuclearPath, { readOnly: true });
  const continuity = new DatabaseSync(input.continuityPath, { readOnly: true });
  const sidecar = input.mode === "dry-run"
    ? new DatabaseSync(input.sidecarPath, { readOnly: true })
    : new DatabaseSync(input.sidecarPath);
  try {
    if (input.mode !== "dry-run") openCognitiveSidecarDb(sidecar, { dataPlane: { kind: "isolated" } });
    return importLegacySemanticState({ nuclear, continuity, sidecar, mode: input.mode, nuclearPath: input.nuclearPath, continuityPath: input.continuityPath, sidecarPath: input.sidecarPath });
  } finally {
    nuclear.close();
    continuity.close();
    sidecar.close();
  }
}
