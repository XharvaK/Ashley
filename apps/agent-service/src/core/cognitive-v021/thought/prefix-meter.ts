import type { ChatMessage } from "../../model-routing/types.js";

/** Where the current prompt first differs from the previous one of the same profile. */
export type PrefixReport = {
  stableBytes: number;
  totalBytes: number;
  previousTotalBytes: number;
  breakMessage: number;
  breakPath: string;
};

const MAX_PATH_SEGMENTS = 6;

type Segment = { kind: "key"; key: string } | { kind: "index"; index: number };

type SerializedMessage = {
  role: string;
  roleBytes: number;
  content: string;
  contentByteStart: number;
  contentBytes: number;
  messageByteStart: number;
  messageBytes: number;
};

type SerializedPrompt = {
  bytes: Uint8Array;
  messages: SerializedMessage[];
};

/**
 * In-process comparison of successive Thought prompts.
 * The previous serialization is kept per profile key. Re-observing a key
 * makes it newest; past `maxProfiles`, the least recently seen key is dropped.
 * Image URLs are ignored. Nothing here is persisted.
 */
export function createPrefixMeter(maxProfiles = 8): {
  observe(profileKey: string, messages: ChatMessage[]): PrefixReport | null;
} {
  const previous = new Map<string, SerializedPrompt>();
  return {
    observe(profileKey, messages) {
      const current = serializePrompt(messages);
      const prior = previous.get(profileKey);
      previous.delete(profileKey);
      previous.set(profileKey, current);
      while (previous.size > maxProfiles) {
        const oldest = previous.keys().next().value;
        if (oldest === undefined) break;
        previous.delete(oldest);
      }
      if (!prior) return null;
      return comparePrompts(prior, current);
    },
  };
}

function serializePrompt(messages: ChatMessage[]): SerializedPrompt {
  const parts: Uint8Array[] = [];
  const serialized: SerializedMessage[] = [];
  let offset = 0;
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "";
    const content = typeof message.content === "string" ? message.content : "";
    const roleBytes = Buffer.from(role, "utf8");
    const contentBytes = Buffer.from(content, "utf8");
    serialized.push({
      role,
      roleBytes: roleBytes.length,
      content,
      contentByteStart: offset + roleBytes.length,
      contentBytes: contentBytes.length,
      messageByteStart: offset,
      messageBytes: roleBytes.length + contentBytes.length,
    });
    parts.push(roleBytes, contentBytes);
    offset += roleBytes.length + contentBytes.length;
  }
  return { bytes: concatBytes(parts), messages: serialized };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function commonPrefixLength(left: Uint8Array, right: Uint8Array): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function comparePrompts(prior: SerializedPrompt, current: SerializedPrompt): PrefixReport {
  const stableBytes = commonPrefixLength(prior.bytes, current.bytes);
  const totalBytes = current.bytes.length;
  const previousTotalBytes = prior.bytes.length;
  if (stableBytes === totalBytes && stableBytes === previousTotalBytes) {
    return { stableBytes, totalBytes, previousTotalBytes, breakMessage: 0, breakPath: "=" };
  }
  const host = stableBytes < totalBytes ? current : prior;
  const located = locateBreak(host, stableBytes);
  return {
    stableBytes,
    totalBytes,
    previousTotalBytes,
    breakMessage: located.message,
    breakPath: located.path,
  };
}

function locateBreak(prompt: SerializedPrompt, byteOffset: number): { message: number; path: string } {
  const message = messageIndexAt(prompt, byteOffset);
  const entry = prompt.messages[message];
  if (!entry) return { message: 0, path: "-" };
  if (entry.role === "system") return { message, path: "system" };
  const withinContent = byteOffset - entry.contentByteStart;
  if (withinContent < 0 || withinContent >= entry.contentBytes) return { message, path: "-" };
  return { message, path: jsonBreakPath(entry.content, withinContent) };
}

function messageIndexAt(prompt: SerializedPrompt, byteOffset: number): number {
  if (prompt.messages.length === 0) return 0;
  for (let index = 0; index < prompt.messages.length; index += 1) {
    const entry = prompt.messages[index]!;
    if (byteOffset < entry.messageByteStart + entry.messageBytes) return index;
  }
  return prompt.messages.length - 1;
}

function jsonBreakPath(content: string, targetByte: number): string {
  try {
    const cursor = new JsonCursor(content, targetByte);
    cursor.skipWs();
    if (cursor.ended()) return "-";
    const head = cursor.peek();
    if (head !== "{" && head !== "[") return "-";
    return cursor.parseValue([]) ?? "-";
  } catch {
    return "-";
  }
}

