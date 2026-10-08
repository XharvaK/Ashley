/**
 * Domus ingress wire contract v1.
 *
 * POST /domus/observation accepts only:
 * v=1, observation_id (1..128 [A-Za-z0-9._:-]), world/branch/session/attachment/body/snapshot
 * (strings, 1..64), seq/source_time_ms/expires_at_ms (safe non-negative integers),
 * lineage_class (1..32 [A-Z_]), percepts (1..32 of {kind: 1..32 [a-z0-9_], salience: finite 0..1,
 * facts: object <= 2048 UTF-8 bytes of JSON.stringify}), optional portrait (object <= 8192 bytes),
 * optional day (8h: object <= 16384 bytes; the helper's facts-only digest of one Sims day),
 * optional options (8f: array of up to 32 objects, <= 8192 bytes; what she may choose to do).
 * Unknown top-level keys, unknown percept keys, expires_at_ms <= source_time_ms, or a window
 * over 600000 ms are 400 {error:"invalid_body"}. source_time_ms > now+120000 is 400
 * {error:"clock_skew"}. now > expires_at_ms is 410 {error:"expired"}.
 * Digest is SHA-256 of recursively key-sorted JSON. New id is 202 {status:"admitted",
 * observation_id, receipt_time_ms}. Same id and digest is 200 {status:"duplicate", ...}
 * with the original receipt time. Same id and a different digest is 409
 * {error:"observation_conflict"}.
 *
 * POST /domus/heartbeat accepts only v=1, helper_session (1..64), sent_at_ms (safe
 * non-negative integer), attached (boolean), optional world (0..64), probe_version (0..16) and
 * inputs (full | game_only: E1b, whether her game passes keep the Owner's conversations out).
 * Unknown keys are 400. The response is 200 {status:"ok"}.
 *
 * POST /domus/undo accepts only v=1, world/branch/session (1..64), after_source_time_ms
 * (safe non-negative integer), and reason (1..32 [A-Z_]). Unknown keys are 400
 * {error:"invalid_body"}. The response is 200 {status:"ok", observations, supports,
 * assertions, episodes, journal}.
 *
 * POST /domus/acts/sync (8f) accepts only v=1, helper_session (1..64) and events (0..64 of {act_id
 * 1..64 [A-Za-z0-9], phase one of received|accepted|rejected|pushed|finished|unknown|expired,
 * at_ms safe integer, optional detail object <= 1024 bytes}). Events for acts of another attachment
 * are ignored. The response is 200 {status:"ok", applied, acts:[{act_id, object_id, guid64,
 * expires_at_ms}], snapshots:[{snapshot_id}]}: her requested acts for this helper session that have not expired,
 * and her picture requests for it (SNAPSHOT) requested within the last ten minutes (older ones expire here).
 *
 * POST /domus/snapshot (SNAPSHOT) accepts only v=1, helper_session (1..64), snapshot_id (1..64 [A-Za-z0-9-]) and
 * exactly one of png_base64 (a PNG, decoded at most 6 MiB) or failed (game_minimized|no_game_window|capture_failed).
 * Unknown keys, both or neither, or a bad value are 400 {error:"invalid_body"}. An unknown id is 404 {error:"unknown_snapshot"};
 * one that is not requested, or belongs to another attachment, is 409 {error:"not_requested"|"wrong_attachment"}. A PNG
 * over the limit is 413 {error:"too_large"}; one without the PNG signature is 400 {error:"not_png"}. Success is
 * 200 {status:"ok"}. This route accepts bodies up to about 9 MB, read only after the token check; every other route keeps 64 KiB.
 *
 * POST /domus/feed (E3) accepts only v=1 and helper_session (1..64). The response is 200
 * {status:"ok", items}: her settled game passes for that helper session that were stamped
 * game-only, newest last, with the act each chose and its plan (see feed.ts). Held lines are
 * listed without their words.
 *
 * A newly admitted observation (202) calls onAdmitted, so the host can evaluate it now; a
 * duplicate, a conflict or a rejected body does not. A heartbeat that newly arms a helper
 * session (attached:true, not armed before) calls it too.
 *
 * Auth header X-Domus-Token. Missing, wrong, or equal to the Discord bot token is 401
 * {error:"unauthorized"}. Any other path is 404 {error:"not_found"}. JSON bodies over
 * 64 KiB are 413 {error:"payload_too_large"}. This listener does not append inbox rows.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { markDomusSpanUndone } from "../cognitive-v021/memory/undo.js";
import { admitObservation, canonicalJson, observationDigest, upsertHeartbeat } from "./store.js";
import { interruptDomusPlans, isDomusActPhase, syncDomusActs, type DomusActEvent } from "./acts.js";
import { domusFeed } from "./feed.js";
import { armedAttachments } from "./notification.js";
import {
  DOMUS_SNAPSHOT_FAILURES, receiveDomusSnapshot, requestedDomusSnapshots, type DomusSnapshotFailure, type DomusSnapshotReceiptCode,
} from "./snapshots.js";
import { recentWatchMarks } from "../oversight/word-watch.js";

const BODY_LIMIT = 64 * 1024;
/** SNAPSHOT: a 6 MiB picture travels as base64 inside its JSON body (about 8 MiB) plus the wrapper. */
const SNAPSHOT_BODY_LIMIT = 9 * 1024 * 1024;
const SNAPSHOT_STATUS: Record<DomusSnapshotReceiptCode, number> = {
  unknown_snapshot: 404, not_requested: 409, wrong_attachment: 409, too_large: 413, not_png: 400, invalid_body: 400,
  snapshots_unavailable: 503, write_failed: 500,
};
const MAX_WINDOW_MS = 600_000;
const MAX_SKEW_MS = 120_000;

