import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type CommandSurfaceFile = {
  version: number;
  commands: string[];
};

const file = fileURLToPath(new URL("../command-surface.json", import.meta.url));
const parsed = JSON.parse(readFileSync(file, "utf8")) as CommandSurfaceFile;
if (
  parsed.version !== 1 ||
  !Array.isArray(parsed.commands) ||
  parsed.commands.length !== 9 ||
  parsed.commands.some((command) => typeof command !== "string" || !command.trim()) ||
  new Set(parsed.commands).size !== parsed.commands.length
) {
  throw new Error("command_surface_invalid");
}

export const commandSurface = Object.freeze({
  remember: parsed.commands[0],
  memory: parsed.commands[1],
  newThread: parsed.commands[2],
  forget: parsed.commands[3],
  proactive: parsed.commands[4],
  identity: parsed.commands[5],
  commitments: parsed.commands[6],
  continuity: parsed.commands[7],
  status: parsed.commands[8],
});

export const commandNames = Object.freeze([...parsed.commands]);
