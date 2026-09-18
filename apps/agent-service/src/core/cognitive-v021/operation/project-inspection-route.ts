import type { CognitionInspectionRequest } from "../../../core/types.js";
import type { ProjectInspectionRequest } from "../types.js";

export type ProjectInspectionRoute = "direct" | "worker";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function exactKeys(value: RecordValue, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function validLocator(value: unknown): boolean {
  const locator = record(value);
  if (!locator || typeof locator.kind !== "string") return false;
  if (locator.kind === "file" || locator.kind === "directory") {
    return exactKeys(locator, ["kind", "path"]) && nonEmpty(locator.path);
  }
  if (locator.kind !== "search") return false;
  return exactKeys(locator, ["kind", "pattern"], ["path", "maxMatches"])
    && nonEmpty(locator.pattern)
    && (locator.path === undefined || nonEmpty(locator.path))
    && (locator.maxMatches === undefined
      || (typeof locator.maxMatches === "number" && Number.isSafeInteger(locator.maxMatches) && locator.maxMatches > 0));
}

/** Only a complete, single-primitive locator may use direct V2. */
export function isExactDirectProjectInspectionRequest(value: unknown): boolean {
  const request = record(value);
  return request !== null
    && exactKeys(request, ["projectId", "locator"])
    && nonEmpty(request.projectId)
    && validLocator(request.locator);
}

/** Deterministic route rule. Any missing or additional semantic context is worker-required. */
export function routeProjectInspectionRequest(value: unknown): ProjectInspectionRoute {
  return isExactDirectProjectInspectionRequest(value) ? "direct" : "worker";
}

/** Convert only an exact route-neutral locator into an internal V2 primitive. */
export function directProjectInspectionRequest(value: unknown): CognitionInspectionRequest | null {
  if (!isExactDirectProjectInspectionRequest(value)) return null;
  const request = value as unknown as ProjectInspectionRequest;
  const locator = request.locator!;
  if (locator.kind === "file") {
    return { operation: "project.read_file", projectId: request.projectId, path: locator.path };
  }
  if (locator.kind === "directory") {
    return { operation: "project.list_directory", projectId: request.projectId, path: locator.path };
  }
  return {
    operation: "project.search_text",
    projectId: request.projectId,
    pattern: locator.pattern,
    ...(locator.path === undefined ? {} : { path: locator.path }),
    ...(locator.maxMatches === undefined ? {} : { maxMatches: locator.maxMatches }),
  };
}

/** Translate the semantic worker request at the Host boundary only. */
export function workerProjectInspectionRequest(value: unknown): Record<string, unknown> | null {
  const request = record(value);
  if (!request || !nonEmpty(request.projectId)) return null;
  const locator = record(request.locator);
  const focus = nonEmpty(request.focus)
    ? request.focus
    : nonEmpty(request.question)
      ? request.question
      : locator
        ? `inspect locator ${JSON.stringify(locator)}`
        : undefined;
  return {
    projectId: request.projectId,
    ...(focus ? { focus } : {}),
    maxSteps: typeof request.maxSteps === "number" && Number.isSafeInteger(request.maxSteps)
      ? request.maxSteps
      : 8,
  };
}