export type DomusIngressDecision =
  | { enabled: true }
  | { enabled: false; reason: "token_missing" | "token_too_short" | "token_matches_bot" };

export function decideDomusIngress(input: { helperToken: string; botToken: string }): DomusIngressDecision {
  const helper = input.helperToken ?? "";
  if (!helper.trim()) return { enabled: false, reason: "token_missing" };
  if (Buffer.byteLength(helper, "utf8") < 32) return { enabled: false, reason: "token_too_short" };
  const bot = input.botToken ?? "";
  if (bot && tokenEqual(helper, bot)) return { enabled: false, reason: "token_matches_bot" };
  return { enabled: true };
}

function tokenEqual(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

type HttpError = Error & { status: number; code: string };

function fail(status: number, code: string): never {
  const error = new Error(code) as HttpError;
  error.status = status;
  error.code = code;
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, min: number, max: number, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    fail(400, "invalid_body");
  }
  return value;
}

function safeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(400, "invalid_body");
  return value;
}

function jsonObject(value: unknown, maxBytes: number): Record<string, unknown> {
  if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) fail(400, "invalid_body");
  return value;
}

const OBSERVATION_KEYS = new Set([
  "v", "observation_id", "world", "branch", "session", "attachment", "body", "snapshot",
  "seq", "source_time_ms", "expires_at_ms", "lineage_class", "percepts", "portrait", "day", "options",
]);

export function parseObservation(body: unknown, now: number): {
  observationId: string;
  normalized: Record<string, unknown>;
  fields: {
    world: string; branch: string; session: string; attachment: string; body: string; snapshot: string;
    seq: number; sourceTimeMs: number; expiresAtMs: number; lineageClass: string;
  };
} {
  if (!isRecord(body)) fail(400, "invalid_body");
  for (const key of Object.keys(body)) if (!OBSERVATION_KEYS.has(key)) fail(400, "invalid_body");
  if (body.v !== 1) fail(400, "invalid_body");
  const observationId = text(body.observation_id, 1, 128, /^[A-Za-z0-9._:-]+$/);
  const world = text(body.world, 1, 64);
  const branch = text(body.branch, 1, 64);
  const session = text(body.session, 1, 64);
  const attachment = text(body.attachment, 1, 64);
  const snapshot = text(body.snapshot, 1, 64);
  const textBody = text(body.body, 1, 64);
  const seq = safeInt(body.seq);
  const sourceTimeMs = safeInt(body.source_time_ms);
  const expiresAtMs = safeInt(body.expires_at_ms);
  const lineageClass = text(body.lineage_class, 1, 32, /^[A-Z_]+$/);
  if (!Array.isArray(body.percepts) || body.percepts.length < 1 || body.percepts.length > 32) fail(400, "invalid_body");
  const percepts = body.percepts.map((item) => {
    if (!isRecord(item)) fail(400, "invalid_body");
    for (const key of Object.keys(item)) if (key !== "kind" && key !== "salience" && key !== "facts") fail(400, "invalid_body");
    const salience = item.salience;
    if (typeof salience !== "number" || !Number.isFinite(salience) || salience < 0 || salience > 1) fail(400, "invalid_body");
    return { kind: text(item.kind, 1, 32, /^[a-z0-9_]+$/), salience, facts: jsonObject(item.facts, 2048) };
  });
  const normalized: Record<string, unknown> = {
    v: 1, observation_id: observationId, world, branch, session, attachment, body: textBody, snapshot,
    seq, source_time_ms: sourceTimeMs, expires_at_ms: expiresAtMs, lineage_class: lineageClass, percepts,
  };
  if ("portrait" in body) normalized.portrait = jsonObject(body.portrait, 8192);
  if ("day" in body) normalized.day = jsonObject(body.day, 16384);
  if ("options" in body) {
    if (!Array.isArray(body.options) || body.options.length > 32 || !body.options.every(isRecord)
      || Buffer.byteLength(JSON.stringify(body.options), "utf8") > 8192) fail(400, "invalid_body");
    normalized.options = body.options;
  }
  if (expiresAtMs <= sourceTimeMs || expiresAtMs - sourceTimeMs > MAX_WINDOW_MS) fail(400, "invalid_body");
  if (sourceTimeMs > now + MAX_SKEW_MS) fail(400, "clock_skew");
  if (now > expiresAtMs) fail(410, "expired");
  return {
    observationId,
    normalized,
    fields: { world, branch, session, attachment, body: textBody, snapshot, seq, sourceTimeMs, expiresAtMs, lineageClass },
  };
}

