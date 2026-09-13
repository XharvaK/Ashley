import { createHash } from "node:crypto";
import type { JsonValue } from "./types.js";

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical_number_invalid");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("canonical_value_invalid");
}

export function canonicalize(value: JsonValue | Record<string, unknown>): string {
  return canonicalValue(value);
}

function withoutVolatileTopLevelFields(value: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...value };
  delete clone.extracted_at;
  delete clone.temporary_paths;
  delete clone.process_id;
  delete clone.snapshot_path;
  return clone;
}

export function computeBundleId(value: Record<string, unknown>): string {
  const canonical = canonicalize(withoutVolatileTopLevelFields(value));
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex");
}
