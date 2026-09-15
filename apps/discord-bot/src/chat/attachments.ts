import type { Message } from "discord.js";

export type ExternalEnvelopeTransport = {
  speakerPrincipalId: string;
  speakerKind: "external_human" | "external_bot";
  location:
    | { kind: "external_dm"; principalId: string; channelId: string }
    | { kind: "room"; guildId: string; channelId: string };
  audienceAtCapture: "unknown";
  sentAtMs: number;
  discordMessageId: string;
  replyToMessageId?: string;
  mentionIds: string[];
  attachmentRefs: Array<{
    discordAttachmentId: string;
    declaredMime: string;
    fileName: string;
    declaredByteSize?: number;
    sourceUrl: string;
  }>;
  provenance: { source: "discord"; receivedAtMs: number };
};

/**
 * Before this, a photo with no caption produced literally nothing: the handler
 * trimmed the empty content and returned. Ignoring what a friend sends you is
 * about as unhuman as it gets, so images are offered for perception when vision
 * is active; everything else arrives as an honest note about what she cannot open.
 */
export const MAX_IMAGES = 4;

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|avif)$/i;
export const TEXT_MIME = /^(?:text\/(?:plain|markdown|x-markdown)|application\/(?:x-)?markdown)$/i;
const PASSIVE_TEXT_EXTS = new Set([".txt", ".md", ".markdown"]);
const NEVER_PROMOTE_EXTS = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".ps1", ".sh", ".js", ".mjs", ".jar", ".msi",
  ".com", ".scr", ".vbs", ".wsf", ".zip", ".rar", ".7z", ".tar", ".gz",
]);

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
  hasIngestibleTextAttachment: boolean;
  /** Discord message id for this fragment (delivery inbound idempotency). */
  messageId: string;
  /** Present when the Discord transport has enough fields for attribution. */
  envelope?: ExternalEnvelopeTransport;
};

export function hasIngestibleTextAttachment(intake: Intake): boolean {
  return intake.hasIngestibleTextAttachment;
}

function seconds(value: number | null | undefined): string {
  if (!value) return "";
  return ` ${Math.round(value)}s`;
}

function mentionIds(message: Message): string[] {
  try {
    const users = (message as Message & {
      mentions?: { users?: unknown };
    }).mentions?.users;
    if (!users || typeof (users as { keys?: unknown }).keys !== "function") {
      return [];
    }
    const ids: string[] = [];
    for (const value of (users as { keys(): Iterable<unknown> }).keys()) {
      if (typeof value !== "string") continue;
      const id = value.trim();
      if (id) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

function attributedEnvelope(
  message: Message,
  attachmentRefs: AttachmentRef[],
): ExternalEnvelopeTransport | undefined {
  const messageId = typeof message.id === "string" ? message.id.trim() : "";
  const authorId = typeof message.author?.id === "string"
    ? message.author.id.trim()
    : "";
  const channelId = typeof message.channel?.id === "string"
    ? message.channel.id.trim()
    : "";
  if (!messageId || !authorId || !channelId) return undefined;

  let location: ExternalEnvelopeTransport["location"];
  if (message.guild == null) {
    location = {
      kind: "external_dm",
      principalId: authorId,
      channelId,
    };
  } else {
    const guildId = typeof message.guild.id === "string"
      ? message.guild.id.trim()
      : "";
    if (!guildId) return undefined;
    location = { kind: "room", guildId, channelId };
  }

  const sentAtMs = Number.isFinite(message.createdTimestamp)
    ? message.createdTimestamp
    : Date.now();
  const replyToMessageId = typeof message.reference?.messageId === "string"
    ? message.reference.messageId.trim() || undefined
    : undefined;
  return {
    speakerPrincipalId: authorId,
    speakerKind: message.author.bot ? "external_bot" : "external_human",
    location,
    audienceAtCapture: "unknown",
    sentAtMs,
    discordMessageId: messageId,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    mentionIds: mentionIds(message),
    attachmentRefs: [...attachmentRefs],
    provenance: { source: "discord", receivedAtMs: Date.now() },
  };
}

export function describeIntake(message: Message): Intake {
  const attachments: AttachmentRef[] = [];
  const notes: string[] = [];
  let hasIngestibleText = false;
  let imageCount = 0;
  let acceptedImageCount = 0;

  for (const attachment of message.attachments.values()) {
    const type = attachment.contentType ?? "";
    const mime = type.split(";")[0]!.trim();
    const normalizedMime = mime.toLowerCase();
    const fileName = attachment.name?.trim() || "something";
    const lowerName = fileName.toLowerCase();
    const extensionIndex = lowerName.lastIndexOf(".");
    const extension = extensionIndex >= 0 ? lowerName.slice(extensionIndex) : "";

    if (!attachment.id || !attachment.url) {
      notes.push(`a file called ${fileName} that I cannot open`);
      continue;
    }

    if (NEVER_PROMOTE_EXTS.has(extension)) {
      notes.push(`a file called ${fileName} that is unsupported`);
      continue;
    }

    if (PASSIVE_TEXT_EXTS.has(extension)) {
      const textMime =
        TEXT_MIME.test(mime) ||
        normalizedMime === "" ||
        normalizedMime === "application/octet-stream";
      if (textMime) {
        attachments.push({
          discordAttachmentId: attachment.id,
          declaredMime: mime || "application/octet-stream",
          fileName: fileName.slice(0, 200),
          declaredByteSize: attachment.size ?? undefined,
          sourceUrl: attachment.url,
        });
        hasIngestibleText = true;
        notes.push(
          `attached text file "${fileName.slice(0, 200)}" — content ingested with message`,
        );
      } else {
        notes.push(`a file called ${fileName} that I cannot open`);
      }
      continue;
    }

    const isImage = IMAGE_TYPES.test(mime);

    if (isImage) {
      imageCount += 1;
    }
    if (isImage && acceptedImageCount < MAX_IMAGES) {
      attachments.push({
        discordAttachmentId: attachment.id,
        declaredMime: mime || "image/png",
        fileName: (attachment.name ?? "image").slice(0, 200),
        declaredByteSize: attachment.size ?? undefined,
        sourceUrl: attachment.url,
      });
      acceptedImageCount += 1;
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
  if (!content && imageCount > 0 && imageCount <= MAX_IMAGES) {
    parts.push(`(shared ${imageCount} image(s))`);
  }
  if (notes.length > 0) {
    parts.push(`(Doc sent ${notes.join(", ")}.)`);
  }

  const result: Intake = {
    text: parts.join("\n"),
    attachments,
    hasMedia: notes.length > 0,
    hasIngestibleTextAttachment: hasIngestibleText,
    messageId: message.id,
  };
  const envelope = attributedEnvelope(message, attachments);
  if (envelope) result.envelope = envelope;
  return result;
}