const UNDO_KEYS = new Set(["v", "world", "branch", "session", "after_source_time_ms", "reason"]);

export function parseUndo(body: unknown): { world: string; branch: string; session: string; afterSourceTimeMs: number; reason: string } {
  if (!isRecord(body)) fail(400, "invalid_body");
  for (const key of Object.keys(body)) if (!UNDO_KEYS.has(key)) fail(400, "invalid_body");
  if (body.v !== 1) fail(400, "invalid_body");
  return {
    world: text(body.world, 1, 64),
    branch: text(body.branch, 1, 64),
    session: text(body.session, 1, 64),
    afterSourceTimeMs: safeInt(body.after_source_time_ms),
    reason: text(body.reason, 1, 32, /^[A-Z_]+$/),
  };
}

const SYNC_KEYS = new Set(["v", "helper_session", "events"]);
const SYNC_EVENT_KEYS = new Set(["act_id", "phase", "at_ms", "detail"]);

export function parseActSync(body: unknown): { helperSession: string; events: DomusActEvent[] } {
  if (!isRecord(body)) fail(400, "invalid_body");
  for (const key of Object.keys(body)) if (!SYNC_KEYS.has(key)) fail(400, "invalid_body");
  if (body.v !== 1 || !Array.isArray(body.events) || body.events.length > 64) fail(400, "invalid_body");
  const events = body.events.map((item): DomusActEvent => {
    if (!isRecord(item)) fail(400, "invalid_body");
    for (const key of Object.keys(item)) if (!SYNC_EVENT_KEYS.has(key)) fail(400, "invalid_body");
    if (!isDomusActPhase(item.phase)) fail(400, "invalid_body");
    return {
      actId: text(item.act_id, 1, 64, /^[A-Za-z0-9]+$/),
      phase: item.phase,
      atMs: safeInt(item.at_ms),
      ...("detail" in item ? { detail: jsonObject(item.detail, 1024) } : {}),
    };
  });
  return { helperSession: text(body.helper_session, 1, 64), events };
}

const SNAPSHOT_KEYS = new Set(["v", "helper_session", "snapshot_id", "png_base64", "failed"]);

export function parseDomusSnapshot(body: unknown): { helperSession: string; snapshotId: string; pngBase64?: string; failed?: DomusSnapshotFailure } {
  if (!isRecord(body)) fail(400, "invalid_body");
  for (const key of Object.keys(body)) if (!SNAPSHOT_KEYS.has(key)) fail(400, "invalid_body");
  if (body.v !== 1) fail(400, "invalid_body");
  const hasPicture = "png_base64" in body;
  const hasFailure = "failed" in body;
  if (hasPicture === hasFailure) fail(400, "invalid_body");
  const base = {
    helperSession: text(body.helper_session, 1, 64),
    snapshotId: text(body.snapshot_id, 1, 64, /^[A-Za-z0-9-]+$/),
  };
  if (hasFailure) {
    if (!(DOMUS_SNAPSHOT_FAILURES as readonly unknown[]).includes(body.failed)) fail(400, "invalid_body");
    return { ...base, failed: body.failed as DomusSnapshotFailure };
  }
  if (typeof body.png_base64 !== "string" || body.png_base64.length === 0) fail(400, "invalid_body");
  return { ...base, pngBase64: body.png_base64 };
}

