import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, freezeDeep } from "./hash.js";
import type {
  LogicalModelRole,
  ModelFallbackClass,
  ModelPurposeId,
  ReasoningPolicy,
  StructuredOutputCapabilityBinding,
  SpecialistRequirement,
} from "./types.js";

export type PortfolioQuotaContract =
  | "env"
  | {
      rps: number;
      rpm: number;
      rpd: number;
      tpm: number;
      tpd: number;
    };

export type CurrentRouteRecord = {
  route: string;
  provider: string;
  configuredModelId: string;
  contextProfile: string;
  enabled: boolean;
  quotaContract: PortfolioQuotaContract;
};

export type ModelFabricOccupant = Readonly<{
  occupantId: string;
  ordinal?: number;
  provider: string;
  backend: string;
  configuredModelId: string;
  independenceGroup: string;
  reasoningPolicy?: ReasoningPolicy;
  effectiveReasoning?: string | null;
  adapterSemanticRevision?: string;
  structuredOutputBinding?: StructuredOutputCapabilityBinding;
  privacyEligibility?: readonly string[];
  admissionBasis?: Readonly<Record<string, unknown>>;
  fallbackClassFromPrevious?: ModelFallbackClass;
  fallbackTriggerClasses?: readonly string[];
  qualificationResultId?: string | null;
  ownerApprovalRefId?: string | null;
  invocationMode?: string;
  notes?: string;
  [key: string]: unknown;
}>;

export type ModelFabricPolicyRow = Readonly<{
  schema: "ashley.model_fabric.policy_row.v1";
  policyRowId: string;
  portfolioRevisionId: string;
  logicalRole: LogicalModelRole;
  occupancyKey: string;
  seat: string | null;
  purposes: readonly ModelPurposeId[];
  configuredRouteId?: string;
  dispatchedRouteId?: string;
  latencyClass: "interactive" | "urgent" | "background" | "batch";
  reliabilityClass: "single_attempt" | "explicit_fallback";
  privacyPolicyId: string;
  contextPolicyId: string;
  quotaCouplingIds: readonly string[];
  reasoningPolicy: ReasoningPolicy;
  structuredOutput: "none" | "json" | "json_schema";
  deadlineMs: number | null;
  maxOutputTokens: number | null;
  failoverRemainingMsFloor: number | null;
  failClosed: string;
  unorderedCandidates: readonly ModelFabricOccupant[];
  occupants: readonly ModelFabricOccupant[];
  notes?: string;
}>;

export type ModelFabricPortfolio = Readonly<{
  schema: "ashley.model_fabric.portfolio_revision.v1";
  portfolioRevisionId: string;
  kind: "current_compatibility";
  status: "declared" | "superseded";
  replacesPortfolioRevisionId: string | null;
  notes: string;
  routeBindings: Readonly<Record<string, Readonly<CurrentRouteRecordInput>>>;
  rows: readonly ModelFabricPolicyRow[];
  registryVersion: `sha256:${string}`;
  sourcePath: string;
  incompleteFixture?: boolean;
}>;

type CurrentRouteRecordInput = Omit<CurrentRouteRecord, "route">;

export type CurrentPolicyResolution = Readonly<{
  registryVersion: `sha256:${string}`;
  portfolioRevisionId: string;
  policyRow: ModelFabricPolicyRow;
  occupant: ModelFabricOccupant;
  specialistRequirement: SpecialistRequirement | null;
  configuredRouteId: string;
  dispatchedRouteId: string;
  configuredModelId: string;
  routeOverride: string | null;
  modelOverride: string | null;
}>;

export type CurrentPolicyResolutionInput = {
  logicalRole: LogicalModelRole;
  purpose: ModelPurposeId;
  lane?: string;
  deadlineAtMs?: number | null;
  routeId?: string;
  model?: string;
  specialistRequirement?: SpecialistRequirement | null;
};

const CURRENT_FILENAME = "current-compatibility.v3.json";
let cachedCurrent: ModelFabricPortfolio | null = null;

function candidatePortfolioPaths(): string[] {
  const paths: string[] = [];
  const configured = process.env.ASHLEY_MODEL_FABRIC_CURRENT_PORTFOLIO?.trim();
  if (configured) paths.push(resolve(configured));
  paths.push(join(process.cwd(), "config", "model-fabric", "portfolios", CURRENT_FILENAME));

  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    paths.push(join(cursor, "config", "model-fabric", "portfolios", CURRENT_FILENAME));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return Array.from(new Set(paths));
}

function sourcePath(): string {
  const path = candidatePortfolioPaths().find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(`model_fabric_current_portfolio_missing:${CURRENT_FILENAME}`);
  }
  return path;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`model_fabric_current_portfolio_invalid:${field}`);
  }
  return value;
}

