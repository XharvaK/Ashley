/**
 * Operator-controlled M4 recipe catalog (Sandbox V2 M4 kernel).
 *
 * Thought may name `recipeId` only. Executable, argv, env, network, and cwd
 * are owned by the catalog. A version identity is a digest of the immutable
 * definition fields; any change is a new version. The catalog is not stored
 * in the candidate tree.
 *
 * First-slice store: in-memory / injected records, or an operator JSON file
 * analog to project-roots.json. Catalog location remains OPEN in architecture.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { V2_HOST_FACTS, V2_LIMITS } from "../limits.js";

export type RecipeClass = "compile" | "typecheck";
export type RecipeNetworkMode = "none";
export type RecipeCwdPolicy = "/candidate" | "/output";
export type RecipePostcondition = "exit_code_zero";
export type RecipeCleanupRules = "discard_projection";

export type RecipeDefinition = {
  recipeId: string;
  recipeVersion: string;
  class: RecipeClass;
  executableIdentity: string;
  executablePath: string;
  argv: readonly string[];
  cwdPolicy: RecipeCwdPolicy;
  envAllowlist: Readonly<Record<string, string>>;
  networkMode: RecipeNetworkMode;
  timeoutMs: number;
  toolchainIdentity: string;
  declaredPostcondition: RecipePostcondition;
  cleanupRules: RecipeCleanupRules;
};

export type RecipeRecord = RecipeDefinition & {
  definitionHash: string;
  argvIdentity: string;
};

const FORBIDDEN_EXECUTABLE_BASENAMES = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "csh",
  "tcsh",
  "cmd.exe",
  "cmd",
  "powershell.exe",
  "powershell",
  "pwsh.exe",
  "pwsh",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
  "yarn",
  "yarn.cmd",
  "pnpm",
  "pnpm.cmd",
  "git",
  "git.exe",
]);

const FORBIDDEN_REQUEST_KEYS = [
  "command",
  "argv",
  "executable",
  "executablePath",
  "env",
  "network",
  "networkMode",
  "shell",
  "cwd",
  "cwdPolicy",
] as const;

const ALLOWED_REQUEST_KEYS = new Set([
  "version",
  "operation",
  "projectId",
  "workspaceId",
  "recipeId",
]);

export type RecipeCatalogError =
  | "recipe_not_found"
  | "recipe_definition_invalid"
  | "recipe_shell_forbidden"
  | "recipe_network_forbidden"
  | "recipe_package_manager_forbidden"
  | "recipe_integrity_mismatch";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashRecipeDefinition(definition: RecipeDefinition): string {
  return sha256Hex(
    canonicalJson({
      recipeId: definition.recipeId,
      recipeVersion: definition.recipeVersion,
      class: definition.class,
      executableIdentity: definition.executableIdentity,
      executablePath: definition.executablePath,
      argv: definition.argv,
      cwdPolicy: definition.cwdPolicy,
      envAllowlist: definition.envAllowlist,
      networkMode: definition.networkMode,
      timeoutMs: definition.timeoutMs,
      toolchainIdentity: definition.toolchainIdentity,
      declaredPostcondition: definition.declaredPostcondition,
      cleanupRules: definition.cleanupRules,
    }),
  );
}

export function hashArgvIdentity(argv: readonly string[]): string {
  return sha256Hex(canonicalJson(argv));
}

function executableBasename(executablePath: string): string {
  return basename(executablePath).toLowerCase();
}

export function recipeAdmissionError(definition: RecipeDefinition): RecipeCatalogError | undefined {
  if (definition.networkMode !== "none") {
    return "recipe_network_forbidden";
  }
  const base = executableBasename(definition.executablePath);
  if (FORBIDDEN_EXECUTABLE_BASENAMES.has(base)) {
    if (base === "npm" || base === "npm.cmd" || base === "npx" || base === "npx.cmd" ||
        base === "yarn" || base === "yarn.cmd" || base === "pnpm" || base === "pnpm.cmd") {
      return "recipe_package_manager_forbidden";
    }
    return "recipe_shell_forbidden";
  }
  if (definition.argv.some((arg) => arg === "-c" || arg === "/c" || arg === "-Command")) {
    return "recipe_shell_forbidden";
  }
  if (definition.argv.some((arg) => /(?:^|[\\/])(?:npm|npx|yarn|pnpm)(?:\.cmd)?$/i.test(arg))) {
    return "recipe_package_manager_forbidden";
  }
  if (
    typeof definition.recipeId !== "string" ||
    definition.recipeId.length < 1 ||
    definition.recipeId.length > V2_LIMITS.RECIPE_ID_MAX
  ) {
    return "recipe_definition_invalid";
  }
  if (
    typeof definition.recipeVersion !== "string" ||
    definition.recipeVersion.length < 1 ||
    definition.recipeVersion.length > V2_LIMITS.RECIPE_VERSION_MAX
  ) {
    return "recipe_definition_invalid";
  }
  if (typeof definition.executableIdentity !== "string" || definition.executableIdentity.length < 1) {
    return "recipe_definition_invalid";
  }
  if (typeof definition.executablePath !== "string" || definition.executablePath.length < 1) {
    return "recipe_definition_invalid";
  }
  if (!Array.isArray(definition.argv) || definition.argv.some((arg) => typeof arg !== "string")) {
    return "recipe_definition_invalid";
  }
  if (definition.cwdPolicy !== "/candidate" && definition.cwdPolicy !== "/output") {
    return "recipe_definition_invalid";
  }
  if (definition.declaredPostcondition !== "exit_code_zero") {
    return "recipe_definition_invalid";
  }
  if (definition.cleanupRules !== "discard_projection") {
    return "recipe_definition_invalid";
  }
  if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1) {
    return "recipe_definition_invalid";
  }
  return undefined;
}

export function sealRecipe(definition: RecipeDefinition): RecipeRecord {
  const frozenArgv = Object.freeze([...definition.argv]);
  const frozenEnv = Object.freeze({ ...definition.envAllowlist });
  const sealed: RecipeRecord = Object.freeze({
    recipeId: definition.recipeId,
    recipeVersion: definition.recipeVersion,
    class: definition.class,
    executableIdentity: definition.executableIdentity,
    executablePath: definition.executablePath,
    argv: frozenArgv,
    cwdPolicy: definition.cwdPolicy,
    envAllowlist: frozenEnv,
    networkMode: definition.networkMode,
    timeoutMs: definition.timeoutMs,
    toolchainIdentity: definition.toolchainIdentity,
    declaredPostcondition: definition.declaredPostcondition,
    cleanupRules: definition.cleanupRules,
    definitionHash: hashRecipeDefinition({ ...definition, argv: frozenArgv, envAllowlist: frozenEnv }),
    argvIdentity: hashArgvIdentity(frozenArgv),
  });
  return sealed;
}

export function verifyRecipeIntegrity(record: RecipeRecord): RecipeCatalogError | undefined {
  const admission = recipeAdmissionError(record);
  if (admission) return admission;
  const expectedDefinitionHash = hashRecipeDefinition(record);
  const expectedArgvIdentity = hashArgvIdentity(record.argv);
  if (record.definitionHash !== expectedDefinitionHash || record.argvIdentity !== expectedArgvIdentity) {
    return "recipe_integrity_mismatch";
  }
  return undefined;
}

export type WorkspaceVerifyRequestValidation =
  | {
      ok: true;
      projectId: string;
      workspaceId: string;
      recipeId: string;
    }
  | { ok: false; error: string };

export function validateWorkspaceVerifyRequest(value: unknown): WorkspaceVerifyRequestValidation {
  if (!isRecord(value)) {
    return { ok: false, error: "request_invalid" };
  }
  const keys = Object.keys(value);
  for (const key of keys) {
    if ((FORBIDDEN_REQUEST_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: "request_forbidden_field" };
    }
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      return { ok: false, error: "request_forbidden_field" };
    }
  }
  if (value.version !== 2) {
    return { ok: false, error: "request_invalid" };
  }
  if (value.operation !== "workspace.verify") {
    return { ok: false, error: "request_invalid" };
  }
  if (
    typeof value.projectId !== "string" ||
    value.projectId.length < 1 ||
    value.projectId.length > V2_LIMITS.PROJECT_ID_MAX
  ) {
    return { ok: false, error: "project_id_invalid" };
  }
  if (
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length < 8 ||
    value.workspaceId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value.workspaceId)
  ) {
    return { ok: false, error: "workspace_id_invalid" };
  }
  if (
    typeof value.recipeId !== "string" ||
    value.recipeId.length < 1 ||
    value.recipeId.length > V2_LIMITS.RECIPE_ID_MAX
  ) {
    return { ok: false, error: "recipe_id_invalid" };
  }
  return {
    ok: true,
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    recipeId: value.recipeId,
  };
}

export class RecipeCatalog {
  private readonly byId: ReadonlyMap<string, RecipeRecord>;

  constructor(definitions: readonly RecipeDefinition[]) {
    const map = new Map<string, RecipeRecord>();
    for (const definition of definitions) {
      const admission = recipeAdmissionError(definition);
      if (admission) {
        throw new Error(`recipe_catalog_invalid:${admission}:${definition.recipeId}`);
      }
      if (map.has(definition.recipeId)) {
        throw new Error(`recipe_catalog_duplicate:${definition.recipeId}`);
      }
      map.set(definition.recipeId, sealRecipe(definition));
    }
    this.byId = map;
  }

  static loadFromFile(path: string): RecipeCatalog {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) {
      throw new Error("recipe_catalog_invalid:not_array");
    }
    return new RecipeCatalog(raw as RecipeDefinition[]);
  }

  resolve(recipeId: string): { ok: true; record: RecipeRecord } | { ok: false; error: RecipeCatalogError } {
    const record = this.byId.get(recipeId);
    if (!record) return { ok: false, error: "recipe_not_found" };
    const integrity = verifyRecipeIntegrity(record);
    if (integrity) return { ok: false, error: integrity };
    return { ok: true, record };
  }

  list(): RecipeRecord[] {
    return [...this.byId.values()];
  }
}

/**
 * First-slice fixture compile recipe. Offline, no package manager, no repo
 * scripts. Host toolchain must already be provisioned; missing binary is
 * admission refusal, not a fallback to npm.
 */
export function typescriptFixtureCompileV1(): RecipeDefinition {
  return {
    recipeId: "typescript_fixture_compile_v1",
    recipeVersion: "1",
    class: "compile",
    executableIdentity: "mint:node-v22.23.2",
    executablePath: V2_HOST_FACTS.NODE_BIN,
    argv: [
      "/opt/node/lib/node_modules/typescript/bin/tsc",
      "--pretty",
      "false",
      "--rootDir",
      "/candidate",
      "--outDir",
      "/output",
    ],
    cwdPolicy: "/candidate",
    envAllowlist: Object.freeze({}),
    networkMode: "none",
    timeoutMs: V2_LIMITS.TIMEOUT_MS,
    toolchainIdentity: "mint:node-v22.23.2+tsc",
    declaredPostcondition: "exit_code_zero",
    cleanupRules: "discard_projection",
  };
}

export function createFirstSliceRecipeCatalog(): RecipeCatalog {
  return new RecipeCatalog([typescriptFixtureCompileV1()]);
}
