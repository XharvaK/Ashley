import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { resolveActiveThread } from "../../memory/threads.js";
import type { AttachmentIntakeRef } from "../../perception/types.js";
import { readEligibilityBundle } from "../../relationship/social-authority.js";
import { isRoomPublicationEnabled, roomIdentity } from "../social/room-activation.js";

export type OwnerTransportRoomContext = {
  guildId: string;
  channelId: string;
};

export type OwnerTransportSurface = {
  ownerId: string;
  channelId: string;
  guildId?: string | null;
};

export type OwnerTransportCaptureInput = OwnerTransportSurface & {
  discordMessageId: string;
  text: string;
  attachments: AttachmentIntakeRef[];
  ownerRoomContext?: OwnerTransportRoomContext | null;
  sentAtMs: number;
  capturedAtMs: number;
};

export type OwnerTransportPendingCapture = OwnerTransportCaptureInput & {
  surfaceKey: string;
  source: "live" | "history";
  admittedAtMs?: number | null;
};

export type OwnerTransportCaptureResult = {
  captured: true;
  duplicate: boolean;
  surfaceKey: string;
};

export type OwnerTransportCursorState = {
  initialized: boolean;
  surfaceKey: string;
  afterMessageId: string | null;
  reason?: "canonical_boundary_unavailable";
};

export type OwnerTransportHistoryPageResult = {
  accepted: true;
  surfaceKey: string;
  afterMessageId: string;
  newlyCaptured: number;
  duplicates: number;
};

const MAX_TRANSPORT_MESSAGE_LENGTH = 4_000;
const MAX_TRANSPORT_ATTACHMENTS = 4;
const MAX_PENDING_LIMIT = 100;
const MAX_ID_LENGTH = 200;

type DbCaptureRow = {
  discord_message_id?: unknown;
  owner_id?: unknown;
  surface_key?: unknown;
  channel_id?: unknown;
  guild_id?: unknown;
  text?: unknown;
  attachments_json?: unknown;
  owner_room_context_json?: unknown;
  sent_at_ms?: unknown;
  captured_at_ms?: unknown;
  source?: unknown;
  admitted_at_ms?: unknown;
};

type DbCursorRow = {
  surface_key?: unknown;
  owner_id?: unknown;
  channel_id?: unknown;
  guild_id?: unknown;
  after_message_id?: unknown;
  updated_at_ms?: unknown;
};

function requiredId(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ID_LENGTH) throw new Error(code);
  return normalized;
}

function requiredStringMax(value: unknown, code: string, max: number): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(code);
  return normalized;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  if (value.length > MAX_TRANSPORT_MESSAGE_LENGTH) throw new Error("owner_transport_message_too_long");
  return value;
}