const FEED_KEYS = new Set(["v", "helper_session"]);
/** E4: word-watch flags this recent ride along with the feed, so the helper can keep the recording around them. */
const WATCH_MARKS_MS = 10 * 60_000;

export function parseFeed(body: unknown): { helperSession: string } {
  if (!isRecord(body)) fail(400, "invalid_body");
  for (const key of Object.keys(body)) if (!FEED_KEYS.has(key)) fail(400, "invalid_body");
  if (body.v !== 1) fail(400, "invalid_body");
  return { helperSession: text(body.helper_session, 1, 64) };
}

const HEARTBEAT_KEYS = new Set(["v", "helper_session", "sent_at_ms", "attached", "world", "probe_version", "inputs"]);

export function parseHeartbeat(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) fail(400, "invalid_body");
  for (const key of Object.keys(body)) if (!HEARTBEAT_KEYS.has(key)) fail(400, "invalid_body");
  if (body.v !== 1 || typeof body.attached !== "boolean") fail(400, "invalid_body");
  const normalized: Record<string, unknown> = {
    v: 1,
    helper_session: text(body.helper_session, 1, 64),
    sent_at_ms: safeInt(body.sent_at_ms),
    attached: body.attached,
  };
  if ("world" in body) normalized.world = text(body.world, 0, 64);
  if ("probe_version" in body) normalized.probe_version = text(body.probe_version, 0, 16);
  if ("inputs" in body) {
    if (body.inputs !== "full" && body.inputs !== "game_only") fail(400, "invalid_body");
    normalized.inputs = body.inputs;
  }
  return normalized;
}

