import type { AttachmentSourceClass } from "../../perception/types.js";

export type ImageDimensions = Readonly<{
  width: number;
  height: number;
  source: "header";
}>;

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! * 0x1000000)
    + (bytes[offset + 1]! << 16)
    + (bytes[offset + 2]! << 8)
    + bytes[offset + 3]!;
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  return Number.isSafeInteger(width) && width > 0
    && Number.isSafeInteger(height) && height > 0
    ? { width, height, source: "header" }
    : null;
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 24
    || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  return validDimensions(u32be(bytes, 16), u32be(bytes, 20));
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 10
    || bytes[0] !== 71 || bytes[1] !== 73 || bytes[2] !== 70 || bytes[3] !== 56
    || (bytes[4] !== 55 && bytes[4] !== 57) || bytes[5] !== 97) return null;
  return validDimensions(u16le(bytes, 6), u16le(bytes, 8));
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd8) continue;
    if (offset + 1 >= bytes.byteLength) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && length >= 7) {
      return validDimensions(
        (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
      );
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 30
    || bytes[0] !== 82 || bytes[1] !== 73 || bytes[2] !== 70 || bytes[3] !== 70
    || bytes[8] !== 87 || bytes[9] !== 69 || bytes[10] !== 66 || bytes[11] !== 80) return null;
  if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 88) {
    return validDimensions(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  return null;
}

/** Bounded header-only dimensions. Unsupported containers remain dimensionless. */
export function readImageDimensions(bytes: Uint8Array, mime: string): ImageDimensions | null {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/png") return pngDimensions(bytes);
  if (normalized === "image/gif") return gifDimensions(bytes);
  if (normalized === "image/jpeg" || normalized === "image/jpg") return jpegDimensions(bytes);
  if (normalized === "image/webp") return webpDimensions(bytes);
  return null;
}

export type VisionDescribeInput = {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
  sourceClass: AttachmentSourceClass;
  dimensions: ImageDimensions | null;
};

export type VisionTransport =
  | Readonly<{
      kind: "direct_visual";
      /**
       * Optional background record for later recall. Thought sees the image
       * itself; this concise text is only what remains after the turn.
       */
      recordModelId?: string;
      describeForRecord?: (input: VisionDescribeInput) => Promise<string>;
    }>
  | Readonly<{
      kind: "mediated_visual";
      helperModelId: string;
      describeImage: (input: VisionDescribeInput) => Promise<string>;
    }>;
