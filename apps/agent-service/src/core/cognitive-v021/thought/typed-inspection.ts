export const TYPED_INSPECTION_OPERATION_KINDS = [
  "capability.inspect",
  "evidence.inspect",
  "temporal.inspect",
  "work.inspect",
] as const;

export type TypedInspectionOperationKind = (typeof TYPED_INSPECTION_OPERATION_KINDS)[number];

export type TypedInspectionRequest =
  | { operationKind: string }
  | { filter?: { modality?: string }; limit?: number; cursor?: string }
  | { limit?: number; cursor?: string };

export class CapabilityUnavailableError extends Error {
  readonly code = "CAPABILITY_UNAVAILABLE";
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super("CAPABILITY_UNAVAILABLE:" + reasonCode);
    this.name = "CapabilityUnavailableError";
    this.reasonCode = safeReasonCode(reasonCode);
  }
}

export function safeReasonCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,95}$/.test(value) ? value : "inspect_unavailable";
}

export function isTypedInspectionOperationKind(value: string): value is TypedInspectionOperationKind {
  return (TYPED_INSPECTION_OPERATION_KINDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validLimit(value: unknown): boolean {
  return value === undefined || (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 64
  );
}

function validCursor(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 512);
}

export function isValidTypedInspectionRequest(
  operationKind: string,
  value: unknown,
): value is Record<string, unknown> {
  if (!isTypedInspectionOperationKind(operationKind) || !isRecord(value)) return false;

  if (operationKind === "capability.inspect") {
    return onlyKeys(value, ["operationKind"])
      && typeof value.operationKind === "string"
      && /^[a-z][a-z0-9_.-]{0,95}$/.test(value.operationKind);
  }

  if (!onlyKeys(value, ["filter", "limit", "cursor"]) || !validLimit(value.limit) || !validCursor(value.cursor)) {
    return false;
  }

  if (operationKind !== "evidence.inspect") return value.filter === undefined;
  if (value.filter === undefined) return true;
  if (!isRecord(value.filter) || !onlyKeys(value.filter, ["modality"])) return false;
  return value.filter.modality === undefined || (
    typeof value.filter.modality === "string"
    && /^[a-z][a-z0-9_-]{0,63}$/.test(value.filter.modality)
  );
}