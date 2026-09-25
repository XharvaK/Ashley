import { V2_LIMITS } from "../limits.js";

type StringField = {
  type: "string";
  required: boolean;
  minLength?: number;
  maxLength?: number;
  maxBytes?: number;
  pattern?: "sha256";
  description: string;
};

type IntegerField = {
  type: "integer";
  required: boolean;
  min: number;
  max: number;
  description: string;
};

type WorkerField = StringField | IntegerField;
type WorkerOperation = {
  description: string;
  fields: Record<string, WorkerField>;
};

/**
 * Canonical worker-facing workspace request schema. The host bridge, worker
 * prompt, and embedded runner validator are all generated from this table.
 */
export const WORKSPACE_WORKER_REQUEST_SCHEMA = {
  "workspace.read_file": {
    description: "Read one complete UTF-8 file; non-UTF-8 content is refused with not_utf8. The result includes its raw-byte SHA-256 and complete byte extent.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative file path." },
    },
  },
  "workspace.list_directory": {
    description: "List one workspace directory.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative directory path." },
    },
  },
  "workspace.search_text": {
    description: "Search literal substrings by line under path (omitted path means the workspace root). truncated=true and filesScanned report omitted search extent when a traversal or match limit is reached.",
    fields: {
      path: { type: "string", required: false, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative directory path; omitted means the workspace root." },
      pattern: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.SEARCH_PATTERN_MAX, description: "Literal search text." },
      maxMatches: { type: "integer", required: false, min: 1, max: V2_LIMITS.SEARCH_MAX_MATCHES, description: "Optional match cap; it can only tighten the host cap." },
    },
  },
  "workspace.write_file": {
    description: "This operation is create-only. An existing target returns file_exists and keeps its bytes unchanged.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative file path." },
      content: { type: "string", required: true, maxBytes: V2_LIMITS.M3_WRITE_MAX_BYTES, description: "UTF-8 file content." },
    },
  },
  "workspace.replace_file": {
    description: "Replace an existing UTF-8 file only when expectedSha256 matches the current raw bytes.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative file path." },
      content: { type: "string", required: true, maxBytes: V2_LIMITS.M3_WRITE_MAX_BYTES, description: "Replacement UTF-8 file content." },
      expectedSha256: { type: "string", required: true, pattern: "sha256", description: "Lowercase 64-character SHA-256 of the current raw file bytes." },
    },
  },
  "workspace.edit_text": {
    description: "Replace oldText exactly once in a UTF-8 file after expectedSha256 matches the current raw bytes. Non-UTF-8 input returns not_utf8 without a write.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative file path." },
      oldText: { type: "string", required: true, minLength: 1, maxBytes: V2_LIMITS.M3_WRITE_MAX_BYTES, description: "Exact non-empty text that must occur once." },
      newText: { type: "string", required: true, maxBytes: V2_LIMITS.M3_WRITE_MAX_BYTES, description: "Replacement UTF-8 text; it may be empty." },
      expectedSha256: { type: "string", required: true, pattern: "sha256", description: "Lowercase 64-character SHA-256 of the current raw file bytes." },
    },
  },
  "workspace.delete_file": {
    description: "Delete one file only when expectedSha256 matches its current raw bytes. Directories are never removed recursively.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative file path." },
      expectedSha256: { type: "string", required: true, pattern: "sha256", description: "Lowercase 64-character SHA-256 of the current raw file bytes." },
    },
  },
  "workspace.create_directory": {
    description: "Create a workspace directory and any missing parent directories.",
    fields: {
      path: { type: "string", required: true, minLength: 1, maxLength: V2_LIMITS.PATH_MAX, description: "Project-relative directory path." },
    },
  },
} as const satisfies Record<string, WorkerOperation>;

export type WorkspaceWorkerOperation = keyof typeof WORKSPACE_WORKER_REQUEST_SCHEMA;

export const WORKSPACE_WORKER_REQUEST_SCHEMA_ID = "ashley.workspace_worker_request.v1" as const;

