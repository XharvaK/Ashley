// E1 (User 2026-10-06: her space lives on Mint): a folder of her own where she keeps what she
// chooses: notes, lists, drafts, a reading log, anything. She sees what is there each turn, reads a
// file with home.read, and changes it through her settlement (write, append, mkdir, move, delete).
// The Host only keeps the folder sound: paths stay inside it, sizes stay bounded, a delete moves
// the file to .trash (nothing is lost), and keys or passwords never go here (they belong in her vault).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { detectCredentialShape } from "../privacy/secrets.js";

export const HOME_OPS_MAX = 8;
export const HOME_FILE_MAX_BYTES = 64 * 1024;
export const HOME_APPEND_FILE_MAX_BYTES = 512 * 1024;
export const HOME_TOTAL_MAX_BYTES = 50 * 1024 * 1024;
export const HOME_LIST_LIMIT = 80;
export const HOME_READ_MAX_CHARS = 32_768;
export const HOME_TRASH = ".trash";

export type HomeOp =
  | { op: "write" | "append"; path: string; content: string }
  | { op: "mkdir" | "delete"; path: string }
  | { op: "move"; path: string; to: string };
export type HomeOpResult = { op: HomeOp["op"]; path: string; ok: boolean; reason?: string };
export type HomeEntry = { path: string; kind: "file" | "dir"; bytes?: number; modifiedAtMs: number };
export type ThoughtHome = { files: HomeEntry[]; totalBytes: number; omitted?: number; recentOps?: Array<HomeOpResult & { atMs: number }> };

type Row = Record<string, unknown>;

export function homeRootFor(dataDir: string): string {
  return join(dataDir, "home");
}

function ensureRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
}

/** A path inside her home, or null. Segments of letters, digits, space and . _ - ( ); no "..", depth <= 8. */
export function normalizeHomePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned || cleaned.length > 240) return null;
  const parts = cleaned.split("/");
  if (parts.length > 8) return null;
  for (const part of parts) {
    if (!part || part === "." || part === ".." || !/^[\p{L}\p{N} ._()\-]{1,80}$/u.test(part)) return null;
  }
  return parts.join("/");
}

export function isHomeOps(value: unknown): value is HomeOp[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > HOME_OPS_MAX) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const op = item as Row;
    const keys = Object.keys(op);
    if (typeof op.path !== "string" || op.path.length < 1 || op.path.length > 240) return false;
    if (op.op === "write" || op.op === "append") {
      return keys.every(key => ["op", "path", "content"].includes(key)) && typeof op.content === "string"
        && Buffer.byteLength(op.content, "utf8") <= HOME_FILE_MAX_BYTES;
    }
    if (op.op === "mkdir" || op.op === "delete") return keys.every(key => ["op", "path"].includes(key));
    if (op.op === "move") return keys.every(key => ["op", "path", "to"].includes(key)) && typeof op.to === "string" && op.to.length <= 240;
    return false;
  });
}

function walk(root: string, dir: string, out: HomeEntry[]): void {
  for (const name of readdirSync(dir).sort()) {
    if (dir === root && name === HOME_TRASH) continue;
    const full = join(dir, name);
    const stats = statSync(full);
    const path = relative(root, full).split(sep).join("/");
    if (stats.isDirectory()) {
      out.push({ path, kind: "dir", modifiedAtMs: Math.round(stats.mtimeMs) });
      walk(root, full, out);
    } else if (stats.isFile()) {
      out.push({ path, kind: "file", bytes: stats.size, modifiedAtMs: Math.round(stats.mtimeMs) });
    }
  }
}

export function listHome(root: string): { entries: HomeEntry[]; totalBytes: number } {
  ensureRoot(root);
  const entries: HomeEntry[] = [];
  walk(root, root, entries);
  return { entries, totalBytes: entries.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) };
}

export function readHomeFile(root: string, path: string): { path: string; text: string; truncated: boolean; bytes: number; modifiedAtMs: number } {
  const normalized = normalizeHomePath(path);
  if (!normalized) throw new Error("home_path_invalid");
  const full = join(root, normalized);
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error("home_file_missing");
  const stats = statSync(full);
  const text = readFileSync(full, "utf8");
  return { path: normalized, text: text.slice(0, HOME_READ_MAX_CHARS), truncated: text.length > HOME_READ_MAX_CHARS,
    bytes: stats.size, modifiedAtMs: Math.round(stats.mtimeMs) };
}

