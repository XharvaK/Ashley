import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DataPlaneContext } from "./core/data-plane.js";

export type LogMessage = {
  ts: string;
  role: "user" | "assistant" | "tool" | "system";
  text?: string;
  source?: string;
  session_id: string;
  run_id?: string;
  agent_id?: string;
  model?: string;
  duration_ms?: number;
  name?: string;
  status?: string;
  call_id?: string;
  whisper_lang?: string;
};

export type SessionMeta = {
  session_id: string;
  started_at: string;
  ended_at: string | null;
  agent_id: string | null;
  message_count: number;
  title: string | null;
};

export class ConversationLogger {
  private db: DatabaseSync;
  private readonly dataPlane: DataPlaneContext;

  constructor(dataPlane: DataPlaneContext, existingDb?: DatabaseSync) {
    this.dataPlane = dataPlane;
    mkdirSync(dataPlane.sessionsDir, { recursive: true });
    mkdirSync(dataPlane.conversationsDir, { recursive: true });
    this.db = existingDb ?? new DatabaseSync(dataPlane.archiveDbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at TEXT,
        ended_at TEXT,
        title TEXT,
        agent_id TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        ts TEXT,
        role TEXT,
        text TEXT,
        run_id TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_text ON messages(text);
    `);
  }

  sessionDir(sessionId: string): string {
    const dir = join(this.dataPlane.sessionsDir, sessionId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  createSession(sessionId: string, agentId: string | null): SessionMeta {
    const meta: SessionMeta = {
      session_id: sessionId,
      started_at: new Date().toISOString(),
      ended_at: null,
      agent_id: agentId,
      message_count: 0,
      title: null,
    };
    const dir = this.sessionDir(sessionId);
    writeFileSync(join(dir, "session.json"), JSON.stringify(meta, null, 2));
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, started_at, ended_at, title, agent_id) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, meta.started_at, null, null, agentId);
    return meta;
  }

  endSession(sessionId: string): void {
    const ended = new Date().toISOString();
    const dir = join(this.dataPlane.sessionsDir, sessionId);
    const path = join(dir, "session.json");
    if (existsSync(path)) {
      const meta = JSON.parse(readFileSync(path, "utf-8")) as SessionMeta;
      meta.ended_at = ended;
      writeFileSync(path, JSON.stringify(meta, null, 2));
    }
    this.db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(ended, sessionId);
  }

  append(msg: LogMessage): void {
    const dir = this.sessionDir(msg.session_id);
    const jsonl = join(dir, "messages.jsonl");
    appendFileSync(jsonl, JSON.stringify(msg) + "\n");

    this.db
      .prepare(
        `INSERT INTO messages (session_id, ts, role, text, run_id) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        msg.session_id,
        msg.ts,
        msg.role,
        msg.text ?? null,
        msg.run_id ?? null,
      );

    const sessionPath = join(dir, "session.json");
    if (existsSync(sessionPath)) {
      const meta = JSON.parse(readFileSync(sessionPath, "utf-8")) as SessionMeta;
      meta.message_count += 1;
      if (msg.role === "user" && msg.text && !meta.title) {
        meta.title = msg.text.slice(0, 80);
        this.db
          .prepare(`UPDATE sessions SET title = ? WHERE id = ?`)
          .run(meta.title, msg.session_id);
      }
      writeFileSync(sessionPath, JSON.stringify(meta, null, 2));
    }
  }

  listSessions(limit = 50): SessionMeta[] {
    const rows = this.db
      .prepare(
        `SELECT id as session_id, started_at, ended_at, title, agent_id FROM sessions ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit) as SessionMeta[];
    return rows.map((r) => ({
      ...r,
      message_count: 0,
    }));
  }

  checkpoint(): void {
    // node:sqlite auto-persists
  }

  getDb(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