export type WorkspaceWorkerFieldError = Readonly<{
  fieldPath: string;
  expectedSchemaId: typeof WORKSPACE_WORKER_REQUEST_SCHEMA_ID;
  preconditionCode: string;
  executionStarted: boolean;
  afterSha256?: string;
}>;

export const WORKSPACE_TOOL_OPERATIONS = Object.freeze(
  Object.keys(WORKSPACE_WORKER_REQUEST_SCHEMA) as WorkspaceWorkerOperation[],
);

export type WorkspaceWorkerRequestValidation =
  | { ok: true }
  | { ok: false; error: "invalid_request"; fieldErrors: readonly WorkspaceWorkerFieldError[] };

function fieldPath(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/.test(key) ? `$.${key}` : "$request";
}

function fieldError(field: string, preconditionCode: string): WorkspaceWorkerFieldError {
  return {
    fieldPath: field,
    expectedSchemaId: WORKSPACE_WORKER_REQUEST_SCHEMA_ID,
    preconditionCode,
    executionStarted: false,
  };
}

export function workspaceWorkerFieldError(
  fieldPath: string,
  preconditionCode: string,
): WorkspaceWorkerFieldError {
  return fieldError(fieldPath, preconditionCode);
}

export function workspaceWorkerFieldPath(operation: string, preconditionCode: string): string {
  if (preconditionCode === "hash_mismatch") return "$.expectedSha256";
  if (preconditionCode === "no_matches" || preconditionCode === "ambiguous_matches") return "$.oldText";
  if (preconditionCode === "content_too_large" || preconditionCode === "workspace_limit_exceeded") {
    return operation === "workspace.edit_text" ? "$.newText" : "$.content";
  }
  if ([
    "invalid_path", "not_found", "file_not_found", "file_exists", "symlink_forbidden",
    "path_escapes_workspace", "not_a_file", "read_failed", "not_utf8", "verify_failed",
    "symlink_forbidden_after_write",
  ].includes(preconditionCode)) return "$.path";
  return preconditionCode === "bad-request" ? "$request" : "$.operation";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateField(value: unknown, field: WorkerField): boolean {
  if (field.type === "string") {
    if (typeof value !== "string") return false;
    if (field.minLength !== undefined && value.length < field.minLength) return false;
    if (field.maxLength !== undefined && value.length > field.maxLength) return false;
    if (field.maxBytes !== undefined && Buffer.byteLength(value, "utf8") > field.maxBytes) return false;
    if (field.pattern === "sha256" && !/^[0-9a-f]{64}$/.test(value)) return false;
    return true;
  }
  return typeof value === "number" && Number.isInteger(value) && value >= field.min && value <= field.max;
}

function formatFieldType(field: WorkerField): string {
  if (field.type === "integer") return `integer ${field.min}..${field.max}`;
  if (field.pattern === "sha256") return "lowercase 64-character SHA-256";
  const bounds = [
    field.minLength === 1 ? "non-empty" : field.minLength !== undefined ? `at least ${field.minLength} characters` : "",
    field.maxLength !== undefined ? `at most ${field.maxLength} characters` : "",
    field.maxBytes !== undefined ? `at most ${field.maxBytes} UTF-8 bytes` : "",
  ].filter(Boolean);
  return bounds.length > 0 ? `string (${bounds.join(", ")})` : "string";
}

export function validateWorkspaceWorkerRequest(
  operation: string,
  request: unknown,
): WorkspaceWorkerRequestValidation {
  if (!isRecord(request)) {
    return { ok: false, error: "invalid_request", fieldErrors: [fieldError("$request", "object_required")] };
  }
  const spec = Object.prototype.hasOwnProperty.call(WORKSPACE_WORKER_REQUEST_SCHEMA, operation)
    ? WORKSPACE_WORKER_REQUEST_SCHEMA[operation as WorkspaceWorkerOperation]
    : undefined;
  if (!spec) {
    return { ok: false, error: "invalid_request", fieldErrors: [fieldError("$.operation", "unsupported_operation")] };
  }
  const fields = spec.fields as Record<string, WorkerField>;
  const fieldErrors: WorkspaceWorkerFieldError[] = [];
  for (const key of Object.keys(request)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      fieldErrors.push(fieldError(fieldPath(key), "unexpected_field"));
    }
  }
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(request, key)) {
      if (field.required) fieldErrors.push(fieldError(`$.${key}`, "required_field_missing"));
      continue;
    }
    if (!validateField(request[key], field)) fieldErrors.push(fieldError(`$.${key}`, "field_constraint_failed"));
  }
  return fieldErrors.length === 0
    ? { ok: true }
    : { ok: false, error: "invalid_request", fieldErrors: fieldErrors.slice(0, 16) };
}

