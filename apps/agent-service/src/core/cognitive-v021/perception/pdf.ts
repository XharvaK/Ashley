import { inflateSync } from "node:zlib";
import {
  pdfPageImageRepresentationId,
  pdfPageTextRepresentationId,
} from "../observation/view.js";

export const MAX_PDF_PAGES = 512;

export type PdfPage = Readonly<{
  page: number;
  width: number;
  height: number;
  text: string;
  extraction: "text" | "empty";
  featuresNotExtracted: readonly string[];
  textRepresentationId: string;
  imageRepresentationId: string;
}>;

export type PdfDocument = Readonly<{
  pageCount: number;
  pages: readonly PdfPage[];
  encrypted: false;
}>;

export class PdfDocumentError extends Error {
  readonly code: "document_unreadable" | "document_encrypted";

  constructor(code: "document_unreadable" | "document_encrypted") {
    super(code);
    this.name = "PdfDocumentError";
    this.code = code;
  }
}

type PdfObject = { body: string };

function fail(code: "document_unreadable" | "document_encrypted"): never {
  throw new PdfDocumentError(code);
}

function decodePdfToken(token: string): string {
  if (token.startsWith("<") && token.endsWith(">")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    const even = hex.length % 2 === 0 ? hex : `${hex}0`;
    try {
      return Buffer.from(even, "hex").toString("latin1");
    } catch {
      return "";
    }
  }
  if (!token.startsWith("(") || !token.endsWith(")")) return "";
  const source = token.slice(1, -1);
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char !== "\\") {
      result += char;
      continue;
    }
    const next = source[++index];
    if (next === undefined) break;
    switch (next) {
      case "n": result += "\n"; break;
      case "r": result += "\r"; break;
      case "t": result += "\t"; break;
      case "b": result += "\b"; break;
      case "f": result += "\f"; break;
      case "(": result += "("; break;
      case ")": result += ")"; break;
      case "\\": result += "\\"; break;
      case "\r": if (source[index + 1] === "\n") index += 1; break;
      case "\n": break;
      default:
        if (/^[0-7]$/.test(next)) {
          let octal = next;
          while (octal.length < 3 && /^[0-7]$/.test(source[index + 1] ?? "")) {
            octal += source[++index];
          }
          result += String.fromCharCode(Number.parseInt(octal, 8));
        } else {
          result += next;
        }
    }
  }
  return result;
}

function tokensInArray(value: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < value.length;) {
    while (/\s/.test(value[index] ?? "")) index += 1;
    const start = value[index];
    if (start !== "(" && start !== "<") {
      index += 1;
      continue;
    }
    if (start === "<" && value[index + 1] === "<") {
      index += 2;
      continue;
    }
    const close = start === "(" ? ")" : ">";
    let depth = start === "(" ? 1 : 0;
    let escaped = false;
    let end = index + 1;
    for (; end < value.length; end += 1) {
      const char = value[end]!;
      if (start === "(" && escaped) {
        escaped = false;
        continue;
      }
      if (start === "(" && char === "\\") {
        escaped = true;
        continue;
      }
      if (start === "(" && char === "(") depth += 1;
      if (start === "(" && char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      if (start === "<" && char === close) break;
    }
    if (end >= value.length) break;
    tokens.push(value.slice(index, end + 1));
    index = end + 1;
  }
  return tokens;
}

