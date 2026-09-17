import { MODE_B_DEVELOP, MODE_B_HOST_MAX_STEPS, MODE_B_INVESTIGATE } from "./catalog.js";

const FORBIDDEN_MODE_B_KEYS = [
  "model",
  "quota",
  "pool",
  "quotaPool",
  "quotaClass",
  "provider",
  "argv",
  "shell",
  "environment",
  "env",
  "network",
  "networkMode",
  "networkTargets",
  "opencode",
  "opencodeFlags",
  "flags",
  "executable",
  "executablePath",
  "cwd",
  "cwdPolicy",
  "command",
  "workspacePath",
  "hostPath",
  "canonicalRoot",
  "continueUntilSolved",
  "recipeArgv",
  "baseUrl",
  "apiKey",
  "home",
  "HOME",
] as const;

const INVESTIGATE_ALLOWED = new Set(["projectId", "focus", "maxSteps"]);
const DEVELOP_ALLOWED = new Set(["projectId", "focus", "maxSteps", "workspaceId"]);

export type ModeBInvestigateRequest = {
  kind: typeof MODE_B_INVESTIGATE;
  projectId: string;
  focus?: string;
  maxSteps: number;
};

export type ModeBDevelopRequest = {
  kind: typeof MODE_B_DEVELOP;
  projectId: string;
  focus?: string;
  maxSteps: number;
  workspaceId?: string;
};

export type ModeBRequest = ModeBInvestigateRequest | ModeBDevelopRequest;

export type ModeBRequestError =
  | "unknown_field"
  | "forbidden_field"
  | "missing_project"
  | "invalid_focus"
  | "invalid_max_steps"
  | "invalid_workspace_id"
  | "wrong_kind";

export type ModeBRequestResult =
  | { ok: true; value: ModeBRequest }
  | { ok: false; error: ModeBRequestError; field?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeHostPath(value: string): boolean {
  return value.includes("\\") || value.startsWith("/") || value.includes("..") || /^[A-Za-z]:/.test(value);
}

function parseMaxSteps(value: unknown): number | null {
  if (value === undefined) return MODE_B_HOST_MAX_STEPS;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return null;
  return Math.min(value, MODE_B_HOST_MAX_STEPS);
}

export function validateModeBRequest(input: {
  kind: string;
  request: unknown;
}): ModeBRequestResult {
  if (input.kind !== MODE_B_INVESTIGATE && input.kind !== MODE_B_DEVELOP) {
    return { ok: false, error: "wrong_kind" };
  }
  if (!isRecord(input.request)) return { ok: false, error: "missing_project" };
  const allowed = input.kind === MODE_B_INVESTIGATE ? INVESTIGATE_ALLOWED : DEVELOP_ALLOWED;
  for (const key of Object.keys(input.request)) {
    if ((FORBIDDEN_MODE_B_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: "forbidden_field", field: key };
    }
    if (!allowed.has(key)) return { ok: false, error: "unknown_field", field: key };
  }
  const projectId = input.request.projectId;
  if (typeof projectId !== "string" || projectId.length === 0 || looksLikeHostPath(projectId)) {
    return { ok: false, error: "missing_project", field: "projectId" };
  }
  const maxSteps = parseMaxSteps(input.request.maxSteps);
  if (maxSteps == null) return { ok: false, error: "invalid_max_steps", field: "maxSteps" };
  if (input.request.focus !== undefined) {
    if (typeof input.request.focus !== "string" || input.request.focus.length === 0) {
      return { ok: false, error: "invalid_focus", field: "focus" };
    }
    if (looksLikeHostPath(input.request.focus)) {
      return { ok: false, error: "invalid_focus", field: "focus" };
    }
  }
  if (input.kind === MODE_B_INVESTIGATE) {
    return {
      ok: true,
      value: {
        kind: MODE_B_INVESTIGATE,
        projectId,
        maxSteps,
        ...(typeof input.request.focus === "string" ? { focus: input.request.focus } : {}),
      },
    };
  }
  if (input.request.workspaceId !== undefined) {
    if (typeof input.request.workspaceId !== "string" || input.request.workspaceId.length === 0) {
      return { ok: false, error: "invalid_workspace_id", field: "workspaceId" };
    }
    if (looksLikeHostPath(input.request.workspaceId)) {
      return { ok: false, error: "invalid_workspace_id", field: "workspaceId" };
    }
  }
  return {
    ok: true,
    value: {
      kind: MODE_B_DEVELOP,
      projectId,
      maxSteps,
      ...(typeof input.request.focus === "string" ? { focus: input.request.focus } : {}),
      ...(typeof input.request.workspaceId === "string" ? { workspaceId: input.request.workspaceId } : {}),
    },
  };
}
