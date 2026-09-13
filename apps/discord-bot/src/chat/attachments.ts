import type { Message } from "discord.js";

/**
 * Before this, a photo with no caption produced literally nothing: the handler
 * trimmed the empty content and returned. Ignoring what a friend sends you is
 * about as unhuman as it gets, so images are offered for perception when vision
 * is active; everything else arrives as an honest note about what she cannot open.
 */
export const MAX_IMAGES = 4;

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|avif)$/i;

export type AttachmentRef = {
  discordAttachmentId: string;
  declaredMime: string;
  fileName: string;
  declaredByteSize?: number;
  sourceUrl: string;
};

export type Intake = {
  /** What the agent sees as Doc's turn. */
  text: string;
  /** Structured attachment refs for agent-service perception intake. */
  attachments: AttachmentRef[];
  hasMedia: boolean;
  /** Discord message id for this fragment (delivery inbound idempotency). */
  messageId: string;
};

function seconds(value: number | null | undefined): string {
  if (!value) return "";
  return ` ${Math.round(value)}s`;
}

export function describeIntake(message: Message): Intake {
  const attachments: AttachmentRef[] = [];
  const notes: string[] = [];

  for (const attachment of message.attachments.values()) {
    const type = attachment.contentType ?? "";
    const isImage = IMAGE_TYPES.test(type.split(";")[0]!.trim());

    if (isImage && attachments.length < MAX_IMAGES) {
      attachments.push({
        discordAttachmentId: attachment.id,
        declaredMime: type.split(";")[0]!.trim() || "image/png",
        fileName: (attachment.name ?? "image").slice(0, 200),
        declaredByteSize: attachment.size ?? undefined,
        sourceUrl: attachment.url,
      });
      notes.push(
        "an image attachment (whether I perceive it depends on vision capability)",
      );
      continue;
    }
    if (isImage) {
      notes.push("another image beyond this turn's attachment limit");
      continue;
    }
    if (attachment.duration !== null && type.startsWith("audio/")) {
      notes.push(
        `a voice note${seconds(attachment.duration)}, which I cannot listen to`,
      );
      continue;
    }
    if (type.startsWith("audio/")) {
      notes.push("an audio file I cannot listen to");
      continue;
    }
    if (type.startsWith("video/")) {
      notes.push("a video I cannot watch");
      continue;
    }
    notes.push(
      `a file called ${attachment.name ?? "something"} that I cannot open`,
    );
  }

  for (const sticker of message.stickers.values()) {
    notes.push(`the "${sticker.name}" sticker`);
  }

  const parts: string[] = [];
  let content = message.content.trim();
  if (!/https:\/\//i.test(content)) {
    for (const embed of message.embeds) {
      const embedUrl = embed.url?.trim();
      if (embedUrl?.startsWith("https://")) {
        content = content ? `${content}\n${embedUrl}` : embedUrl;
        break;
      }
    }
  }
  if (content) parts.push(content);
  if (notes.length > 0) {
    parts.push(`(Doc sent ${notes.join(", ")}.)`);
  }

  return {
    text: parts.join("\n"),
    attachments,
    hasMedia: notes.length > 0,
    messageId: message.id,
  };
}
