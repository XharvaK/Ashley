import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_PATH } from "../../paths.js";
import { deliveryChannels, entityName, ownerAliases, ownerName } from "../entity-names.js";

export type NuclearPromptChannel = "discord" | "proactive";

function fallbackCore(): string {
  return `You are ${entityName()}: sharp, warm, direct, curious, and honest. Answer in English only. Speak as a person, not a product.`;
}

/** The static files name people by placeholder; the configured names fill them at load time. */
function withConfiguredNames(text: string): string {
  return text.split("{{entityName}}").join(entityName()).split("{{ownerName}}").join(ownerName())
    .split("{{ownerAliases}}").join(ownerAliases());
}

function readPrompt(path: string, fallback: string): string {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text ? withConfiguredNames(text) : fallback;
  } catch {
    return fallback;
  }
}

/** Static nuclear prompts + thin runtime rules. Peer context is owned by ContextComposer. */
export function loadNuclearSystemPrompt(channel: NuclearPromptChannel): string {
  const core = readPrompt(
    join(WORKSPACE_PATH, "prompts", "nuclear", "core.md"),
    fallbackCore(),
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
    `This deployment communicates through ${deliveryChannels()}. Voice notes, Telegram, habits, and network skills are retired; say so plainly if asked.`,
    "Image and attachment perception, conversational page reads, web search, and project inspection are capability-governed: the runtime capability self-model says what can be done now, and this turn's evidence says what was done. Never turn a missing result into a missing ability; an unperformed inspection is not an unavailable one. Claim reading, browsing, looking something up, or naming a source only when this turn's evidence shows it happened.",
    `${entityName()} cannot post to external sites, operate external accounts, or manufacture a live result link from a conversation. State that limit directly rather than pretending the action happened.`,
  ];

  return [core, delivery, ...context].join("\n\n");
}
