import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type CommandSurfaceFile = {
  version: number;
  commands: string[];
};

/** Commands the bot implements. The JSON surface must list exactly these. */
const IMPLEMENTED = [
  "remember",
  "memory",
  "proactive",
  "identity",
  "commitments",
  "continuity",
  "status",
  "attention",
  "delegation",
  "contacts",
] as const;

type CommandKey = (typeof IMPLEMENTED)[number];

const file = fileURLToPath(new URL("../command-surface.json", import.meta.url));
const parsed = JSON.parse(readFileSync(file, "utf8")) as CommandSurfaceFile;
if (
  parsed.version !== 1 ||
  !Array.isArray(parsed.commands) ||
  parsed.commands.some((command) => typeof command !== "string" || !command.trim()) ||
  new Set(parsed.commands).size !== parsed.commands.length ||
  parsed.commands.length !== IMPLEMENTED.length ||
  IMPLEMENTED.some((name) => !parsed.commands.includes(name))
) {
  throw new Error("command_surface_invalid");
}

// Looked up by name, never by position, so adding or retiring a command can
// never silently rebind another command's slot.
export const commandSurface: Readonly<Record<CommandKey, string>> = Object.freeze(
  Object.fromEntries(IMPLEMENTED.map((name) => [name, name])) as Record<CommandKey, string>,
);

export const commandNames = Object.freeze([...parsed.commands]);