function formatPath(segments: readonly Segment[]): string {
  let out = "";
  for (const segment of segments.slice(0, MAX_PATH_SEGMENTS)) {
    if (segment.kind === "index") out += `[${segment.index}]`;
    else if (out.length === 0) out += segment.key;
    else out += `.${segment.key}`;
  }
  return out.length === 0 ? "-" : out;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

class JsonCursor {
  private index = 0;
  private byte = 0;

  constructor(
    private readonly text: string,
    private readonly target: number,
  ) {}

  ended(): boolean {
    return this.index >= this.text.length;
  }

  peek(): string {
    return this.text[this.index] ?? "";
  }

  skipWs(): void {
    while (!this.ended()) {
      const char = this.peek();
      if (char !== " " && char !== "\n" && char !== "\r" && char !== "\t") return;
      this.bump();
    }
  }

  parseValue(path: Segment[]): string | null {
    this.skipWs();
    if (this.ended()) return null;
    const char = this.peek();
    if (char === "{") return this.parseObject(path);
    if (char === "[") return this.parseArray(path);
    return this.parsePrimitive(path);
  }

  private parseObject(path: Segment[]): string | null {
    const openByte = this.byte;
    this.bump();
    if (this.target === openByte) return path.length === 0 ? "-" : formatPath(path);
    for (;;) {
      this.skipWs();
      if (this.ended()) return "-";
      if (this.peek() === "}") {
        const endByte = this.byte;
        this.bump();
        return this.target === endByte ? (path.length === 0 ? "-" : formatPath(path)) : null;
      }
      if (this.peek() !== "\"") return "-";
      const keyStart = this.byte;
      const key = this.parseString();
      const keyEnd = this.byte;
      const keySegment: Segment = { kind: "key", key };
      if (this.target >= keyStart && this.target < keyEnd) return formatPath([...path, keySegment]);
      this.skipWs();
      if (this.peek() !== ":") return "-";
      const colonByte = this.byte;
      this.bump();
      if (this.target === colonByte) return formatPath([...path, keySegment]);
      const located = this.parseValue([...path, keySegment]);
      if (located !== null) return located;
      this.skipWs();
      if (this.peek() === ",") {
        const commaByte = this.byte;
        this.bump();
        if (this.target === commaByte) {
          this.skipWs();
          if (this.peek() === "\"") {
            const nextKey = this.parseString();
            return formatPath([...path, { kind: "key", key: nextKey }]);
          }
          return path.length === 0 ? "-" : formatPath(path);
        }
        continue;
      }
      if (this.peek() === "}") {
        const endByte = this.byte;
        this.bump();
        return this.target === endByte ? formatPath(path) : null;
      }
      return "-";
    }
  }

  private parseArray(path: Segment[]): string | null {
    const openByte = this.byte;
    this.bump();
    if (this.target === openByte) return path.length === 0 ? "-" : formatPath(path);
    let index = 0;
    for (;;) {
      this.skipWs();
      if (this.ended()) return "-";
      if (this.peek() === "]") {
        const endByte = this.byte;
        this.bump();
        return this.target === endByte ? (path.length === 0 ? "-" : formatPath(path)) : null;
      }
      const indexSegment: Segment = { kind: "index", index };
      const located = this.parseValue([...path, indexSegment]);
      if (located !== null) return located;
      this.skipWs();
      if (this.peek() === ",") {
        const commaByte = this.byte;
        this.bump();
        if (this.target === commaByte) return formatPath([...path, { kind: "index", index: index + 1 }]);
        index += 1;
        continue;
      }
      if (this.peek() === "]") {
        const endByte = this.byte;
        this.bump();
        return this.target === endByte ? formatPath([...path, indexSegment]) : null;
      }
      return "-";
    }
  }

  private parsePrimitive(path: Segment[]): string | null {
    const start = this.byte;
    const char = this.peek();
    if (char === "\"") {
      this.parseString();
    } else if (char === "-" || (char >= "0" && char <= "9")) {
      this.bump();
      while (!this.ended() && /[0-9.eE+\-]/.test(this.peek())) this.bump();
    } else if (this.text.startsWith("true", this.index)) {
      this.bumpCount(4);
    } else if (this.text.startsWith("false", this.index)) {
      this.bumpCount(5);
    } else if (this.text.startsWith("null", this.index)) {
      this.bumpCount(4);
    } else {
      return "-";
    }
    if (this.target >= start && this.target < this.byte) return formatPath(path);
    return null;
  }

  /** Decoded JSON string. The cursor walks the raw text, so byte offsets stay on the wire bytes. */
  private parseString(): string {
    let decoded = "";
    this.bump();
    while (!this.ended()) {
      const char = this.peek();
      if (char === "\"") {
        this.bump();
        return decoded;
      }
      if (char === "\\") {
        this.bump();
        const escaped = this.peek();
        if (escaped === "u") {
          this.bump();
          let hex = "";
          for (let count = 0; count < 4 && !this.ended(); count += 1) {
            hex += this.peek();
            this.bump();
          }
          const code = Number.parseInt(hex, 16);
          decoded += Number.isFinite(code) ? String.fromCharCode(code) : "";
          continue;
        }
        const mapped: Record<string, string> = {
          "\"": "\"",
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        decoded += mapped[escaped] ?? escaped;
        if (!this.ended()) this.bump();
        continue;
      }
      const codePoint = this.text.codePointAt(this.index) ?? 0;
      decoded += String.fromCodePoint(codePoint);
      this.bump();
    }
    return decoded;
  }

  private bumpCount(count: number): void {
    for (let step = 0; step < count; step += 1) this.bump();
  }

  private bump(): void {
    if (this.ended()) return;
    const codePoint = this.text.codePointAt(this.index) ?? 0;
    this.byte += utf8ByteLength(codePoint);
    this.index += codePoint > 0xffff ? 2 : 1;
  }
}
