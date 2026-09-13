import { createHash } from "node:crypto";
import type { EpistemicDimensions, MemoryKind, RetrievalHit } from "../types.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function normalizeForDedup(text: string): string {
  return text.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function dimensionsKey(dims: EpistemicDimensions | null): string {
  if (!dims) return "null";
  return `${dims.source}:${dims.status}:${dims.time}:${dims.reliability}`;
}

export type DedupDecision = {
  survivors: RetrievalHit[];
  omitted: Array<{
    ref: string;
    reason: "duplicate:exact_ref" | "duplicate:raw_row_identity" | "duplicate:content_hash_identical_metadata";
  }>;
};

/**
 * Narrow, safe deterministic deduplication.
 * Preserves contradictions and corrections (different dimensions or memoryKind).
 * Excludes exact row-identity matches with recent raw conversation window.
 */
export function deduplicateCandidates(
  candidates: RetrievalHit[],
  options: {
    rawConversationRowIds?: Set<string>;
  } = {},
): DedupDecision {
  const rawRowIds = options.rawConversationRowIds ?? new Set<string>();
  const survivors: RetrievalHit[] = [];
  const omitted: DedupDecision["omitted"] = [];

  const seenRefs = new Set<string>();
  const seenContentAndMetadata = new Set<string>();

  for (const candidate of candidates) {
    // Rule B: Exact conversation-log row identity already present in rawConversation
    if (candidate.sourceStore === "conversation_log" && rawRowIds.has(candidate.ref)) {
      omitted.push({ ref: candidate.ref, reason: "duplicate:raw_row_identity" });
      continue;
    }

    // Rule A: Exact same assertion/ref
    if (seenRefs.has(candidate.ref)) {
      omitted.push({ ref: candidate.ref, reason: "duplicate:exact_ref" });
      continue;
    }

    // Rule C: Exact duplicate memory content ONLY when epistemic metadata is identical
    if (candidate.sourceStore !== "conversation_log") {
      const contentHash = sha256(normalizeForDedup(candidate.snippet));
      const metaKey = `${candidate.memoryKind ?? "null"}:${dimensionsKey(candidate.dimensions)}:${contentHash}`;

      if (seenContentAndMetadata.has(metaKey)) {
        omitted.push({ ref: candidate.ref, reason: "duplicate:content_hash_identical_metadata" });
        continue;
      }
      seenContentAndMetadata.add(metaKey);
    }

    seenRefs.add(candidate.ref);
    survivors.push(candidate);
  }

  return { survivors, omitted };
}
