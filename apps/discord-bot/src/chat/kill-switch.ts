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

export interface KillSwitchDeps {
  isOwner(authorId: string): boolean;
  abort(channelId: string): void;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
}

/**
 * The switch is the Owner's alone. Anyone else in a room may say "stop" to someone
 * else, so their words go on as ordinary conversation and never touch her lanes.
 */
export function createKillSwitchHandler(deps: KillSwitchDeps) {
  return async function handleKillSwitch(message: {
    content: string;
    author?: { id?: string } | null;
    channel: { id: string };
    reply(text: string): Promise<unknown>;
  }): Promise<boolean> {
    const authorId = message.author?.id;
    if (!authorId || !deps.isOwner(authorId)) return false;
    const switched = readKillSwitch(message.content);
    if (!switched) return false;

    deps.abort(message.channel.id);
    try {
      if (switched === "pause") {
        await deps.pause();
        await message.reply("alright, going quiet. say devam when you want me back");
      } else {
        await deps.resume();
        await message.reply("back on then");
      }
    } catch (err) {
      console.warn("[discord-bot] kill switch failed:", err);
      return false;
    }
    return true;
  };
}
