import { createHash, randomUUID } from "node:crypto";

/** RFC 4122 UUID version 5 from a namespace UUID + name. */
export function uuidV5(namespaceUuid: string, name: string): string {
  const nsHex = namespaceUuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(nsHex)) {
    throw new Error("invalid_uuid_namespace");
  }
  const ns = Buffer.from(nsHex, "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function newEntityUuid(): string {
  return randomUUID();
}

/** Deterministic legacy backfill: lineage namespace + entity type + integer PK. */
export function legacyEntityUuid(
  lineageUuid: string,
  entityType: string,
  legacyId: number | string,
): string {
  return uuidV5(lineageUuid, `${entityType}:${legacyId}`);
}

/** Stable namespaced id for external archival rows (e.g. index.db). */
export function archivalEntityUuid(
  lineageUuid: string,
  archive: string,
  legacyKey: string,
): string {
  return uuidV5(lineageUuid, `archive:${archive}:${legacyKey}`);
}
