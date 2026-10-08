// SNAPSHOT: a real picture of her game, asked for by her in a pass and sent only to the Owner's DM
// with her own words. The Host keeps her request once per settled pass, against the attachment that
// pass saw. The helper takes the picture on its next sync and posts the PNG (or why it could not). The
// bot claims each taken picture, sends it, and reports the Discord outcome. The Host never invents a
// picture or a caption: a picture exists only when the helper took it.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** A requested picture the helper does not take within this time expires; a taken one the bot does not claim is claimed again after it. */
export const DOMUS_SNAPSHOT_TTL_MS = 10 * 60_000;
/** Her recent pictures in domusNow: this many, from this far back. */
export const DOMUS_SNAPSHOT_RECENT = 3;
export const DOMUS_SNAPSHOT_RECENT_MS = 24 * 60 * 60_000;
export const DOMUS_SNAPSHOT_CAPTION_MAX = 200;
const DOMUS_SNAPSHOT_SHOWN_CHARS = 60;
/** The decoded picture is at most this large (the helper downscales it before it sends). */
export const DOMUS_SNAPSHOT_MAX_BYTES = 6 * 1024 * 1024;
/** The bot claims at most this many pictures per call. */
export const DOMUS_SNAPSHOT_CLAIM_LIMIT = 2;
export const DOMUS_SNAPSHOT_FAILURES = ["game_minimized", "no_game_window", "capture_failed"] as const;

export type DomusSnapshotFailure = (typeof DOMUS_SNAPSHOT_FAILURES)[number];
export type DomusSnapshotStatus = "requested" | "taken" | "claimed" | "sent" | "failed" | "expired";
export type DomusSnapshotClaim = { caption: string };
export type DomusSnapshotFact = { caption: string; status: DomusSnapshotStatus; reason?: string; at: string };
export type DomusSnapshotReceiptCode = "unknown_snapshot" | "not_requested" | "wrong_attachment" | "too_large"
  | "not_png" | "invalid_body" | "snapshots_unavailable" | "write_failed";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

type Row = Record<string, unknown>;

/** Characters as a person counts them (an emoji is one). */
function charCount(text: string): number {
  return Array.from(text).length;
}

/** The folder of the pictures, under the Ashley data root. */
export function domusSnapshotDirFor(dataDir: string): string {
  return join(dataDir, "domus", "snapshots");
}

/** A settlement's snapshot claim: one caption, 1 to 200 characters once trimmed; anything else is not a claim. */
export function isDomusSnapshotClaim(value: unknown): value is DomusSnapshotClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "caption")) return false;
  if (typeof record.caption !== "string") return false;
  const length = charCount(record.caption.trim());
  return length >= 1 && length <= DOMUS_SNAPSHOT_CAPTION_MAX;
}

/** Her request, kept once per settled pass against the attachment that pass saw. Null when that pass already kept one. */
export function recordDomusSnapshot(db: DatabaseSync, input: {
  attachment: string; claim: DomusSnapshotClaim; cycleId: string; nowMs: number;
}): string | null {
  if (db.prepare("SELECT snapshot_id FROM domus_snapshots WHERE cycle_id = ?").get(input.cycleId)) return null;
  const snapshotId = randomUUID();
  db.prepare(`INSERT INTO domus_snapshots (snapshot_id, cycle_id, attachment, caption, status, requested_at_ms)
    VALUES (?, ?, ?, ?, 'requested', ?)`).run(snapshotId, input.cycleId, input.attachment, input.claim.caption.trim(), input.nowMs);
  return snapshotId;
}

/**
 * One helper sync: requests still open for this attachment (within the time), in the order asked.
 * A request older than the time expires here, whichever attachment it belongs to, and is never taken.
 */
export function requestedDomusSnapshots(db: DatabaseSync, input: { helperSession: string; nowMs: number }): Array<{ snapshot_id: string }> {
  const cutoff = input.nowMs - DOMUS_SNAPSHOT_TTL_MS;
  db.prepare(`UPDATE domus_snapshots SET status = 'expired', reason = 'no_picture_in_time', settled_at_ms = ?
    WHERE status = 'requested' AND requested_at_ms <= ?`).run(input.nowMs, cutoff);
  return (db.prepare(`SELECT snapshot_id FROM domus_snapshots WHERE attachment = ? AND status = 'requested' AND requested_at_ms > ?
    ORDER BY requested_at_ms, snapshot_id`).all(input.helperSession, cutoff) as Row[])
    .map(row => ({ snapshot_id: String(row.snapshot_id) }));
}

/** What became of her recent pictures, newest last: each with the time it reached its present status. */
export function domusSnapshotFacts(db: DatabaseSync, nowMs: number): DomusSnapshotFact[] {
  const rows = db.prepare(`SELECT caption, status, reason, requested_at_ms, taken_at_ms, claimed_at_ms, settled_at_ms
    FROM domus_snapshots WHERE requested_at_ms >= ? ORDER BY requested_at_ms DESC, snapshot_id DESC LIMIT ?`)
    .all(nowMs - DOMUS_SNAPSHOT_RECENT_MS, DOMUS_SNAPSHOT_RECENT) as Row[];
  return rows.reverse().map(row => {
    const status = String(row.status) as DomusSnapshotStatus;
    const at = status === "requested" ? row.requested_at_ms
      : status === "taken" ? row.taken_at_ms
        : status === "claimed" ? row.claimed_at_ms
          : row.settled_at_ms;
    return {
      caption: Array.from(String(row.caption)).slice(0, DOMUS_SNAPSHOT_SHOWN_CHARS).join(""),
      status,
      ...(typeof row.reason === "string" && row.reason ? { reason: row.reason } : {}),
      at: new Date(Number(at ?? row.requested_at_ms)).toISOString(),
    };
  });
}

