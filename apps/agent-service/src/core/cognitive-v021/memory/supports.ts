import type { DatabaseSync } from "node:sqlite";
import {
  defaultUnclassifiedConversational,
  type DataClassification,
} from "../../privacy/classification.js";
import type {
  EpistemicDimensions,
  EpistemicSource,
  MemorySupport,
  MemorySupportProvenance,
} from "../types.js";

type DbRow = Record<string, unknown>;

export type AppendMemorySupportInput = Omit<MemorySupport, "createdAtMs"> & {
  createdAtMs?: number;
};

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function classification(value: unknown): DataClassification {
  return value === "ordinary" || value === "sensitive" || value === "never_public" || value === "secret"
    ? value
    : defaultUnclassifiedConversational();
}

function mapSupport(value: unknown): MemorySupport | null {
  if (!isRow(value)) return null;
  const source = text(value.source) as EpistemicSource;
  const provenance = text(value.provenance) as MemorySupportProvenance;
  const sourceArchitectureEpoch = text(value.source_architecture_epoch);
  const dimensions = parsedJson(value.dimensions_json);
  if (!dimensions || (provenance !== "native" && provenance !== "legacy_import")) return null;
  return {
    supportId: text(value.support_id),
    assertionKey: text(value.assertion_key),
    source,
    provenance,
    sourceArchitectureEpoch: sourceArchitectureEpoch === "legacy" ? "legacy" : "v0.2.1",
    sourceRef: value.source_ref == null ? null : text(value.source_ref),
    settlementId: value.settlement_id == null ? null : text(value.settlement_id),
    evidenceLineageId: value.evidence_lineage_id == null ? null : text(value.evidence_lineage_id),
    observationId: value.observation_id == null ? null : text(value.observation_id),
    receiptId: value.receipt_id == null ? null : text(value.receipt_id),
    dimensions: dimensions as EpistemicDimensions,
    dataClassification: classification(value.data_classification),
    createdAtMs: number(value.created_at_ms),
  };
}

export function appendMemorySupport(
  db: DatabaseSync,
  input: AppendMemorySupportInput,
): MemorySupport {
  if (!input.supportId.trim()) throw new Error("memory_support_id_required");
  if (!input.assertionKey.trim()) throw new Error("memory_support_assertion_key_required");
  db.prepare(
    `INSERT OR IGNORE INTO sidecar_memory_supports
       (support_id, assertion_key, source, provenance, source_architecture_epoch,
        source_ref, settlement_id, evidence_lineage_id, observation_id, receipt_id,
        dimensions_json, data_classification, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.supportId,
    input.assertionKey,
    input.source,
    input.provenance,
    input.sourceArchitectureEpoch,
    input.sourceRef,
    input.settlementId,
    input.evidenceLineageId,
    input.observationId,
    input.receiptId,
    JSON.stringify(input.dimensions),
    input.dataClassification,
    input.createdAtMs ?? Date.now(),
  );
  const row = db.prepare("SELECT * FROM sidecar_memory_supports WHERE support_id = ?").get(input.supportId);
  const result = mapSupport(row);
  if (!result) throw new Error("memory_support_insert_lost");
  return result;
}

export function getMemorySupport(db: DatabaseSync, supportId: string): MemorySupport | null {
  return mapSupport(db.prepare("SELECT * FROM sidecar_memory_supports WHERE support_id = ?").get(supportId));
}

export function listMemorySupports(
  db: DatabaseSync,
  assertionKey?: string,
): MemorySupport[] {
  const rows = assertionKey == null
    ? db.prepare("SELECT * FROM sidecar_memory_supports ORDER BY created_at_ms ASC, support_id ASC").all()
    : db.prepare("SELECT * FROM sidecar_memory_supports WHERE assertion_key = ? ORDER BY created_at_ms ASC, support_id ASC").all(assertionKey);
  return rows.map(mapSupport).filter((row): row is MemorySupport => row !== null);
}

export const listSupports = listMemorySupports;