function extractText(content: string): string {
  const chunks: string[] = [];
  const direct = /(\((?:\\.|[^()\\])*\)|<[0-9a-fA-F\s]+>)\s*Tj\b/g;
  for (const match of content.matchAll(direct)) {
    const token = match[1];
    if (token) chunks.push(decodePdfToken(token));
  }
  const arrays = /\[((?:.|\r|\n)*?)\]\s*TJ\b/gs;
  for (const match of content.matchAll(arrays)) {
    for (const token of tokensInArray(match[1] ?? "")) chunks.push(decodePdfToken(token));
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function objectTable(source: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const pattern = /(\d+)\s+\d+\s+obj\b/g;
  for (const match of source.matchAll(pattern)) {
    const id = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf("endobj", start);
    if (!Number.isSafeInteger(id) || end < start) continue;
    objects.set(id, { body: source.slice(start, end) });
  }
  return objects;
}

function streamFromObject(object: PdfObject): string {
  const streamIndex = object.body.indexOf("stream");
  if (streamIndex < 0) return "";
  let start = streamIndex + "stream".length;
  if (object.body.slice(start, start + 2) === "\r\n") start += 2;
  else if (object.body[start] === "\n" || object.body[start] === "\r") start += 1;
  const end = object.body.indexOf("endstream", start);
  if (end < start) fail("document_unreadable");
  let bytes = Buffer.from(object.body.slice(start, end), "latin1");
  if (/\/FlateDecode\b/.test(object.body)) {
    try {
      bytes = inflateSync(bytes);
    } catch {
      fail("document_unreadable");
    }
  }
  return bytes.toString("latin1");
}

function contentReferences(pageObject: PdfObject): number[] {
  const array = /\/Contents\s*\[([^\]]+)\]/s.exec(pageObject.body)?.[1] ?? "";
  const direct = /\/Contents\s+(\d+\s+\d+\s+R)/.exec(pageObject.body)?.[1] ?? "";
  const source = array || direct;
  return Array.from(source.matchAll(/(\d+)\s+\d+\s+R/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value));
}

function referenceIds(value: string): number[] {
  return Array.from(value.matchAll(/(\d+)\s+\d+\s+R/g))
    .map((match) => Number(match[1]))
    .filter((candidate) => Number.isSafeInteger(candidate));
}

function orderedPageObjects(objects: Map<number, PdfObject>): PdfObject[] {
  const fallback = Array.from(objects.values()).filter((object) => /\/Type\s*\/Page(?:\s|\/)/.test(object.body));
  const root = Array.from(objects.entries()).find(([, object]) =>
    /\/Type\s*\/Pages(?:\s|\/)/.test(object.body) && !/\/Parent\s+\d+\s+\d+\s+R/.test(object.body));
  if (!root) return fallback;

  const ordered: PdfObject[] = [];
  const visited = new Set<number>();
  const visit = (objectId: number): void => {
    if (visited.has(objectId)) return;
    visited.add(objectId);
    const object = objects.get(objectId);
    if (!object) return;
    if (/\/Type\s*\/Page(?:\s|\/)/.test(object.body)) {
      ordered.push(object);
      return;
    }
    if (/\/Type\s*\/Pages(?:\s|\/)/.test(object.body)) {
      for (const childId of referenceIds(/\/Kids\s*\[([^\]]+)\]/s.exec(object.body)?.[1] ?? "")) {
        visit(childId);
      }
    }
  };
  visit(root[0]);
  return ordered.length === fallback.length ? ordered : fallback;
}

function dimensions(pageObject: PdfObject): { width: number; height: number } {
  const match = /\/MediaBox\s*\[\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)/.exec(pageObject.body);
  if (!match) return { width: 612, height: 792 };
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) {
    fail("document_unreadable");
  }
  return { width: x2 - x1, height: y2 - y1 };
}

/** Parse the bounded PDF subset needed for page identity and honest text extraction. */
export function parsePdfDocument(bytes: Uint8Array, artifactId = "pdf-artifact"): PdfDocument {
  const source = Buffer.from(bytes).toString("latin1");
  if (!source.startsWith("%PDF-") || !/%%EOF\s*$/.test(source)) fail("document_unreadable");
  if (/\/Encrypt(?:\s|\/)/.test(source)) fail("document_encrypted");
  const objects = objectTable(source);
  const pages = orderedPageObjects(objects);
  if (pages.length === 0 || pages.length > MAX_PDF_PAGES) fail("document_unreadable");
  return {
    pageCount: pages.length,
    encrypted: false,
    pages: pages.map((pageObject, index) => {
      const page = index + 1;
      const content = contentReferences(pageObject)
        .map((reference) => objects.get(reference))
        .filter((object): object is PdfObject => object !== undefined)
        .map(streamFromObject)
        .join("\n");
      const text = extractText(content);
      const size = dimensions(pageObject);
      return {
        page,
        width: size.width,
        height: size.height,
        text,
        extraction: text.length > 0 ? "text" : "empty",
        featuresNotExtracted: ["images", "tables", "annotations", "forms", "text_region_mapping"],
        textRepresentationId: pdfPageTextRepresentationId(artifactId, page),
        imageRepresentationId: pdfPageImageRepresentationId(artifactId, page),
      };
    }),
  };
}

export function pdfPageSelector(page: number, region?: { x: number; y: number; width: number; height: number }) {
  return {
    kind: "document_page",
    page,
    ...(region === undefined ? {} : { region }),
  } as const;
}
