import type { DatabaseSync } from "node:sqlite";
import {
  getHotMessages,
  resolveActiveThread,
  type MemoryMessage,
} from "./threads.js";
import type { MemoryFact } from "./facts.js";
import type { Episode } from "./episodes.js";
import type { EvidenceRef } from "../types.js";
import {
  formatResolvedEvidence,
  resolveEvidenceRefs,
} from "../agency/resolve-evidence.js";
import { renderMemoryContextMessage } from "./context-role.js";

/** Memory-only retrieval. Identity / Mind State belong to ContextComposer. */
export type AssembledMemory = {
  memoryBlock: string;
  threadId: string;
  hotMessages: MemoryMessage[];
  facts: MemoryFact[];
  episodes: Episode[];
};

export type AssembleMemoryInput = {
  userMessage?: string;
  /** Exclude this message id from hot window and evidence materialization. */
  excludeMessageId?: number | null;
  /** Thought-selected refs only — no default importance dump. */
  evidenceRefs?: EvidenceRef[];
};

/**
 * Assemble memory transport for Expression.
 * Does not dump top-N facts. Does not echo the current user message text.
 */
export function assembleMemoryBlock(
  db: DatabaseSync,
  ownerId: string,
  userMessageOrInput?: string | AssembleMemoryInput,
): AssembledMemory {
  const input: AssembleMemoryInput =
    typeof userMessageOrInput === "string" || userMessageOrInput === undefined
      ? { userMessage: userMessageOrInput }
      : userMessageOrInput;

  const threadId = resolveActiveThread(db, ownerId, "discord");
  const excludeMessageId = input.excludeMessageId ?? null;
  const hotMessages = getHotMessages(db, threadId, 12).filter(
    (message) => excludeMessageId === null || message.id !== excludeMessageId,
  );
  const evidenceRefs = input.evidenceRefs ?? [];
  const resolved = resolveEvidenceRefs(db, ownerId, evidenceRefs, {
    excludeMessageId,
  });

  const recentLines = hotMessages
    .slice(-8)
    .map((message) => renderMemoryContextMessage(message));

  const sections = [
    formatResolvedEvidence(resolved),
    recentLines.length > 0
      ? ["## Hot conversation", ...recentLines].join("\n")
      : "",
  ].filter(Boolean);

  const facts: MemoryFact[] = [];
  const episodes: Episode[] = [];

  return {
    memoryBlock: sections.join("\n\n"),
    threadId,
    hotMessages,
    facts,
    episodes,
  };
}