function applyOne(root: string, op: HomeOp, nowMs: number): HomeOpResult {
  const path = normalizeHomePath(op.path);
  const result = (ok: boolean, reason?: string): HomeOpResult => ({ op: op.op, path: path ?? String(op.path).slice(0, 240), ok, ...(reason ? { reason } : {}) });
  if (!path) return result(false, "path_invalid");
  if (path === HOME_TRASH || path.startsWith(`${HOME_TRASH}/`)) return result(false, "trash_is_kept");
  const full = join(root, path);
  try {
    if (op.op === "mkdir") {
      if (existsSync(full) && !statSync(full).isDirectory()) return result(false, "a_file_has_this_name");
      mkdirSync(full, { recursive: true, mode: 0o700 });
      return result(true);
    }
    if (op.op === "write" || op.op === "append") {
      if (detectCredentialShape(op.content).hit) return result(false, "looks_like_a_secret");
      if (existsSync(full) && statSync(full).isDirectory()) return result(false, "a_folder_has_this_name");
      const current = existsSync(full) ? statSync(full).size : 0;
      const added = Buffer.byteLength(op.content, "utf8");
      const next = op.op === "write" ? added : current + added;
      if (next > (op.op === "write" ? HOME_FILE_MAX_BYTES : HOME_APPEND_FILE_MAX_BYTES)) return result(false, "file_too_large");
      if (listHome(root).totalBytes - (op.op === "write" ? current : 0) + added > HOME_TOTAL_MAX_BYTES) return result(false, "home_full");
      mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
      if (op.op === "write") writeFileSync(full, op.content, { encoding: "utf8", mode: 0o600 });
      else appendFileSync(full, op.content, { encoding: "utf8", mode: 0o600 });
      return result(true);
    }
    if (!existsSync(full)) return result(false, "not_found");
    if (op.op === "move") {
      const to = normalizeHomePath(op.to);
      if (!to || to === HOME_TRASH || to.startsWith(`${HOME_TRASH}/`)) return result(false, "target_invalid");
      if (existsSync(join(root, to))) return result(false, "target_exists");
      mkdirSync(dirname(join(root, to)), { recursive: true, mode: 0o700 });
      renameSync(full, join(root, to));
      return result(true);
    }
    const trash = join(root, HOME_TRASH);
    mkdirSync(trash, { recursive: true, mode: 0o700 });
    renameSync(full, join(trash, `${nowMs}-${basename(path)}`));
    return result(true);
  } catch {
    return result(false, "filesystem_error");
  }
}

/** Apply her ops in order, once per op: an op whose result is already recorded for this cycle is skipped on replay. */
export function applyHomeOps(sidecar: DatabaseSync, root: string, input: { cycleId: string; ops: readonly HomeOp[]; nowMs: number }): HomeOpResult[] {
  ensureRoot(root);
  const done = sidecar.prepare("SELECT 1 FROM home_ops WHERE cycle_id = ? AND ordinal = ?");
  const insert = sidecar.prepare("INSERT OR IGNORE INTO home_ops (cycle_id, ordinal, op, path, ok, reason, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)");
  return input.ops.slice(0, HOME_OPS_MAX).flatMap((op, ordinal) => {
    if (done.get(input.cycleId, ordinal)) return [];
    const result = applyOne(root, op, input.nowMs);
    insert.run(input.cycleId, ordinal, result.op, result.path, result.ok ? 1 : 0, result.reason ?? null, input.nowMs);
    return [result];
  });
}

/** What an Owner-private turn sees of her home: the files (newest change first when it is long) and her latest changes. */
export function homeForThought(sidecar: DatabaseSync, root: string, nowMs: number): ThoughtHome | undefined {
  try {
    const { entries, totalBytes } = listHome(root);
    const files = entries.length > HOME_LIST_LIMIT
      ? [...entries].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs).slice(0, HOME_LIST_LIMIT).sort((a, b) => a.path.localeCompare(b.path))
      : entries;
    const recentOps = (sidecar.prepare(`SELECT op, path, ok, reason, at_ms FROM home_ops WHERE at_ms >= ?
      ORDER BY at_ms DESC, ordinal DESC LIMIT 8`).all(nowMs - 48 * 60 * 60_000) as Row[]).reverse().map(row => ({
      op: String(row.op) as HomeOp["op"], path: String(row.path), ok: Number(row.ok) === 1,
      ...(typeof row.reason === "string" && row.reason ? { reason: row.reason } : {}), atMs: Number(row.at_ms) }));
    return { files, totalBytes, ...(entries.length > files.length ? { omitted: entries.length - files.length } : {}),
      ...(recentOps.length ? { recentOps } : {}) };
  } catch {
    return undefined;
  }
}