/** The PNG the helper sent, if it is one within the size limit; otherwise the reason it is refused. */
function decodeSnapshotPng(pngBase64: string): { bytes: Buffer } | { code: "invalid_body" | "too_large" | "not_png" } {
  if (pngBase64.length % 4 !== 0) return { code: "invalid_body" };
  const padding = pngBase64.endsWith("==") ? 2 : pngBase64.endsWith("=") ? 1 : 0;
  if ((pngBase64.length / 4) * 3 - padding > DOMUS_SNAPSHOT_MAX_BYTES) return { code: "too_large" };
  if (!BASE64.test(pngBase64)) return { code: "invalid_body" };
  const bytes = Buffer.from(pngBase64, "base64");
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return { code: "not_png" };
  return { bytes };
}

/**
 * The helper's answer to one request: the picture (written to the data root, then marked taken) or
 * the reason it could not take one (marked failed). Only a request still open for this attachment
 * may be answered, and only once.
 */
export function receiveDomusSnapshot(db: DatabaseSync, input: {
  helperSession: string; snapshotId: string; nowMs: number; pngBase64?: string; failed?: DomusSnapshotFailure; snapshotDir?: string;
}): { ok: true; status: "taken" | "failed" } | { ok: false; code: DomusSnapshotReceiptCode } {
  const row = db.prepare("SELECT status, attachment FROM domus_snapshots WHERE snapshot_id = ?").get(input.snapshotId) as Row | undefined;
  if (!row) return { ok: false, code: "unknown_snapshot" };
  if (row.status !== "requested") return { ok: false, code: "not_requested" };
  if (row.attachment !== input.helperSession) return { ok: false, code: "wrong_attachment" };
  if (input.failed !== undefined) {
    db.prepare(`UPDATE domus_snapshots SET status = 'failed', reason = ?, settled_at_ms = ?
      WHERE snapshot_id = ? AND status = 'requested'`).run(input.failed, input.nowMs, input.snapshotId);
    return { ok: true, status: "failed" };
  }
  const picture = decodeSnapshotPng(input.pngBase64 ?? "");
  if (!("bytes" in picture)) return { ok: false, code: picture.code };
  if (!input.snapshotDir) return { ok: false, code: "snapshots_unavailable" };
  try {
    mkdirSync(input.snapshotDir, { recursive: true });
    writeFileSync(join(input.snapshotDir, `${input.snapshotId}.png`), picture.bytes);
  } catch {
    return { ok: false, code: "write_failed" };
  }
  db.prepare(`UPDATE domus_snapshots SET status = 'taken', taken_at_ms = ? WHERE snapshot_id = ? AND status = 'requested'`)
    .run(input.nowMs, input.snapshotId);
  return { ok: true, status: "taken" };
}

/**
 * The bot's claim: taken pictures (and claims older than the time, which the bot never reported on),
 * oldest first, with their caption and bytes. A taken picture whose file is gone fails, never sent.
 */
export function claimDomusSnapshots(db: DatabaseSync, input: {
  nowMs: number; snapshotDir: string; limit?: number;
}): Array<{ snapshotId: string; caption: string; pngBase64: string }> {
  const cutoff = input.nowMs - DOMUS_SNAPSHOT_TTL_MS;
  const rows = db.prepare(`SELECT snapshot_id, caption FROM domus_snapshots
    WHERE status = 'taken' OR (status = 'claimed' AND claimed_at_ms <= ?)
    ORDER BY taken_at_ms, snapshot_id LIMIT ?`).all(cutoff, Math.max(1, input.limit ?? DOMUS_SNAPSHOT_CLAIM_LIMIT)) as Row[];
  const mark = db.prepare(`UPDATE domus_snapshots SET status = 'claimed', claimed_at_ms = ? WHERE snapshot_id = ?
    AND (status = 'taken' OR (status = 'claimed' AND claimed_at_ms <= ?))`);
  const claimed: Array<{ snapshotId: string; caption: string; pngBase64: string }> = [];
  for (const row of rows) {
    const snapshotId = String(row.snapshot_id);
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(input.snapshotDir, `${snapshotId}.png`));
    } catch {
      db.prepare(`UPDATE domus_snapshots SET status = 'failed', reason = 'picture_missing', settled_at_ms = ? WHERE snapshot_id = ?`)
        .run(input.nowMs, snapshotId);
      continue;
    }
    if (Number(mark.run(input.nowMs, snapshotId, cutoff).changes) !== 1) continue;
    claimed.push({ snapshotId, caption: String(row.caption), pngBase64: bytes.toString("base64") });
  }
  return claimed;
}

/** The bot's report on one claimed picture. Only a claimed picture takes a result, once. */
export function reportDomusSnapshot(db: DatabaseSync, input: {
  snapshotId: string; status: "sent" | "failed"; reason?: string; discordMessageId?: string; nowMs: number;
}): "recorded" | "unknown" | "not_claimed" {
  const row = db.prepare("SELECT status FROM domus_snapshots WHERE snapshot_id = ?").get(input.snapshotId) as Row | undefined;
  if (!row) return "unknown";
  if (row.status !== "claimed") return "not_claimed";
  const reason = input.status === "failed" ? (input.reason?.trim().slice(0, 80) || null) : null;
  const discordMessageId = input.discordMessageId?.trim().slice(0, 64) || null;
  db.prepare(`UPDATE domus_snapshots SET status = ?, reason = ?, settled_at_ms = ?, discord_message_id = ?
    WHERE snapshot_id = ? AND status = 'claimed'`).run(input.status, reason, input.nowMs, discordMessageId, input.snapshotId);
  return "recorded";
}
