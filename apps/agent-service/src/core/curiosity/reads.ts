import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { htmlToText, logProvenance } from "./feed.js";
import { recordLiveShadowEvent } from "../rollout/capabilities.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import { listOpenQuestions } from "../state/questions.js";
import type { EvidenceProvenance } from "../types.js";
import { listActiveLearnedInfluences } from "../learned-autonomy/eligibility.js";
import { recordChoiceReceipt } from "../learned-autonomy/receipts.js";
import type { LearnedAutonomyMode, LearnedInfluence } from "../learned-autonomy/types.js";
import {
  fetchValidatedResource,
  type FetchLike,
  type ResolveHost,
} from "./network.js";

export type ReadRecord = {
  id: number;
  itemId: number;
  finalUrl: string;
  contentHash: string;
  retrievedAt: string;
  model: string;
  modelMetadata: Record<string, unknown>;
  evidenceExcerpts: string[];
  cleanedChars: number;
  title: string;
  interest: string;
  provenance: EvidenceProvenance;
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRow(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseExcerpts(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapRead(value: unknown): ReadRecord | null {
  if (!isRow(value)) return null;
  return {
    id: Number(value.id),
    itemId: Number(value.item_id),
    finalUrl: String(value.final_url ?? ""),
    contentHash: String(value.content_hash ?? ""),
    retrievedAt: String(value.retrieved_at ?? ""),
    model: String(value.model ?? ""),
    modelMetadata: parseObject(value.model_metadata_json),
    evidenceExcerpts: parseExcerpts(value.evidence_excerpts_json),
    cleanedChars: Number(value.cleaned_chars ?? 0),
    title: String(value.title ?? ""),
    interest: String(value.interest ?? ""),
    provenance: value.provenance === "live" ? "live" : "shadow",
  };
}

function readById(db: DatabaseSync, readId: number): ReadRecord | null {
  const row = db.prepare(
    `SELECT r.id, r.item_id, r.final_url, r.content_hash, r.retrieved_at,
            r.model, r.model_metadata_json, r.evidence_excerpts_json,
            r.cleaned_chars, i.title, i.interest, r.provenance
     FROM cur_reads r
     JOIN cur_items i ON i.id = r.item_id
     WHERE r.id = ?
     LIMIT 1`,
  ).get(readId);
  return mapRead(row);
}

export function recordSuccessfulRead(
  db: DatabaseSync,
  input: {
    itemId: number;
    finalUrl: string;
    contentHash: string;
    retrievedAt?: string;
    model: string;
    modelMetadata?: Record<string, unknown>;
    evidenceExcerpts: string[];
    cleanedChars: number;
    provenance?: EvidenceProvenance;
  },
): number {
  const finalUrl = input.finalUrl.trim().slice(0, 2000);
  const hash = input.contentHash.trim().toLowerCase();
  const model = input.model.trim().slice(0, 200);
  if (!finalUrl || !/^[a-f0-9]{64}$/.test(hash) || !model) return 0;
  const excerpts = input.evidenceExcerpts
    .map((excerpt) => excerpt.replace(/\s+/g, " ").trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 6);
  if (excerpts.length === 0) return 0;
  const now = new Date().toISOString();
  const provenance = input.provenance ?? "shadow";
  db.prepare(
    `INSERT INTO cur_reads
       (item_id, final_url, content_hash, retrieved_at, model,
        model_metadata_json, evidence_excerpts_json, cleaned_chars, created_at,
        provenance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       final_url = excluded.final_url,
       content_hash = excluded.content_hash,
       retrieved_at = excluded.retrieved_at,
       model = excluded.model,
       model_metadata_json = excluded.model_metadata_json,
       evidence_excerpts_json = excluded.evidence_excerpts_json,
       cleaned_chars = excluded.cleaned_chars,
       provenance = excluded.provenance`,
  ).run(
    input.itemId,
    finalUrl,
    hash,
    input.retrievedAt ?? now,
    model,
    JSON.stringify(input.modelMetadata ?? {}),
    JSON.stringify(excerpts),
    Math.max(0, Math.min(50_000, Math.trunc(input.cleanedChars))),
    now,
    provenance,
  );
  const existing = db.prepare(
    "SELECT id FROM cur_reads WHERE item_id = ?",
  ).get(input.itemId) as { id?: number } | undefined;
  return Number(existing?.id ?? 0);
}

export function listRecentReads(
  db: DatabaseSync,
  limit = 12,
): ReadRecord[] {
  return db.prepare(
    `SELECT r.id, r.item_id, r.final_url, r.content_hash, r.retrieved_at,
            r.model, r.model_metadata_json, r.evidence_excerpts_json,
            r.cleaned_chars, i.title, i.interest, r.provenance
     FROM cur_reads r
     JOIN cur_items i ON i.id = r.item_id
     ORDER BY r.retrieved_at DESC, r.id DESC
     LIMIT ?`,
  ).all(Math.max(1, Math.min(100, limit)))
    .map(mapRead)
    .filter((record): record is ReadRecord => record !== null);
}

type Candidate = {
  id: number;
  url: string;
  title: string;
  interest: string;
  score: number;
  excerpt: string;
};

type RankedCandidate = Candidate & {
  learnedInfluenceIds: number[];
  learnedBoost: number;
};

function utcDayStart(now: Date): string {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )).toISOString();
}

function evidenceExcerpts(cleaned: string): string[] {
  const paragraphs = cleaned
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 40);
  const source = paragraphs.length > 0 ? paragraphs : [cleaned];
  return source.map((part) => part.slice(0, 500)).filter(Boolean).slice(0, 6);
}