function parsePortfolio(path: string): ModelFabricPortfolio {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  if (raw.schema !== "ashley.model_fabric.portfolio_revision.v1") {
    throw new Error("model_fabric_current_portfolio_schema_invalid");
  }
  if (raw.kind !== "current_compatibility" || raw.status !== "declared") {
    throw new Error("model_fabric_current_portfolio_kind_invalid");
  }
  if (raw.incompleteFixture === true) {
    throw new Error("model_fabric_current_portfolio_incomplete");
  }
  const rows = raw.rows;
  const routeBindings = raw.routeBindings;
  if (!Array.isArray(rows) || !routeBindings || typeof routeBindings !== "object") {
    throw new Error("model_fabric_current_portfolio_rows_invalid");
  }
  const normalizedRows = rows.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("model_fabric_current_policy_row_invalid");
    }
    const row = candidate as Record<string, unknown>;
    const occupants = row.occupants;
    if (!Array.isArray(occupants) || occupants.length === 0) {
      throw new Error(`model_fabric_current_policy_row_occupants_invalid:${String(row.policyRowId)}`);
    }
    const normalizedOccupants = occupants.map((occupant) => {
      if (!occupant || typeof occupant !== "object") {
        throw new Error("model_fabric_current_occupant_invalid");
      }
      return occupant as ModelFabricOccupant;
    });
    const normalized = {
      ...row,
      policyRowId: stringValue(row.policyRowId, "policyRowId"),
      portfolioRevisionId: stringValue(row.portfolioRevisionId, "portfolioRevisionId"),
      logicalRole: stringValue(row.logicalRole, "logicalRole") as LogicalModelRole,
      occupancyKey: stringValue(row.occupancyKey, "occupancyKey"),
      seat: (row.seat as string | null | undefined) ?? null,
      purposes: (row.purposes as ModelPurposeId[] | undefined) ?? [],
      quotaCouplingIds: (row.quotaCouplingIds as string[] | undefined) ?? [],
      unorderedCandidates: (row.unorderedCandidates as ModelFabricOccupant[] | undefined) ?? [],
      occupants: normalizedOccupants,
    } as unknown as ModelFabricPolicyRow;
    return freezeDeep(normalized);
  });
  const normalizedBindings: Record<string, CurrentRouteRecordInput> = {};
  for (const [route, value] of Object.entries(routeBindings)) {
    if (!value || typeof value !== "object") {
      throw new Error(`model_fabric_current_route_invalid:${route}`);
    }
    const binding = value as Record<string, unknown>;
    normalizedBindings[route] = {
      provider: stringValue(binding.provider, `${route}.provider`),
      configuredModelId: stringValue(binding.configuredModelId, `${route}.configuredModelId`),
      contextProfile: stringValue(binding.contextProfile, `${route}.contextProfile`),
      enabled: binding.enabled === true,
      quotaContract: binding.quotaContract as PortfolioQuotaContract,
    };
  }
  const registryVersion = `sha256:${sha256(raw)}` as `sha256:${string}`;
  return freezeDeep({
    schema: raw.schema,
    portfolioRevisionId: stringValue(raw.portfolioRevisionId, "portfolioRevisionId"),
    kind: "current_compatibility",
    status: "declared",
    replacesPortfolioRevisionId: (raw.replacesPortfolioRevisionId as string | null | undefined) ?? null,
    notes: stringValue(raw.notes, "notes"),
    routeBindings: normalizedBindings,
    rows: normalizedRows,
    registryVersion,
    sourcePath: path,
    ...(raw.incompleteFixture === true ? { incompleteFixture: true } : {}),
  });
}

export function currentPortfolio(): ModelFabricPortfolio {
  if (!cachedCurrent) cachedCurrent = parsePortfolio(sourcePath());
  return cachedCurrent;
}

export function resetCurrentPortfolioForTests(): void {
  cachedCurrent = null;
}

export function routeRecordsFromCurrentPortfolio(): CurrentRouteRecord[] {
  return Object.entries(currentPortfolio().routeBindings).map(([route, binding]) => ({
    route,
    ...binding,
  }));
}

export function occupancyKeyFor(input: CurrentPolicyResolutionInput): string {
  if (input.logicalRole === "thought") {
    return input.lane === "interactive" || input.lane === "urgent_grounded" || input.deadlineAtMs != null
      ? "interactive"
      : "durable_proactive";
  }
  if (input.logicalRole === "engineering") return "direct_cognition";
  return "default";
}

export function defaultRouteForRow(row: ModelFabricPolicyRow): string {
  if (row.configuredRouteId) return row.configuredRouteId;
  switch (row.logicalRole) {
    case "thought":
      return "thought";
    case "expression":
      return "ashley_expression";
    case "thought_observation":
    case "reflection_initiative":
      return row.dispatchedRouteId ?? "thought";
    case "engineering":
      return "ashley_expression";
    default:
      return "utility_bulk";
  }
}

export function resolveCurrentPolicy(
  input: CurrentPolicyResolutionInput,
): CurrentPolicyResolution {
  const portfolio = currentPortfolio();
  const occupancyKey = occupancyKeyFor(input);
  const row = portfolio.rows.find(
    (candidate) =>
      candidate.logicalRole === input.logicalRole &&
      candidate.occupancyKey === occupancyKey,
  );
  if (!row) {
    throw new Error(`model_fabric_current_policy_row_missing:${input.logicalRole}:${occupancyKey}`);
  }
  const configuredRouteId = row.configuredRouteId ?? defaultRouteForRow(row);
  const defaultDispatchedRouteId = row.dispatchedRouteId ?? configuredRouteId;
  const dispatchedRouteId = input.routeId ?? defaultDispatchedRouteId;
  const routeBinding = portfolio.routeBindings[dispatchedRouteId];
  const configuredBinding = portfolio.routeBindings[configuredRouteId];
  if (!routeBinding || !configuredBinding) {
    throw new Error(`model_fabric_current_route_binding_missing:${dispatchedRouteId}`);
  }
  const occupant =
    row.occupants.find((candidate) => candidate.provider === routeBinding.provider) ??
    row.occupants[0]!;
  return freezeDeep({
    registryVersion: portfolio.registryVersion,
    portfolioRevisionId: portfolio.portfolioRevisionId,
    policyRow: row,
    occupant,
    specialistRequirement: input.specialistRequirement ?? null,
    configuredRouteId,
    dispatchedRouteId,
    configuredModelId:
      input.model ??
      (input.routeId
        ? routeBinding.configuredModelId
        : occupant.configuredModelId ?? routeBinding.configuredModelId),
    routeOverride: input.routeId ?? null,
    modelOverride: input.model ?? null,
  });
}
