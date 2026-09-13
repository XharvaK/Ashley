import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { redactObserverText, isSecretClassification } from "./privacy.js";
import { allowlistedRows, tableColumns, tableExists, scalarJson } from "./sqlite.js";
import type {
  FieldDayWindow,
  TranscriptAssembly,
  TranscriptConflict,
  TranscriptDocument,
  TranscriptGap,
  TranscriptMessage,
  TranscriptSession,
} from "./types.js";

const JOIN_WINDOW_MS = 5 * 60 * 1000;

type RawMessage = Record<string, unknown> & {
  ts?: unknown;
  role?: unknown;
  text?: unknown;
};

type PrimaryRecord = {
  sessionId: string;
  raw: RawMessage;
  ts: string;
  role: "user" | "assistant";
  text: string;
  message: TranscriptMessage;
  order: number;
};

type NuclearRecord = {
  id: number | string;
  role: "user" | "assistant";
  text: string;
  ts: string;
};

function parseTimestamp(value: unknown): { text: string; milliseconds: number } | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) return null;
  return { text: value, milliseconds };
}

function normalizeForJoin(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function textHash(text: string): string {
  return createHash("sha256")
    .update(Buffer.from(normalizeForJoin(text), "utf8"))
    .digest("hex");
}

function idValue(value: unknown): number | string | null {
  const scalar = scalarJson(value);
  return typeof scalar === "number" || typeof scalar === "string" ? scalar : null;
}

function roleValue(value: unknown): "user" | "assistant" | null {
  return value === "user" || value === "assistant" ? value : null;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function channelValue(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "unknown";
}

function readSessionChannel(sessionPath: string, messages: RawMessage[]): string {
  try {
    const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown>;
    if (typeof parsed.channel === "string" && parsed.channel.trim() !== "") {
      return parsed.channel;
    }
  } catch {
    // A missing or malformed session sidecar does not authorize invented identity.
  }
  const messageChannel = messages.find((message) => typeof message.channel === "string");
  return channelValue(messageChannel?.channel);
}

function readPrimary(
  sessionsRoot: string,
  window: FieldDayWindow,
): {
  sessions: TranscriptSession[];
  primary: PrimaryRecord[];
  gaps: TranscriptGap[];
  complete: boolean;
} {
  try {
    if (!existsSync(sessionsRoot) || !statSync(sessionsRoot).isDirectory()) {
      return {
        sessions: [],
        primary: [],
        gaps: [{ class: "MISSING_JSONL", detail: "sessions_root_missing" }],
        complete: false,
      };
    }
  } catch {
    return {
      sessions: [],
      primary: [],
      gaps: [{ class: "UNKNOWN", detail: "sessions_root_unreadable" }],
      complete: false,
    };
  }
  const gaps: TranscriptGap[] = [];
  const primary: PrimaryRecord[] = [];
  const sessions: TranscriptSession[] = [];
  let complete = true;
  let entries: string[];
  try {
    entries = readdirSync(sessionsRoot);
  } catch {
    return {
      sessions: [],
      primary: [],
      gaps: [{ class: "UNKNOWN", detail: "sessions_root_unreadable" }],
      complete: false,
    };
  }
  const sessionIds: string[] = [];
  for (const entry of entries) {
    try {
      if (statSync(join(sessionsRoot, entry)).isDirectory()) sessionIds.push(entry);
    } catch {
      complete = false;
      gaps.push({ class: "UNKNOWN", detail: `session_entry_unreadable:${entry}` });
    }
  }
  sessionIds.sort((a, b) => a.localeCompare(b));
  for (const sessionId of sessionIds) {
    const sessionDir = join(sessionsRoot, sessionId);
    const messagesPath = join(sessionDir, "messages.jsonl");
    const sessionPath = join(sessionDir, "session.json");
    if (!existsSync(sessionPath)) {
      complete = false;
      gaps.push({ class: "MISSING_JSONL", detail: `session_json_missing:${sessionId}` });
    } else {
      try {
        JSON.parse(readFileSync(sessionPath, "utf8"));
      } catch {
        complete = false;
        gaps.push({ class: "UNKNOWN", detail: `session_json_invalid:${sessionId}` });
      }
    }
    if (!existsSync(messagesPath)) {
      complete = false;
      gaps.push({ class: "MISSING_JSONL", detail: `messages_jsonl_missing:${sessionId}` });
      continue;
    }
    const rawMessages: RawMessage[] = [];
    const records: PrimaryRecord[] = [];
    let messageText: string;
    try {
      messageText = readFileSync(messagesPath, "utf8");
    } catch {
      complete = false;
      gaps.push({ class: "UNKNOWN", detail: `messages_jsonl_unreadable:${sessionId}` });
      continue;
    }
    const lines = messageText.split(/\r?\n/u);
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber += 1;
      if (line.trim() === "") continue;
      let raw: RawMessage;
      try {
        raw = JSON.parse(line) as RawMessage;
      } catch {
        complete = false;
        gaps.push({ class: "UNKNOWN", detail: `messages_jsonl_invalid:${sessionId}:${lineNumber}` });
        continue;
      }
      rawMessages.push(raw);
      const role = roleValue(raw.role);
      const timestamp = parseTimestamp(raw.ts);
      if (!role || !timestamp) continue;
      if (timestamp.milliseconds < window.start.getTime() || timestamp.milliseconds >= window.end.getTime()) continue;
      if (isSecretClassification(raw.data_classification)) continue;
      const originalText = safeText(raw.text);
      const message: TranscriptMessage = {
        ts: timestamp.text,
        role,
        text_redacted: redactObserverText(originalText),
        source: typeof raw.source === "string" ? raw.source : null,
        run_id: typeof raw.run_id === "string" ? raw.run_id : null,
        decision_id: idValue(raw.decision_id),
        episode_id: idValue(raw.episode_id),
        provenance: raw.provenance === "live" || raw.provenance === "shadow" ? raw.provenance : "unknown",
        nuclear_message_id: idValue(raw.nuclear_message_id ?? raw.nuclearMessageId),
        join_method: null,
        join_confidence: null,
      };
      records.push({ sessionId, raw, ts: timestamp.text, role, text: originalText, message, order: lineNumber });
    }
    records.sort((a, b) => {
      const byTime = Date.parse(a.ts) - Date.parse(b.ts);
      return byTime !== 0 ? byTime : a.order - b.order;
    });
    primary.push(...records);
    sessions.push({
      session_id: sessionId,
      channel: readSessionChannel(sessionPath, rawMessages),
      messages: records.map((record) => record.message),
    });
  }
  return { sessions, primary, gaps, complete };
}

function readNuclearMessages(db: DatabaseSync, window: FieldDayWindow): NuclearRecord[] {
  if (!tableExists(db, "mem_messages")) return [];
  const columns = tableColumns(db, "mem_messages");
  const requested = ["id", "role", "text", "created_at", "data_classification"];
  const rows = allowlistedRows(db, "mem_messages", requested, { orderBy: "id" });
  return rows.flatMap((row) => {
    if (isSecretClassification(row.data_classification)) return [];
    const role = roleValue(row.role);
    const ts = parseTimestamp(row.created_at);
    const id = idValue(row.id);
    if (!role || !ts || id === null) return [];
    if (ts.milliseconds < window.start.getTime() || ts.milliseconds >= window.end.getTime()) return [];
    if (!columns.has("text")) return [];
    return [{ id, role, text: safeText(row.text), ts: ts.text }];
  });
}

function stableIdFromRaw(raw: RawMessage): number | string | null {
  return idValue(raw.nuclear_message_id ?? raw.nuclearMessageId);
}

function setJoin(message: TranscriptMessage, record: NuclearRecord, method: "stable_identifier" | "timestamp_text_hash"): void {
  message.nuclear_message_id = record.id;
  message.join_method = method;
  message.join_confidence = "high";
}

export function assembleTranscript(input: {
  sessionsRoot: string;
  window: FieldDayWindow;
  nuclear: DatabaseSync | null;
  identity?: TranscriptDocument["identity"];
}): TranscriptAssembly {
  const primaryResult = readPrimary(input.sessionsRoot, input.window);
  const gaps = [...primaryResult.gaps];
  const sourceConflicts: TranscriptConflict[] = [];
  const nuclearMessages = input.nuclear ? readNuclearMessages(input.nuclear, input.window) : [];
  const byId = new Map(nuclearMessages.map((record) => [String(record.id), record]));
  const byHash = new Map<string, NuclearRecord[]>();
  for (const record of nuclearMessages) {
    const bucket = byHash.get(textHash(record.text)) ?? [];
    bucket.push(record);
    byHash.set(textHash(record.text), bucket);
  }
  for (const primary of primaryResult.primary) {
    const stableId = stableIdFromRaw(primary.raw);
    if (stableId !== null) {
      const match = byId.get(String(stableId));
      if (!match) {
        gaps.push({ class: "MISSING_NUCLEAR", detail: `stable_nuclear_message_missing:${stableId}` });
        continue;
      }
      if (match.role !== primary.role || normalizeForJoin(match.text) !== normalizeForJoin(primary.text)) {
        const conflict: TranscriptConflict = {
          session_id: primary.sessionId,
          jsonl: {
            ts: primary.ts,
            role: primary.role,
            text_redacted: primary.message.text_redacted,
          },
          nuclear: {
            id: match.id,
            ts: match.ts,
            role: match.role,
            text_redacted: redactObserverText(match.text),
          },
          reason: "stable_identifier_mismatch",
        };
        sourceConflicts.push(conflict);
        gaps.push({ class: "SOURCE_CONFLICT", detail: `stable_identifier_text_mismatch:${stableId}` });
        continue;
      }
      setJoin(primary.message, match, "stable_identifier");
      continue;
    }
    if (!input.nuclear) {
      primary.message.join_confidence = "none";
      continue;
    }
    const candidates = (byHash.get(textHash(primary.text)) ?? []).filter((candidate) => {
      return candidate.role === primary.role && Math.abs(Date.parse(candidate.ts) - Date.parse(primary.ts)) <= JOIN_WINDOW_MS;
    });
    if (candidates.length === 1) {
      setJoin(primary.message, candidates[0], "timestamp_text_hash");
    } else if (candidates.length > 1) {
      primary.message.join_method = "timestamp_text_hash";
      primary.message.join_confidence = "ambiguous";
      gaps.push({ class: "UNKNOWN", detail: `nuclear_join_ambiguous:${primary.sessionId}:${primary.ts}` });
    } else {
      primary.message.join_confidence = "none";
    }
  }
  const transcript: TranscriptDocument = {
    field_day: input.window.fieldDay,
    identity: input.identity ?? null,
    sessions: primaryResult.sessions,
    gaps,
    source_conflicts: sourceConflicts,
  };
  return {
    coverage: primaryResult.complete ? "NORMAL" : "DEGRADED_PARTIAL",
    transcript,
    gaps,
    source_conflicts: sourceConflicts,
  };
}
