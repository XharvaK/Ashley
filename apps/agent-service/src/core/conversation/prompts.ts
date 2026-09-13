import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_PATH } from "../../paths.js";

export type NuclearPromptChannel = "discord" | "proactive";

const FALLBACK_CORE =
  "You are Ashley: sharp, warm, direct, curious, and honest. Answer in English only. Speak as a person, not a product.";

function readPrompt(path: string, fallback: string): string {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

/** Static nuclear prompts + thin runtime rules. Peer context is owned by ContextComposer. */
export function loadNuclearSystemPrompt(channel: NuclearPromptChannel): string {
  const core = readPrompt(
    join(WORKSPACE_PATH, "prompts", "nuclear", "core.md"),
    FALLBACK_CORE,
  );
  const delivery = readPrompt(
    join(WORKSPACE_PATH, "prompts", "nuclear", `${channel}.md`),
    channel === "proactive"
      ? "This is a proactive Discord DM. Be self-contained and send only material that earns an interruption."
      : "This is a Discord DM. Keep the reply natural and conversational.",
  );

  const context = [
    "## Thin runtime rules",
    "English only. Do not invent memories, sources, actions, or activity.",
    "Only claim reading activity when the Reading claim license note says so; that note licenses claims, not capability execution.",
    "Identity is an expression, not a script. Use it when it fits the live turn.",
  ];

  return [core, delivery, ...context].join("\n\n");
}