function finiteTimestamp(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function optionalGuildId(value: unknown): string | null {
  if (value == null || value === "") return null;
  return requiredId(value, "owner_transport_surface_invalid");
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function attachmentRefs(value: unknown): AttachmentIntakeRef[] {
  if (!Array.isArray(value) || value.length > MAX_TRANSPORT_ATTACHMENTS) {
    throw new Error("owner_transport_attachments_invalid");
  }
  return value.map((candidate) => {
    const row = parseRecord(candidate);
    const discordAttachmentId = requiredId(row?.discordAttachmentId, "owner_transport_attachment_invalid");
    const declaredMime = requiredStringMax(row?.declaredMime, "owner_transport_attachment_invalid", 200);
    const fileName = requiredStringMax(row?.fileName, "owner_transport_attachment_invalid", 200);
    const sourceUrl = requiredStringMax(row?.sourceUrl, "owner_transport_attachment_invalid", 4_096);
    const declaredByteSize = row?.declaredByteSize;
    if (declaredByteSize !== undefined &&
      (!Number.isSafeInteger(declaredByteSize) || (declaredByteSize as number) < 0)) {
      throw new Error("owner_transport_attachment_invalid");
    }
    const sourceClass = row?.sourceClass;
    if (sourceClass !== undefined && sourceClass !== "supplied_image" && sourceClass !== "supplied_screenshot") {
      throw new Error("owner_transport_attachment_invalid");
    }
    return {
      discordAttachmentId,
      declaredMime,
      fileName,
      sourceUrl,
      ...(declaredByteSize === undefined ? {} : { declaredByteSize: declaredByteSize as number }),
      ...(sourceClass === undefined ? {} : { sourceClass }),
    };
  });
}

function ownerRoomContext(value: unknown): OwnerTransportRoomContext | null {
  if (value == null) return null;
  const row = parseRecord(value);
  const guildId = requiredId(row?.guildId, "owner_transport_room_invalid");
  const channelId = requiredId(row?.channelId, "owner_transport_room_invalid");
  return { guildId, channelId };
}

export function ownerTransportSurfaceKey(input: OwnerTransportSurface): string {
  const ownerId = requiredId(input.ownerId, "owner_transport_owner_invalid");
  const channelId = requiredId(input.channelId, "owner_transport_surface_invalid");
  const guildId = optionalGuildId(input.guildId);
  return guildId
    ? `owner-room:${guildId}:${channelId}`
    : `owner-dm:${ownerId}:${channelId}`;
}

function normalizeCapture(
  input: OwnerTransportCaptureInput,
  nuclearDb: DatabaseSync,
  nowMs: number,
): OwnerTransportCaptureInput & { surfaceKey: string; guildId: string | null; ownerRoomContext: OwnerTransportRoomContext | null } {
  const ownerId = requiredId(input.ownerId, "owner_transport_owner_invalid");
  const channelId = requiredId(input.channelId, "owner_transport_surface_invalid");
  const guildId = optionalGuildId(input.guildId);
  const discordMessageId = requiredId(input.discordMessageId, "owner_transport_message_id_invalid");
  const text = requiredText(input.text, "owner_transport_message_invalid");
  const attachments = attachmentRefs(input.attachments);
  if (!text.trim() && attachments.length === 0) throw new Error("owner_transport_message_invalid");
  const sentAtMs = finiteTimestamp(input.sentAtMs, "owner_transport_sent_at_invalid");
  const capturedAtMs = finiteTimestamp(input.capturedAtMs, "owner_transport_captured_at_invalid");
  const context = ownerRoomContext(input.ownerRoomContext);

  if (guildId == null) {
    if (context) throw new Error("owner_transport_room_invalid");
  } else {
    if (!context || context.guildId !== guildId || context.channelId !== channelId) {
      throw new Error("owner_transport_room_invalid");
    }
    if (!isRoomPublicationEnabled(process.env, channelId)) {
      throw new Error("owner_room_not_active");
    }
    const eligibility = readEligibilityBundle(nuclearDb, { guildId, channelId, nowMs });
    if (
      eligibility.trustedRoom?.ownerId !== ownerId ||
      eligibility.trustedRoom.guildId !== guildId ||
      eligibility.trustedRoom.channelId !== channelId ||
      eligibility.trustedRoom.mode !== "trusted_social"
    ) {
      throw new Error("owner_room_not_authorized");
    }
  }

  return {
    ownerId,
    channelId,
    guildId,
    discordMessageId,
    text,
    attachments,
    ownerRoomContext: context,
    sentAtMs,
    capturedAtMs,
    surfaceKey: ownerTransportSurfaceKey({ ownerId, channelId, guildId }),
  };
}

function parseJson(value: unknown): unknown | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapCapture(row: DbCaptureRow): OwnerTransportPendingCapture {
  const attachments = parseJson(row.attachments_json);
  const context = parseJson(row.owner_room_context_json);
  if (!Array.isArray(attachments)) throw new Error("owner_transport_capture_corrupt");
  return {
    discordMessageId: String(row.discord_message_id ?? ""),
    ownerId: String(row.owner_id ?? ""),
    surfaceKey: String(row.surface_key ?? ""),
    channelId: String(row.channel_id ?? ""),
    guildId: row.guild_id == null ? null : String(row.guild_id),
    text: String(row.text ?? ""),
    attachments: attachments as AttachmentIntakeRef[],
    ownerRoomContext: context == null ? null : context as OwnerTransportRoomContext,
    sentAtMs: Number(row.sent_at_ms ?? 0),
    capturedAtMs: Number(row.captured_at_ms ?? 0),
    source: row.source === "history" ? "history" : "live",
    admittedAtMs: row.admitted_at_ms == null ? null : Number(row.admitted_at_ms),
  };
}

function captureMatches(
  existing: OwnerTransportPendingCapture,
  input: OwnerTransportCaptureInput & { surfaceKey: string; guildId: string | null; ownerRoomContext: OwnerTransportRoomContext | null },
): boolean {
  return existing.ownerId === input.ownerId &&
    existing.surfaceKey === input.surfaceKey &&
    existing.channelId === input.channelId &&
    existing.guildId === input.guildId &&
    existing.text === input.text &&
    JSON.stringify(existing.attachments) === JSON.stringify(input.attachments) &&
    JSON.stringify(existing.ownerRoomContext) === JSON.stringify(input.ownerRoomContext) &&
    existing.sentAtMs === input.sentAtMs;
}

function insertCaptureInTransaction(
  sidecar: DatabaseSync,
  input: OwnerTransportCaptureInput & { surfaceKey: string; guildId: string | null; ownerRoomContext: OwnerTransportRoomContext | null },
  source: "live" | "history",
): boolean {
  const existingRow = sidecar.prepare(
    "SELECT * FROM owner_discord_transport_captures WHERE discord_message_id = ?",
  ).get(input.discordMessageId) as DbCaptureRow | undefined;
  if (existingRow) {
    const existing = mapCapture(existingRow);
    if (!captureMatches(existing, input)) throw new Error("owner_transport_capture_conflict");
    return false;
  }
  sidecar.prepare(
    `INSERT INTO owner_discord_transport_captures
       (discord_message_id, owner_id, surface_key, channel_id, guild_id, text,
        attachments_json, owner_room_context_json, sent_at_ms, captured_at_ms,
        source, admitted_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    input.discordMessageId,
    input.ownerId,
    input.surfaceKey,
    input.channelId,
    input.guildId,
    input.text,
    JSON.stringify(input.attachments),
    input.ownerRoomContext == null ? null : JSON.stringify(input.ownerRoomContext),
    input.sentAtMs,
    input.capturedAtMs,
    source,
  );
  return true;
}

function conversationIdForSurface(
  nuclearDb: DatabaseSync,
  input: OwnerTransportSurface & { guildId: string | null },
): string {
  return input.guildId
    ? roomIdentity(input.guildId, input.channelId)
    : resolveActiveThread(nuclearDb, input.ownerId, "discord");
}

function canonicalBoundary(
  sidecar: DatabaseSync,
  conversationId: string,
): string | null {
  const rows = sidecar.prepare(
    `SELECT discord_message_id
       FROM conversation_evidence_discord_ids
      WHERE conversation_id = ?`,
  ).all(conversationId) as Array<{ discord_message_id?: unknown }>;
  const snowflakes = rows
    .map((row) => row.discord_message_id)
    .filter((value): value is string => typeof value === "string" && /^\d{17,20}$/.test(value));
  if (snowflakes.length === 0) return null;
  return snowflakes.sort(compareTransportIds).at(-1) ?? null;
}

function readCursor(
  sidecar: DatabaseSync,
  surfaceKey: string,
): DbCursorRow | undefined {
  return sidecar.prepare(
    "SELECT * FROM owner_discord_transport_cursors WHERE surface_key = ?",
  ).get(surfaceKey) as DbCursorRow | undefined;
}

export function captureOwnerTransport(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  input: OwnerTransportCaptureInput,
  options: { nowMs?: number } = {},
): OwnerTransportCaptureResult {
  const nowMs = options.nowMs ?? Date.now();
  const normalized = normalizeCapture(input, nuclearDb, nowMs);
  sidecar.exec("BEGIN IMMEDIATE");
  try {
    const inserted = insertCaptureInTransaction(sidecar, normalized, "live");
    sidecar.exec("COMMIT");
    return { captured: true, duplicate: !inserted, surfaceKey: normalized.surfaceKey };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

export function ensureOwnerTransportCursor(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  input: OwnerTransportSurface,
  options: { nowMs?: number } = {},
): OwnerTransportCursorState {
  const nowMs = options.nowMs ?? Date.now();
  const ownerId = requiredId(input.ownerId, "owner_transport_owner_invalid");
  const channelId = requiredId(input.channelId, "owner_transport_surface_invalid");
  const guildId = optionalGuildId(input.guildId);
  const surfaceKey = ownerTransportSurfaceKey({ ownerId, channelId, guildId });
  if (guildId != null) {
    if (!isRoomPublicationEnabled(process.env, channelId)) throw new Error("owner_room_not_active");
    const eligibility = readEligibilityBundle(nuclearDb, { guildId, channelId, nowMs });
    if (eligibility.trustedRoom?.ownerId !== ownerId ||
      eligibility.trustedRoom.guildId !== guildId ||
      eligibility.trustedRoom.channelId !== channelId ||
      eligibility.trustedRoom.mode !== "trusted_social") {
      throw new Error("owner_room_not_authorized");
    }
  }

  sidecar.exec("BEGIN IMMEDIATE");
  try {
    const current = readCursor(sidecar, surfaceKey);
    if (current && typeof current.after_message_id === "string") {
      sidecar.exec("COMMIT");
      return {
        initialized: true,
        surfaceKey,
        afterMessageId: current.after_message_id,
      };
    }
    const conversationId = conversationIdForSurface(nuclearDb, {
      ownerId,
      channelId,
      guildId,
    });
    const boundary = canonicalBoundary(sidecar, conversationId);
    if (!boundary) {
      sidecar.exec("COMMIT");
      return {
        initialized: false,
        surfaceKey,
        afterMessageId: null,
        reason: "canonical_boundary_unavailable",
      };
    }
    sidecar.prepare(
      `INSERT INTO owner_discord_transport_cursors
         (surface_key, owner_id, channel_id, guild_id, after_message_id, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(surfaceKey, ownerId, channelId, guildId, boundary, nowMs);
    sidecar.exec("COMMIT");
    return { initialized: true, surfaceKey, afterMessageId: boundary };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function compareTransportIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export function recordOwnerTransportHistoryPage(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  input: {
    surface: OwnerTransportSurface;
    afterMessageId: string;
    nextAfterMessageId: string;
    captures: OwnerTransportCaptureInput[];
  },
  options: { nowMs?: number } = {},
): OwnerTransportHistoryPageResult {
  const nowMs = options.nowMs ?? Date.now();
  const ownerId = requiredId(input.surface.ownerId, "owner_transport_owner_invalid");
  const channelId = requiredId(input.surface.channelId, "owner_transport_surface_invalid");
  const guildId = optionalGuildId(input.surface.guildId);
  const surfaceKey = ownerTransportSurfaceKey({ ownerId, channelId, guildId });
  const afterMessageId = requiredId(input.afterMessageId, "owner_transport_cursor_invalid");
  const nextAfterMessageId = requiredId(input.nextAfterMessageId, "owner_transport_cursor_invalid");
  if (compareTransportIds(nextAfterMessageId, afterMessageId) <= 0) {
    throw new Error("owner_transport_cursor_not_advanced");
  }

  const normalizedCaptures = input.captures.map((capture) => {
    const normalized = normalizeCapture({
      ...capture,
      ownerId,
      channelId,
      guildId,
      capturedAtMs: capture.capturedAtMs || nowMs,
    }, nuclearDb, nowMs);
    if (normalized.surfaceKey !== surfaceKey) throw new Error("owner_transport_surface_conflict");
    return normalized;
  });

  sidecar.exec("BEGIN IMMEDIATE");
  try {
    const cursor = readCursor(sidecar, surfaceKey);
    if (!cursor || cursor.after_message_id !== afterMessageId) {
      throw new Error("owner_transport_cursor_conflict");
    }
    let newlyCaptured = 0;
    let duplicates = 0;
    for (const capture of normalizedCaptures) {
      if (insertCaptureInTransaction(sidecar, capture, "history")) newlyCaptured += 1;
      else duplicates += 1;
    }
    sidecar.prepare(
      `UPDATE owner_discord_transport_cursors
          SET after_message_id = ?, updated_at_ms = ?
        WHERE surface_key = ? AND after_message_id = ?`,
    ).run(nextAfterMessageId, nowMs, surfaceKey, afterMessageId);
    sidecar.exec("COMMIT");
    return { accepted: true, surfaceKey, afterMessageId: nextAfterMessageId, newlyCaptured, duplicates };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

export function listPendingOwnerTransport(
  sidecar: DatabaseSync,
  ownerId: string,
  options: { surfaceKey?: string; limit?: number; nowMs?: number } = {},
): OwnerTransportPendingCapture[] {
  const normalizedOwnerId = requiredId(ownerId, "owner_transport_owner_invalid");
  const rawLimit = options.limit ?? MAX_PENDING_LIMIT;
  if (!Number.isFinite(rawLimit)) throw new Error("owner_transport_limit_invalid");
  const limit = Math.max(1, Math.min(MAX_PENDING_LIMIT, Math.floor(rawLimit)));
  const nowMs = options.nowMs ?? Date.now();
  sidecar.exec("BEGIN IMMEDIATE");
  try {
    // A crashed mark-after-ingress window is reconciled before replay grouping.
    // Discord message IDs are global transport identities, so an existing
    // canonical evidence mapping is sufficient to prove semantic admission.
    sidecar.prepare(
      `UPDATE owner_discord_transport_captures
          SET admitted_at_ms = ?
        WHERE owner_id = ?
          AND admitted_at_ms IS NULL
          AND EXISTS (
            SELECT 1
              FROM conversation_evidence_discord_ids d
             WHERE d.discord_message_id = owner_discord_transport_captures.discord_message_id
          )`,
    ).run(nowMs, normalizedOwnerId);
    const rows = sidecar.prepare(
      `SELECT *
         FROM owner_discord_transport_captures
        WHERE owner_id = ?
          AND admitted_at_ms IS NULL
          ${options.surfaceKey ? "AND surface_key = ?" : ""}
        ORDER BY sent_at_ms ASC, captured_at_ms ASC, discord_message_id ASC
        LIMIT ?`,
    ).all(...(options.surfaceKey
      ? [normalizedOwnerId, options.surfaceKey, limit]
      : [normalizedOwnerId, limit])) as DbCaptureRow[];
    sidecar.exec("COMMIT");
    return rows.map(mapCapture);
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

export function markOwnerTransportAdmitted(
  sidecar: DatabaseSync,
  ownerId: string,
  discordMessageIds: string[],
  options: { nowMs?: number } = {},
): { marked: number; alreadyAdmitted: number } {
  const normalizedOwnerId = requiredId(ownerId, "owner_transport_owner_invalid");
  const ids = [...new Set(discordMessageIds.map((id) => requiredId(id, "owner_transport_message_id_invalid")))];
  if (ids.length > MAX_PENDING_LIMIT) throw new Error("owner_transport_batch_too_large");
  const nowMs = options.nowMs ?? Date.now();
  sidecar.exec("BEGIN IMMEDIATE");
  try {
    let marked = 0;
    let alreadyAdmitted = 0;
    for (const id of ids) {
      const result = sidecar.prepare(
        `UPDATE owner_discord_transport_captures
            SET admitted_at_ms = ?
          WHERE owner_id = ? AND discord_message_id = ? AND admitted_at_ms IS NULL`,
      ).run(nowMs, normalizedOwnerId, id);
      if (Number(result.changes) === 1) marked += 1;
      else {
        const existing = sidecar.prepare(
          "SELECT admitted_at_ms FROM owner_discord_transport_captures WHERE owner_id = ? AND discord_message_id = ?",
        ).get(normalizedOwnerId, id) as { admitted_at_ms?: unknown } | undefined;
        if (existing?.admitted_at_ms != null) alreadyAdmitted += 1;
      }
    }
    sidecar.exec("COMMIT");
    return { marked, alreadyAdmitted };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function requestBody(req: express.Request): Record<string, unknown> {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("owner_transport_body_invalid");
  }
  return body as Record<string, unknown>;
}

function requestString(value: unknown, code: string): string {
  return requiredId(value, code);
}

function requestSurface(body: Record<string, unknown>): OwnerTransportSurface {
  return {
    ownerId: requestString(body.userId, "owner_required"),
    channelId: requestString(body.channelId, "owner_transport_surface_invalid"),
    guildId: optionalGuildId(body.guildId),
  };
}

function requestCapture(
  body: Record<string, unknown>,
  surface: OwnerTransportSurface,
  nowMs: number,
): OwnerTransportCaptureInput {
  return {
    ...surface,
    discordMessageId: requestString(body.discordMessageId, "owner_transport_message_id_invalid"),
    text: typeof body.message === "string" ? body.message : "",
    attachments: attachmentRefs(body.attachments ?? []),
    ownerRoomContext: ownerRoomContext(body.ownerRoomContext),
    sentAtMs: finiteTimestamp(body.sentAtMs, "owner_transport_sent_at_invalid"),
    capturedAtMs: body.capturedAtMs === undefined ? nowMs : finiteTimestamp(body.capturedAtMs, "owner_transport_captured_at_invalid"),
  };
}

function handlerStatus(error: unknown): number {
  const status = parseRecord(error)?.status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "owner_required" || message === "Forbidden") return 403;
  if (message === "owner_transport_cursor_conflict" || message === "owner_transport_capture_conflict") return 409;
  return 400;
}

function handlerError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

export type OwnerTransportHttpOptions = {
  sidecar: DatabaseSync;
  nuclearDb: DatabaseSync;
  authorizeOwner: (userId: string) => void;
  authorizeBotService: (req: express.Request) => void;
  nowMs?: () => number;
};

export function createOwnerTransportCaptureHandler(options: OwnerTransportHttpOptions): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService(req);
      const body = requestBody(req);
      const nowMs = options.nowMs?.() ?? Date.now();
      const surface = requestSurface(body);
      options.authorizeOwner(surface.ownerId);
      const result = captureOwnerTransport(
        options.sidecar,
        options.nuclearDb,
        requestCapture(body, surface, nowMs),
        { nowMs },
      );
      res.status(202).json(result);
    } catch (error) {
      res.status(handlerStatus(error)).json(handlerError(error));
    }
  };
}

export function createOwnerTransportStateHandler(options: OwnerTransportHttpOptions): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService(req);
      const ownerId = requestString(req.query.user_id, "owner_required");
      options.authorizeOwner(ownerId);
      const channelId = requestString(req.query.channel_id, "owner_transport_surface_invalid");
      const guildId = optionalGuildId(req.query.guild_id);
      const result = ensureOwnerTransportCursor(
        options.sidecar,
        options.nuclearDb,
        { ownerId, channelId, guildId },
        { nowMs: options.nowMs?.() ?? Date.now() },
      );
      res.json(result);
    } catch (error) {
      res.status(handlerStatus(error)).json(handlerError(error));
    }
  };
}

export function createOwnerTransportHistoryPageHandler(options: OwnerTransportHttpOptions): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService(req);
      const body = requestBody(req);
      const surface = requestSurface(body);
      options.authorizeOwner(surface.ownerId);
      if (!Array.isArray(body.messages) || body.messages.length > MAX_PENDING_LIMIT) {
        throw new Error("owner_transport_history_page_invalid");
      }
      const nowMs = options.nowMs?.() ?? Date.now();
      const captures = body.messages.map((value) => {
        const row = parseRecord(value);
        if (!row) throw new Error("owner_transport_history_message_invalid");
        return requestCapture(row, surface, nowMs);
      });
      const result = recordOwnerTransportHistoryPage(
        options.sidecar,
        options.nuclearDb,
        {
          surface,
          afterMessageId: requestString(body.afterMessageId, "owner_transport_cursor_invalid"),
          nextAfterMessageId: requestString(body.nextAfterMessageId, "owner_transport_cursor_invalid"),
          captures,
        },
        { nowMs },
      );
      res.status(202).json(result);
    } catch (error) {
      res.status(handlerStatus(error)).json(handlerError(error));
    }
  };
}