function learnedTokens(influence: LearnedInfluence): string[] {
  return `${influence.semanticOwnerRef} ${influence.text}`
    .toLowerCase()
    .match(/[a-z0-9]{4,}/g) ?? [];
}

function learnedRankEffect(
  candidate: Candidate,
  learned: LearnedInfluence[],
): { learnedInfluenceIds: number[]; learnedBoost: number } {
  const candidateText = `${candidate.interest} ${candidate.title} ${candidate.excerpt}`.toLowerCase();
  const matched = learned.filter((influence) => {
    const tokens = learnedTokens(influence);
    const directRef = influence.semanticOwnerRef.toLowerCase().split(":").pop() ?? "";
    return (directRef.length >= 4 && candidateText.includes(directRef)) ||
      tokens.filter((token) => candidateText.includes(token)).length >= 2;
  });
  return {
    learnedInfluenceIds: matched.map((influence) => influence.id),
    learnedBoost: Math.min(40, matched.length * 32),
  };
}

function hashForChoice(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function performGroundedReads(
  db: DatabaseSync,
  ownerId: string,
  dependencies: {
    fetcher?: FetchLike;
    resolve?: ResolveHost;
    learnedAutonomyMode?: LearnedAutonomyMode;
  } = {},
  now = new Date(),
): Promise<{ readsCreated: number; reads: ReadRecord[]; errors: string[] }> {
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN json_extract(model_metadata_json, '$.selectionLane') = 'interest' THEN 1 ELSE 0 END) AS interest_count,
       SUM(CASE WHEN json_extract(model_metadata_json, '$.selectionLane') = 'exploration' THEN 1 ELSE 0 END) AS exploration_count
     FROM cur_reads WHERE retrieved_at >= ?`,
  ).get(utcDayStart(now)) as { interest_count?: number; exploration_count?: number } | undefined;
  let interestBudget = Math.max(0, 10 - Number(counts?.interest_count ?? 0));
  let explorationBudget = Math.max(0, 2 - Number(counts?.exploration_count ?? 0));
  if (interestBudget + explorationBudget === 0) return { readsCreated: 0, reads: [], errors: [] };

  const activeLearned = dependencies.learnedAutonomyMode === "dark_apply"
    ? listActiveLearnedInfluences(db, ownerId, {
      mode: dependencies.learnedAutonomyMode,
      at: now,
    })
    : [];

  const candidates: RankedCandidate[] = db.prepare(
    `SELECT i.id, i.url, i.title, i.interest, i.score, i.excerpt
     FROM cur_items i
     LEFT JOIN cur_reads r ON r.item_id = i.id
     WHERE r.id IS NULL AND i.status = 'scanned'
     ORDER BY i.score DESC, COALESCE(i.published_at, i.seen_at) DESC, i.id DESC
     LIMIT 120`,
  ).all().map((row) => {
    const value = row as Record<string, unknown>;
    const candidate = {
      id: Number(value.id),
      url: String(value.url),
      title: String(value.title),
      interest: String(value.interest),
      score: Number(value.score),
      excerpt: String(value.excerpt),
    } satisfies Candidate;
    return {
      ...candidate,
      ...learnedRankEffect(
        candidate,
        activeLearned,
      ),
    } satisfies RankedCandidate;
  });
  const questionTokens = new Set(
    listOpenQuestions(db, ownerId, 12)
      .flatMap((question) => question.text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []),
  );
  candidates.sort((left, right) => {
    const relevance = (candidate: RankedCandidate) => {
      const text = `${candidate.title} ${candidate.excerpt}`.toLowerCase();
      let overlap = 0;
      for (const token of questionTokens) if (text.includes(token)) overlap++;
      return candidate.score + Math.min(50, overlap * 10) + candidate.learnedBoost;
    };
    return relevance(right) - relevance(left) || right.id - left.id;
  });
  const selected = [
    ...candidates.filter((item) => item.interest !== "wildcard").slice(0, interestBudget)
      .map((item) => ({ item, lane: "interest" as const })),
    ...candidates.filter((item) => item.interest === "wildcard").slice(0, explorationBudget)
      .map((item) => ({ item, lane: "exploration" as const })),
  ];
  let readsCreated = 0;
  const reads: ReadRecord[] = [];
  const errors: string[] = [];
  const liveAuthority = capabilityCanInfluence(db, "reading");
  for (const { item, lane } of selected) {
    try {
      const resource = await fetchValidatedResource(item.url, {
        accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8",
        ...dependencies,
      });
      if (resource.contentType && !/(?:text\/|html|xhtml|xml)/.test(resource.contentType)) {
        throw new Error("unsupported_content_type");
      }
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(resource.body);
      const cleanedFull = htmlToText(raw).replace(/\s+\n/g, "\n").trim();
      const cleanedInput = cleanedFull.slice(0, 50_000);
      const excerpts = evidenceExcerpts(cleanedInput);
      if (cleanedInput.length < 200 || excerpts.length === 0) throw new Error("insufficient_content");
      const readId = recordSuccessfulRead(db, {
        itemId: item.id,
        finalUrl: resource.finalUrl,
        contentHash: createHash("sha256").update(cleanedFull).digest("hex"),
        retrievedAt: now.toISOString(),
        model: "deterministic-html-extractor-v1",
        modelMetadata: {
          selectionLane: lane,
          sourceBytes: resource.body.byteLength,
          contentType: resource.contentType,
          inputTrust: "untrusted_evidence",
        },
        evidenceExcerpts: excerpts,
        cleanedChars: cleanedInput.length,
        provenance: liveAuthority ? "live" : "shadow",
      });
      if (!readId) throw new Error("read_record_rejected");
      if (item.learnedInfluenceIds.length > 0) {
        const inputCandidateIds = candidates.map((candidate) => candidate.id);
        for (const learnedInfluenceId of item.learnedInfluenceIds) {
          recordChoiceReceipt(db, {
            learnedInfluenceId,
            choiceKind: "curiosity_rank",
            candidateIds: inputCandidateIds,
            selectedIds: [item.id],
            rankDelta: { [String(item.id)]: item.learnedBoost },
            policyBinding: "c3-curiosity-rank-v1",
            reasonCode: "qualified_learned_interest",
            inputContentHash: hashForChoice(inputCandidateIds),
            outputContentHash: hashForChoice({ selected: item.id, rank: item.learnedBoost }),
            eligibleInputAffectedRanking: true,
            agencyMadeFinalChoice: false,
          });
        }
      }
      db.prepare("UPDATE cur_items SET status = 'read' WHERE id = ?").run(item.id);
      logProvenance(db, "read", `${ownerId}:read:${readId}:${resource.finalUrl}`, item.id);
      recordLiveShadowEvent(db, "reading", `read:${readId}`);
      const read = readById(db, readId);
      if (!read) throw new Error("read_record_missing");
      reads.push(read);
      readsCreated++;
      if (lane === "interest") interestBudget--;
      else explorationBudget--;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`item:${item.id}:${message}`);
      try {
        db.prepare("UPDATE cur_items SET status = 'skipped' WHERE id = ? AND status = 'scanned'")
          .run(item.id);
      } catch { /* preserve the original mechanical read failure */ }
    }
  }
  return { readsCreated, reads, errors };
}
