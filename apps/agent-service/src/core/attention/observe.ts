import type { DatabaseSync } from "node:sqlite";
import { attentionObservability } from "./governor.js";

/** Owner-only attention stats (no prompts, keys, or message text). */
export function observeAttention(db: DatabaseSync) {
  return attentionObservability(db);
}