export function createDomusIngressApp(input: {
  db: DatabaseSync;
  token: string;
  botToken: string;
  now: () => number;
  onAdmitted?: () => void;
  /** E4: the dispatch diagnostics and this build's commit, for the regime of each pass in the feed. */
  observability?: DatabaseSync;
  build?: string;
  /** SNAPSHOT: the folder the helper's pictures are written to (the Ashley data root's domus/snapshots). */
  snapshotDir?: string;
}): express.Express {
  const app = express();
  // The token is checked before any body is read, so only the helper can make this listener parse a picture.
  app.use((req, res, next) => {
    const presented = req.get("X-Domus-Token") ?? "";
    if (!presented || !tokenEqual(presented, input.token) || (input.botToken && tokenEqual(presented, input.botToken))) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });
  app.use("/domus/snapshot", express.json({ limit: SNAPSHOT_BODY_LIMIT }));
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use((error: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === "entity.too.large" || error?.status === 413) {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    next(error);
  });
  app.post("/domus/observation", (req, res) => {
    try {
      const now = input.now();
      const parsed = parseObservation(req.body, now);
      const payloadJson = canonicalJson(parsed.normalized);
      const result = admitObservation(input.db, {
        observationId: parsed.observationId,
        digest: observationDigest(parsed.normalized),
        world: parsed.fields.world,
        branch: parsed.fields.branch,
        session: parsed.fields.session,
        attachment: parsed.fields.attachment,
        body: parsed.fields.body,
        snapshot: parsed.fields.snapshot,
        seq: parsed.fields.seq,
        sourceTimeMs: parsed.fields.sourceTimeMs,
        expiresAtMs: parsed.fields.expiresAtMs,
        receiptTimeMs: now,
        lineageClass: parsed.fields.lineageClass,
        payloadJson,
      });
      if (result.status === "conflict") {
        res.status(409).json({ error: "observation_conflict" });
        return;
      }
      res.status(result.status === "admitted" ? 202 : 200).json({
        status: result.status,
        observation_id: parsed.observationId,
        receipt_time_ms: result.receiptTimeMs,
      });
      if (result.status === "admitted") {
        // H0.5: something new woke her; what still waits in her plan is dropped before she thinks.
        try {
          interruptDomusPlans(input.db, { attachment: parsed.fields.attachment,
            percepts: (parsed.normalized as { percepts?: unknown[] }).percepts ?? [], nowMs: now });
        } catch { /* the plan keeps; she still sees the wake */ }
      }
      if (result.status === "admitted" && input.onAdmitted) {
        try { input.onAdmitted(); } catch { /* the minute poll still evaluates it */ }
      }
    } catch (error) {
      const http = error as HttpError;
      if (http.status && http.code) {
        res.status(http.status).json({ error: http.code });
        return;
      }
      throw error;
    }
  });
  app.post("/domus/heartbeat", (req, res) => {
    try {
      const parsed = parseHeartbeat(req.body);
      const now = input.now();
      const session = String(parsed.helper_session);
      // Live 2026-10-08: observations that arrived before the game attached waited a minute for the
      // lane's own poll. The heartbeat that arms her game is weighed at once, like an observation.
      const arming = parsed.attached === true && !armedAttachments(input.db, now).has(session);
      upsertHeartbeat(input.db, {
        helperSession: session,
        receivedAtMs: now,
        sentAtMs: Number(parsed.sent_at_ms),
        json: canonicalJson(parsed),
      });
      res.status(200).json({ status: "ok" });
      if (arming && input.onAdmitted) {
        try { input.onAdmitted(); } catch { /* the minute poll still evaluates it */ }
      }
    } catch (error) {
      const http = error as HttpError;
      if (http.status && http.code) {
        res.status(http.status).json({ error: http.code });
        return;
      }
      throw error;
    }
  });
  app.post("/domus/acts/sync", (req, res) => {
    try {
      const parsed = parseActSync(req.body);
      const now = input.now();
      const result = syncDomusActs(input.db, { helperSession: parsed.helperSession, events: parsed.events, nowMs: now });
      const snapshots = requestedDomusSnapshots(input.db, { helperSession: parsed.helperSession, nowMs: now });
      res.status(200).json({ status: "ok", applied: result.applied, acts: result.acts, planned: result.planned, snapshots });
    } catch (error) {
      const http = error as HttpError;
      if (http.status && http.code) {
        res.status(http.status).json({ error: http.code });
        return;
      }
      throw error;
    }
  });
  app.post("/domus/snapshot", (req, res) => {
    try {
      const parsed = parseDomusSnapshot(req.body);
      const result = receiveDomusSnapshot(input.db, {
        helperSession: parsed.helperSession,
        snapshotId: parsed.snapshotId,
        nowMs: input.now(),
        ...(parsed.pngBase64 !== undefined ? { pngBase64: parsed.pngBase64 } : {}),
        ...(parsed.failed !== undefined ? { failed: parsed.failed } : {}),
        ...(input.snapshotDir ? { snapshotDir: input.snapshotDir } : {}),
      });
      if (!result.ok) {
        res.status(SNAPSHOT_STATUS[result.code]).json({ error: result.code });
        return;
      }
      res.status(200).json({ status: "ok" });
    } catch (error) {
      const http = error as HttpError;
      if (http.status && http.code) {
        res.status(http.status).json({ error: http.code });
        return;
      }
      throw error;
    }
  });
  app.post("/domus/feed", (req, res) => {
    try {
      const parsed = parseFeed(req.body);
      const now = input.now();
      const items = domusFeed(input.db, { helperSession: parsed.helperSession, nowMs: now,
        ...(input.observability ? { observability: input.observability } : {}), ...(input.build ? { build: input.build } : {}) });
      const marks = input.observability ? recentWatchMarks(input.observability, now - WATCH_MARKS_MS) : [];
      res.status(200).json({ status: "ok", items, marks });
    } catch (error) {
      const http = error as HttpError;
      if (http.status && http.code) {
        res.status(http.status).json({ error: http.code });
        return;
      }
      throw error;
    }
  });
  app.post("/domus/undo", (req, res) => {
    try {
      const parsed = parseUndo(req.body);
      const result = markDomusSpanUndone(input.db, {
        world: parsed.world,
        branch: parsed.branch,
        session: parsed.session,
        afterSourceTimeMs: parsed.afterSourceTimeMs,
      }, input.now());
      console.log(`[domus-ingress] undo world=${parsed.world} session=${parsed.session} reason=${parsed.reason} observations=${result.observations} assertions=${result.assertions}`);
      res.status(200).json({ status: "ok", ...result });
    } catch (error) {
      const http = error as HttpError;
      if (http.status && http.code) {
        res.status(http.status).json({ error: http.code });
        return;
      }
      throw error;
    }
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  return app;
}
