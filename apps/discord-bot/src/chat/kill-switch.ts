/**
 * At eight messages a day he needs a way to stop her mid burst without opening a
 * config file or remembering a slash command. Deliberately only bare commands:
 * "stop" alone is an instruction, "stop the retry loop" is a conversation.
 */
const STOP = /^(stop|dur|sus|kes|yeter|quiet|shut up|be quiet)[.!]?$/i;
const RESUME = /^(resume|devam|go on|continue|start again)[.!]?$/i;

export type KillSwitch = "pause" | "resume" | null;

export function readKillSwitch(message: string): KillSwitch {
  const text = message.trim();
  if (text.length > 12) return null;
  if (STOP.test(text)) return "pause";
  if (RESUME.test(text)) return "resume";
  return null;
}
