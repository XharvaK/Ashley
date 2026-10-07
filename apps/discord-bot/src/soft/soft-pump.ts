import { EmbedBuilder, type Client, type DMChannel, type Message } from "discord.js";
import { claimSoftActs, reportSoftActResult, type SoftAct } from "../agent-client.js";
import { config } from "../config.js";
import { ashleyDataDir } from "../data-root.js";
import { searchGif } from "../chat/gif-search.js";
import { reactPolicy } from "../chat/react-policy.js";
import {
  AVATAR_BACKOFF_MS,
  AVATAR_CHANGES_PER_DAY,
  AVATAR_DAY_MS,
  isDiscordRateLimit,
  loadFaceMemory,
  readArtFile,
  saveFaceMemory,
} from "../presence/face-window.js";

/**
 * UX_PACK v4 Wave 2: her soft acts in the Owner's DM. The agent already
 * checked each one against what happened; this renders it and reports what
 * became of it, refusals included, so she sees it on her next pass.
 */

export const SOFT_POLL_MS = 5_000;
const DISCORD_LIMIT = 2_000;

export type SoftOutcome = { status: "done" | "refused" | "failed"; reason?: string };

export type SoftDeps = {
  ownerDm: () => Promise<DMChannel>;
  readArt: (id: string) => Buffer | null;
  setAvatar: (bytes: Buffer) => Promise<void>;
  searchGif: (query: string, channelId: string) => Promise<string | null>;
  gifSearchAvailable: () => boolean;
  dataDir: string;
  nowMs: () => number;
};

async function message(dm: DMChannel, id: string): Promise<Message | null> {
  try {
    return await dm.messages.fetch(id);
  } catch {
    return null;
  }
}

/** Her avatar choice: a file must exist for the id, and the day's change cap and any back-off hold. */
async function wearFace(deps: SoftDeps, wardrobeId: string): Promise<SoftOutcome> {
  const id = `avatar/${wardrobeId}.png`;
  const bytes = deps.readArt(id);
  if (!bytes) return { status: "refused", reason: "art_missing" };
  const memory = loadFaceMemory(deps.dataDir);
  const now = deps.nowMs();
  const recent = memory.avatarChangeAtMs.filter((at) => now - at < AVATAR_DAY_MS && now >= at);
  if (now < memory.backoffUntilMs || recent.length >= AVATAR_CHANGES_PER_DAY) return { status: "refused", reason: "avatar_rate_limited" };
  memory.chosenId = id;
  if (!memory.sleeping) {
    try {
      await deps.setAvatar(bytes);
    } catch (error) {
      if (isDiscordRateLimit(error)) {
        memory.backoffUntilMs = now + AVATAR_BACKOFF_MS;
        saveFaceMemory(memory, deps.dataDir);
        return { status: "refused", reason: "avatar_rate_limited" };
      }
      throw error;
    }
    memory.avatarId = id;
    memory.avatarChangeAtMs = [...recent, now];
  }
  saveFaceMemory(memory, deps.dataDir);
  return { status: "done" };
}

export async function performSoftAct(act: SoftAct, deps: SoftDeps): Promise<SoftOutcome> {
  const request = act.request;
  const dm = await deps.ownerDm();
  switch (request.kind) {
    case "touch": {
      const target = await message(dm, request.messageId);
      if (!target) return { status: "refused", reason: "message_gone" };
      if (!reactPolicy.decide({ channelId: dm.id, emoji: request.emoji, docText: target.content ?? "", herText: "" })) {
        return { status: "refused", reason: "mirrors_their_emoji" };
      }
      await target.react(request.emoji);
      return { status: "done" };
    }
    case "correct": {
      const target = await message(dm, request.messageId);
      if (!target) return { status: "refused", reason: "message_gone" };
      if (!target.editable || target.author.id !== target.client.user?.id) return { status: "refused", reason: "not_editable" };
      const old = target.content.trim();
      if (!old) return { status: "refused", reason: "nothing_to_correct" };
      const edited = `~~${old}~~ ${request.text}`;
      if (edited.length > DISCORD_LIMIT) return { status: "refused", reason: "too_long" };
      await target.edit(edited);
      return { status: "done" };
    }
    case "callback": {
      if ("gifQuery" in request) {
        if (!deps.gifSearchAvailable()) return { status: "refused", reason: "gif_search_unavailable" };
        const url = await deps.searchGif(request.gifQuery, dm.id);
        if (!url) return { status: "refused", reason: "no_gif_found" };
        await dm.send(url);
        return { status: "done" };
      }
      const original = request.replyTo ? await message(dm, request.replyTo) : null;
      if (original) await original.reply({ content: request.url, allowedMentions: { repliedUser: false } });
      else await dm.send(request.url);
      return { status: "done" };
    }
    case "pin": {
      const target = await message(dm, request.messageId);
      if (!target) return { status: "refused", reason: "message_gone" };
      if (target.pinned) return { status: "done" };
      await target.pin();
      return { status: "done" };
    }
    case "card": {
      const embed = new EmbedBuilder()
        .setTitle(request.title)
        .setDescription(request.body)
        .setFooter({ text: request.cardKind === "reading_note" ? "reading note" : request.cardKind });
      if (request.link) embed.setURL(request.link);
      const memory = loadFaceMemory(deps.dataDir);
      const thumbnailId = memory.avatarId;
      const thumbnail = thumbnailId ? deps.readArt(thumbnailId) : null;
      if (thumbnail) {
        embed.setThumbnail("attachment://face.png");
        await dm.send({ embeds: [embed], files: [{ attachment: thumbnail, name: "face.png" }] });
      } else {
        await dm.send({ embeds: [embed] });
      }
      return { status: "done" };
    }
    case "face":
      return wearFace(deps, request.wardrobeId);
  }
}

function failureReason(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "number" || typeof code === "string" ? `discord_${String(code)}`.slice(0, 60) : "discord_error";
}

export async function runSoftActs(deps: SoftDeps): Promise<number> {
  const { acts } = await claimSoftActs();
  for (const act of acts) {
    let outcome: SoftOutcome;
    try {
      outcome = await performSoftAct(act, deps);
    } catch (error) {
      outcome = { status: "failed", reason: failureReason(error) };
    }
    await reportSoftActResult(act.actId, outcome).catch((error: unknown) => {
      console.warn(`[soft] report failed act=${act.actId} ${error instanceof Error ? error.name : "error"}`);
    });
  }
  return acts.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startSoftPump(client: Client): void {
  let dm: DMChannel | null = null;
  const deps: SoftDeps = {
    ownerDm: async () => (dm ??= await (await client.users.fetch(config.ownerId)).createDM()),
    readArt: (id) => readArtFile(process.env.ASHLEY_ART_DIR, id),
    setAvatar: async (bytes) => {
      if (client.user) await client.user.setAvatar(bytes);
    },
    searchGif: (query, channelId) => searchGif(query, channelId, { exact: true }),
    gifSearchAvailable: () => config.gifEnabled && Boolean(config.giphyApiKey || config.tenorApiKey),
    dataDir: ashleyDataDir(),
    nowMs: Date.now,
  };
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runSoftActs(deps);
    } catch (error) {
      console.warn(`[soft] tick failed ${error instanceof Error ? error.name : "error"}`);
    } finally {
      running = false;
    }
  };
  if (timer) clearInterval(timer);
  timer = setInterval(() => void tick(), SOFT_POLL_MS);
}

export function stopSoftPump(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
