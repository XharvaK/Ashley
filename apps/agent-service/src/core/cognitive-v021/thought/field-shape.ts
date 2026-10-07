import { THOUGHT_OUTPUT_SCHEMA } from "./output-contract.js";

let vocabulary: Set<string> | undefined;
/** Every property name the Thought output schema defines, at any depth. */
function contractVocabulary(): Set<string> {
  if (vocabulary) return vocabulary;
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object") {
      for (const name of Object.keys(record.properties as object)) names.add(name);
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(THOUGHT_OUTPUT_SCHEMA);
  vocabulary = names;
  return names;
}

/** The shape of one field of a model's JSON output, for a parse-failure log: types, lengths and counts only, never content. */
export function describeFieldShape(text: string, field: string | undefined, refs?: ReadonlySet<string>): string {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return "unparseable";
  }
  if (field === undefined || field === "") return "-";
  const value = walkField(root, field);
  if (value === ABSENT) return "absent";
  return cap(describeValue(value, refs));
}

const ABSENT = Symbol("absent");
const SHAPE_CAP = 120;

function walkField(root: unknown, field: string): unknown {
  let current: unknown = root;
  for (const segment of field.split(".")) {
    const match = /^([^[\]]+)(?:\[(\d+)\])?$/.exec(segment);
    if (!match) return ABSENT;
    const key = match[1];
    if (current === null || typeof current !== "object" || Array.isArray(current)) return ABSENT;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, key)) return ABSENT;
    current = record[key];
    if (match[2] !== undefined) {
      const index = Number(match[2]);
      if (!Array.isArray(current) || index >= current.length) return ABSENT;
      current = current[index];
    }
  }
  return current;
}

function describeValue(value: unknown, refs: ReadonlySet<string> | undefined): string {
  if (value === null) return "null";
  if (typeof value === "string") return `string(len ${value.length})`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    const types: string[] = [];
    let allStrings = true;
    let known = 0;
    for (const element of value) {
      const name = elementTypeName(element);
      if (!types.includes(name)) types.push(name);
      if (typeof element !== "string") allStrings = false;
      else if (refs?.has(element)) known += 1;
    }
    const knownSuffix = allStrings && refs !== undefined ? `; known ${known}/${value.length}` : "";
    return `array(len ${value.length}; types ${types.join(",")}${knownSuffix})`;
  }
  if (typeof value === "object") {
    // Keys are named only when they are contract vocabulary; any other key may carry content and is only counted.
    const keys = Object.keys(value as Record<string, unknown>);
    const known = keys.filter((key) => contractVocabulary().has(key));
    const unknown = keys.length - known.length;
    const parts = [...known.slice(0, 8), ...(unknown > 0 ? [`+${unknown} unknown`] : [])];
    return `object(keys ${keys.length}${parts.length ? `: ${parts.join(",")}` : ""})`;
  }
  return typeof value;
}

function elementTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "object") {
    return typeof value;
  }
  return typeof value;
}

function cap(shape: string): string {
  return shape.length > SHAPE_CAP ? shape.slice(0, SHAPE_CAP) : shape;
}
