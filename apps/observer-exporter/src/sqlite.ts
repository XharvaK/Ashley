import { backup, DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { observerError } from "./errors.js";

export function openReadOnlyDatabase(path: string): DatabaseSync {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw observerError(
      "sqlite_open_failed",
      `sqlite_open_failed:${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

export async function backupDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const source = openReadOnlyDatabase(sourcePath);
  try {
    await backup(source, destinationPath, { rate: 100 });
  } catch (error) {
    throw observerError(
      "sqlite_backup_failed",
      `sqlite_backup_failed:${error instanceof Error ? error.message : "unknown"}`,
    );
  } finally {
    source.close();
  }
}

export function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(table) as { present?: number } | undefined;
  return row?.present === 1;
}

export function tableColumns(db: DatabaseSync, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return new Set(
    (db.prepare(`PRAGMA table_info(${quoted})`).all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

export function pragmaUserVersion(db: DatabaseSync): number | "UNKNOWN" {
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version?: unknown };
    return typeof row.user_version === "number" && Number.isSafeInteger(row.user_version)
      ? row.user_version
      : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export function scalarJson(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  return value == null ? null : String(value);
}

export function allowlistedRows(
  db: DatabaseSync,
  table: string,
  fields: string[],
  options: {
    orderBy?: string;
    limit?: number;
    where?: { sql: string; args: readonly (string | number)[] };
  } = {},
): Array<Record<string, unknown>> {
  const available = tableColumns(db, table);
  if (available.size === 0) return [];
  const selected = fields.filter((field) => available.has(field));
  if (selected.length === 0) return [];
  const quotedTable = `"${table.replaceAll('"', '""')}"`;
  const quotedFields = selected.map((field) => `"${field.replaceAll('"', '""')}"`).join(", ");
  let sql = `SELECT ${quotedFields} FROM ${quotedTable}`;
  const args: Array<string | number> = options.where ? [...options.where.args] : [];
  if (options.where) sql += ` WHERE ${options.where.sql}`;
  if (options.orderBy && available.has(options.orderBy)) {
    sql += ` ORDER BY "${options.orderBy.replaceAll('"', '""')}" ASC`;
  }
  if (options.limit != null) sql += ` LIMIT ${Math.max(0, Math.floor(options.limit))}`;
  try {
    return (db.prepare(sql).all(...args) as Array<Record<string, unknown>>).map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, scalarJson(value)])),
    );
  } catch (error) {
    throw observerError(
      "sqlite_query_failed",
      `sqlite_query_failed:${table}:${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