export function formatWorkspaceToolContractPrompt(): string {
  const operationLines = WORKSPACE_TOOL_OPERATIONS.map((operation) => {
    const spec = WORKSPACE_WORKER_REQUEST_SCHEMA[operation];
    const fields = Object.entries(spec.fields).map(([name, field]) => {
      const optional = field.required ? "" : "?";
      const type = formatFieldType(field);
      return `${name}${optional}: ${type} — ${field.description}`;
    });
    return `${operation}: ${spec.description}\n  request fields: ${fields.join("; ")}`;
  });
  return [
    `Expected request schema id: ${WORKSPACE_WORKER_REQUEST_SCHEMA_ID}. Host failures may report a field path and precondition code; they never include a rejected field value.`,
    `Exact workspace request fields follow. Unknown fields are rejected. Request JSON is limited to ${V2_LIMITS.WORKSPACE_REQUEST_MAX_BYTES} bytes; read_file is limited to ${V2_LIMITS.READ_MAX_BYTES} bytes and refuses non-UTF-8; list_directory returns at most ${V2_LIMITS.LIST_MAX_ENTRIES} entries; writes are limited to ${V2_LIMITS.M3_WRITE_MAX_BYTES} UTF-8 bytes; workspace storage is limited to ${V2_LIMITS.WORKSPACE_MAX_BYTES} bytes.`,
    `search_text matches literal substrings within lines, under the requested directory or workspace root. Pattern length is at most ${V2_LIMITS.SEARCH_PATTERN_MAX}; each call returns at most ${V2_LIMITS.SEARCH_MAX_MATCHES} matches, scans at most ${V2_LIMITS.SEARCH_MAX_FILES} files of at most ${V2_LIMITS.SEARCH_MAX_FILE_BYTES} bytes each and depth ${V2_LIMITS.SEARCH_MAX_DEPTH}, and limits each returned line preview to ${V2_LIMITS.SEARCH_MATCH_TEXT_MAX} characters. truncated=true indicates omitted matches or traversal; filesScanned reports the number of files examined.`,
    ...operationLines,
  ].join("\n");
}

const RUNNER_ENVELOPE_SCHEMA = {
  version: { type: "integer", required: true, value: 2 },
  workspaceId: { type: "string", required: true },
  probePort: { type: "integer", required: true, min: 1, max: 65_535 },
  sentinelPath: { type: "string", required: true },
  fdSentinelCanonical: { type: "string", required: true },
} as const;