export function createOwnerTransportPendingHandler(options: OwnerTransportHttpOptions): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService(req);
      const ownerId = requestString(req.query.user_id, "owner_required");
      options.authorizeOwner(ownerId);
      const surfaceKey = typeof req.query.surface_key === "string" && req.query.surface_key.trim()
        ? req.query.surface_key.trim()
        : undefined;
      const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const result = listPendingOwnerTransport(options.sidecar, ownerId, {
        surfaceKey,
        limit: rawLimit,
        nowMs: options.nowMs?.() ?? Date.now(),
      });
      res.json({ captures: result });
    } catch (error) {
      res.status(handlerStatus(error)).json(handlerError(error));
    }
  };
}

export function createOwnerTransportMarkAdmittedHandler(options: OwnerTransportHttpOptions): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService(req);
      const body = requestBody(req);
      const ownerId = requestString(body.userId, "owner_required");
      options.authorizeOwner(ownerId);
      if (!Array.isArray(body.discordMessageIds)) throw new Error("owner_transport_message_ids_invalid");
      const result = markOwnerTransportAdmitted(
        options.sidecar,
        ownerId,
        body.discordMessageIds.map((id) => requestString(id, "owner_transport_message_id_invalid")),
        { nowMs: options.nowMs?.() ?? Date.now() },
      );
      res.status(202).json({ ok: true, ...result });
    } catch (error) {
      res.status(handlerStatus(error)).json(handlerError(error));
    }
  };
}
