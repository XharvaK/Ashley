import type { DatabaseSync } from "node:sqlite";
import type {
  Question,
  QuestionStatus,
  QuestionSubject,
} from "../types.js";

type QuestionInput = {
  ownerId: string;
  subject: QuestionSubject;
  text: string;
  priority?: number;
};

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function mapQuestion(row: unknown): Question | null {
  if (!isRow(row)) return null;
  const subject = stringValue(row.subject);
  const status = stringValue(row.status);
  if (
    (subject !== "about_doc" &&
      subject !== "about_self" &&
      subject !== "about_world") ||
    (status !== "open" &&
      status !== "pursuing" &&
      status !== "resolved" &&
      status !== "forgotten")
  ) {
    return null;
  }
  return {
    id: numberValue(row.id),
    ownerId: stringValue(row.owner_id),
    subject,
    text: stringValue(row.text),
    status,
    priority: numberValue(row.priority),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
  };
}

export function createQuestion(db: DatabaseSync, input: QuestionInput): number;
export function createQuestion(
  db: DatabaseSync,
  ownerId: string,
  subject: QuestionSubject,
  text: string,
  priority?: number,
): number;
export function createQuestion(
  db: DatabaseSync,
  inputOrOwner: QuestionInput | string,
  subject?: QuestionSubject,
  text?: string,
  priority = 0.5,
): number {
  const input: QuestionInput =
    typeof inputOrOwner === "string"
      ? {
          ownerId: inputOrOwner,
          subject: subject ?? "about_doc",
          text: text ?? "",
          priority,
        }
      : inputOrOwner;
  const cleanText = input.text.trim();
  if (!cleanText) return 0;
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, NULL)`,
    )
    .run(
      input.ownerId,
      input.subject,
      cleanText,
      Math.max(0, Math.min(100, input.priority ?? 0.5)),
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function listOpenQuestions(
  db: DatabaseSync,
  ownerId: string,
  limit = 20,
): Question[] {
  if (limit <= 0) return [];
  const rows = db
    .prepare(
      `SELECT id, owner_id, subject, text, status, priority,
              created_at, updated_at, resolved_at
       FROM questions
       WHERE owner_id = ? AND status IN ('open', 'pursuing')
       ORDER BY priority DESC, updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(ownerId, Math.min(100, limit))
    .map(mapQuestion)
    .filter((question): question is Question => question !== null);
  return rows;
}

export function updateQuestionStatus(
  db: DatabaseSync,
  questionId: number,
  status: QuestionStatus,
): void;
export function updateQuestionStatus(
  db: DatabaseSync,
  ownerId: string,
  questionId: number,
  status: QuestionStatus,
): void;
export function updateQuestionStatus(
  db: DatabaseSync,
  first: number | string,
  second: number | QuestionStatus,
  third?: QuestionStatus,
): void {
  const ownerId = typeof first === "string" ? first : null;
  const questionId = typeof first === "number" ? first : second;
  const status = typeof first === "number" ? second : third;
  if (typeof questionId !== "number" || status === undefined) return;
  const resolvedAt =
    status === "resolved" || status === "forgotten"
      ? new Date().toISOString()
      : null;
  const ownerClause = ownerId === null ? "" : " AND owner_id = ?";
  const params: Array<string | number | null> =
    ownerId === null
      ? [status, resolvedAt, new Date().toISOString(), questionId]
      : [status, resolvedAt, new Date().toISOString(), questionId, ownerId];
  db.prepare(
    `UPDATE questions
     SET status = ?, resolved_at = ?, updated_at = ?
     WHERE id = ?${ownerClause}`,
  ).run(...params);
}

export function bumpPriority(
  db: DatabaseSync,
  questionId: number,
  amount = 0.1,
): void {
  db.prepare(
    `UPDATE questions
     SET priority = MIN(100, MAX(0, priority + ?)), updated_at = ?
     WHERE id = ? AND status IN ('open', 'pursuing')`,
  ).run(amount, new Date().toISOString(), questionId);
}

export function resolveQuestion(db: DatabaseSync, questionId: number): void {
  updateQuestionStatus(db, questionId, "resolved");
}

export function buildQuestionsBlock(
  db: DatabaseSync,
  ownerId: string,
): string {
  const questions = listOpenQuestions(db, ownerId, 12);
  if (questions.length === 0) return "";
  return [
    "## Open questions",
    ...questions.map(
      (question) =>
        `- [${question.subject}] ${question.text} (priority ${question.priority.toFixed(2)})`,
    ),
    "Ask or revisit one only when it fits the live conversation.",
  ].join("\n");
}
