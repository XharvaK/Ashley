import type { DatabaseSync } from "node:sqlite";
import type {
  AssertionKey,
  MindOccupancy,
  WorkingContextItem,
} from "../types.js";

export type RetrievalQuery = {
  exactKeys: AssertionKey[];
  rawTriggerTerms: string[];
  rawTriggerFtsQuery: string | null;
  concernTerms: string[];
  concernFtsQuery: string | null;
  emptyReason?: string;
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}

const APOSTROPHE_VARIANTS = /[\u2018\u2019\u02BC\uFF07\u00B4\u0060]/g;

export function normalizeApostrophes(text: string): string {
  return text.replace(APOSTROPHE_VARIANTS, "'");
}

export function normalizeTextForQuery(text: string): string {
  const nfkc = text.normalize("NFKC");
  const normalizedApostrophes = normalizeApostrophes(nfkc);
  // Rejoin contractions to align with FTS tokenizer word boundaries (e.g. let's -> lets, it's -> its)
  return normalizedApostrophes.replace(/(\p{L}|\p{N})'(\p{L}|\p{N})/giu, "$1$2");
}

export function tokenizeForQuery(text: string): string[] {
  if (!text || !text.trim()) return [];
  const normalized = normalizeTextForQuery(text);
  const words: string[] = [];

  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      for (const seg of segmenter.segment(normalized)) {
        if (seg.isWordLike) {
          words.push(seg.segment);
        }
      }
    } else {
      const matches = normalized.match(/[\p{L}\p{N}]+/gu);
      if (matches) words.push(...matches);
    }
  } catch {
    const matches = normalized.match(/[\p{L}\p{N}]+/gu);
    if (matches) words.push(...matches);
  }

  return unique(
    words
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 2),
  );
}

export function escapeFtsTerm(term: string): string {
  return term.replace(/"/g, '""');
}

export function buildFtsQueryString(terms: string[]): string | null {
  if (!terms || terms.length === 0) return null;
  return terms.map((term) => `"${escapeFtsTerm(term)}"`).join(" OR ");
}

export function resolveExactKeysFromConcerns(
  db: DatabaseSync | undefined,
  concernIds: string[],
): AssertionKey[] {
  if (!db || concernIds.length === 0) return [];
  const uniqueIds = unique(concernIds);
  const exactKeys: AssertionKey[] = [];

  const stmt = db.prepare(
    "SELECT assertion_key FROM concerns WHERE concern_id = ? AND assertion_key IS NOT NULL",
  );

  for (const id of uniqueIds) {
    try {
      const row = stmt.get(id) as { assertion_key: string | null } | undefined;
      if (row?.assertion_key) {
        exactKeys.push(row.assertion_key);
      }
    } catch {
      // Table or concern missing, ignore
    }
  }

  return unique(exactKeys);
}

export type BuildRetrievalQueryInput = {
  triggerText: string;
  workingContext?: WorkingContextItem[];
  occupancy?: MindOccupancy[];
  db?: DatabaseSync;
};

export function buildRetrievalQuery(input: BuildRetrievalQueryInput): RetrievalQuery {
  const rawTriggerTerms = tokenizeForQuery(input.triggerText ?? "");
  const rawTriggerFtsQuery = buildFtsQueryString(rawTriggerTerms);

  const wcTexts = (input.workingContext ?? [])
    .map((wc) => wc.text)
    .filter(Boolean);
  const concernTerms = unique(wcTexts.flatMap((text) => tokenizeForQuery(text)));
  const concernFtsQuery = buildFtsQueryString(concernTerms);

  const concernIds: string[] = [];
  for (const wc of input.workingContext ?? []) {
    if (wc.concernId) concernIds.push(wc.concernId);
  }
  for (const occ of input.occupancy ?? []) {
    if (occ.concernId) concernIds.push(occ.concernId);
  }

  const exactKeys = resolveExactKeysFromConcerns(input.db, concernIds);

  const isEmpty =
    exactKeys.length === 0 &&
    rawTriggerTerms.length === 0 &&
    concernTerms.length === 0;

  return {
    exactKeys,
    rawTriggerTerms,
    rawTriggerFtsQuery,
    concernTerms,
    concernFtsQuery,
    emptyReason: isEmpty ? "no_terms_or_exact_keys" : undefined,
  };
}