/** Generated JavaScript is embedded verbatim in the isolated workspace runner. */
export const WORKSPACE_RUNNER_REQUEST_VALIDATOR_SOURCE = [
  `var WORKSPACE_WORKER_REQUEST_SCHEMA = ${JSON.stringify(WORKSPACE_WORKER_REQUEST_SCHEMA)};`,
  `var WORKSPACE_RUNNER_ENVELOPE_SCHEMA = ${JSON.stringify(RUNNER_ENVELOPE_SCHEMA)};`,
  `var WORKSPACE_REQUEST_MAX_BYTES = ${V2_LIMITS.WORKSPACE_REQUEST_MAX_BYTES};`,
  `var WORKSPACE_MAX_BYTES = ${V2_LIMITS.WORKSPACE_MAX_BYTES};`,
  `var WORKSPACE_READ_MAX_BYTES = ${V2_LIMITS.READ_MAX_BYTES};`,
  `var WORKSPACE_WRITE_MAX_BYTES = ${V2_LIMITS.M3_WRITE_MAX_BYTES};`,
  `var WORKSPACE_LIST_MAX_ENTRIES = ${V2_LIMITS.LIST_MAX_ENTRIES};`,
  `var WORKSPACE_SEARCH_PATTERN_MAX = ${V2_LIMITS.SEARCH_PATTERN_MAX};`,
  `var WORKSPACE_SEARCH_MAX_MATCHES = ${V2_LIMITS.SEARCH_MAX_MATCHES};`,
  `var WORKSPACE_SEARCH_MAX_FILES = ${V2_LIMITS.SEARCH_MAX_FILES};`,
  `var WORKSPACE_SEARCH_MAX_FILE_BYTES = ${V2_LIMITS.SEARCH_MAX_FILE_BYTES};`,
  `var WORKSPACE_SEARCH_MAX_DEPTH = ${V2_LIMITS.SEARCH_MAX_DEPTH};`,
  `var WORKSPACE_SEARCH_MATCH_TEXT_MAX = ${V2_LIMITS.SEARCH_MATCH_TEXT_MAX};`,
  `function validateWorkspaceRunnerField(value, field) {`,
  `  if (field.type === "string") {`,
  `    if (typeof value !== "string") return false;`,
  `    if (field.minLength !== undefined && value.length < field.minLength) return false;`,
  `    if (field.maxLength !== undefined && value.length > field.maxLength) return false;`,
  `    if (field.maxBytes !== undefined && Buffer.byteLength(value, "utf8") > field.maxBytes) return false;`,
  `    if (field.pattern === "sha256" && !/^[0-9a-f]{64}$/.test(value)) return false;`,
  `    return true;`,
  `  }`,
  `  return typeof value === "number" && Number.isInteger(value) && value >= field.min && value <= field.max;`,
  `}`,
  `function validateWorkspaceRunnerRequest(req) {`,
  `  if (!req || typeof req !== "object" || Array.isArray(req)) return false;`,
  `  if (req.version !== WORKSPACE_RUNNER_ENVELOPE_SCHEMA.version.value || typeof req.operation !== "string") return false;`,
  `  if (!Object.prototype.hasOwnProperty.call(WORKSPACE_WORKER_REQUEST_SCHEMA, req.operation)) return false;`,
  `  var spec = WORKSPACE_WORKER_REQUEST_SCHEMA[req.operation];`,
  `  if (!spec) return false;`,
  `  var allowed = { version: true, operation: true };`,
  `  Object.keys(WORKSPACE_RUNNER_ENVELOPE_SCHEMA).forEach(function (key) { allowed[key] = true; });`,
  `  Object.keys(spec.fields).forEach(function (key) { allowed[key] = true; });`,
  `  if (Object.keys(req).some(function (key) { return !Object.prototype.hasOwnProperty.call(allowed, key); })) return false;`,
  `  for (var envelopeKey in WORKSPACE_RUNNER_ENVELOPE_SCHEMA) {`,
  `    var envelopeField = WORKSPACE_RUNNER_ENVELOPE_SCHEMA[envelopeKey];`,
  `    if (envelopeField.required && !Object.prototype.hasOwnProperty.call(req, envelopeKey)) return false;`,
  `    if (Object.prototype.hasOwnProperty.call(req, envelopeKey)) {`,
  `      if (envelopeField.type === "string" && (typeof req[envelopeKey] !== "string" || req[envelopeKey].length === 0)) return false;`,
  `      if (envelopeField.type === "integer" && (typeof req[envelopeKey] !== "number" || !Number.isInteger(req[envelopeKey]) || (envelopeField.min !== undefined && req[envelopeKey] < envelopeField.min) || (envelopeField.max !== undefined && req[envelopeKey] > envelopeField.max))) return false;`,
  `    }`,
  `  }`,
  `  for (var fieldKey in spec.fields) {`,
  `    var field = spec.fields[fieldKey];`,
  `    if (!Object.prototype.hasOwnProperty.call(req, fieldKey)) { if (field.required) return false; continue; }`,
  `    if (!validateWorkspaceRunnerField(req[fieldKey], field)) return false;`,
  `  }`,
  `  return true;`,
  `}`,
].join("\n");
