import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { deriveContextRoute } from "./eligibility.js";
import type {
  ContextBudgetPlan,
  ContextBudgetPolicy,
  ContextInputCandidate,
  ContextRequest,
  ContextSelectionDecision,
  EligibleInputRef,
} from "./types.js";

const DEFAULT_POLICY: ContextBudgetPolicy = {
  policyId: "c2-default",
  version: 1,
  totalUtf8Bytes: 12_000,
  sectionBudgets: {
    safety: 4_000,
    constitutional_safety: 4_000,
    identity: 1_800,
    mind_state: 1_200,
    interaction: 2_500,
    evidence: 6_000,
    counterevidence: 1_800,
    instructions: 1_400,
    operational: 1_800,
    history: 3_000,
  },
  tokenEstimateDivisor: 4,
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function asPositiveInteger(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`context_${name}_invalid`);
  }
  return number;
}

function parsePolicyRow(row: Record<string, unknown> | undefined): ContextBudgetPolicy | null {
  if (!row) return null;
  let sectionBudgets: Record<string, number>;
  try {
    const parsed: unknown = JSON.parse(String(row.section_json ?? "{}"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    sectionBudgets = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, Number(value)]),
    );
  } catch {
    return null;
  }
  return {
    policyId: String(row.policy_id ?? ""),
    version: Number(row.version ?? 0),
    totalUtf8Bytes: Number(row.total_utf8_bytes ?? 0),
    sectionBudgets,
    tokenEstimateDivisor: Number(row.token_estimate_divisor ?? 0),
    createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
  };
}

export function loadContextBudgetPolicy(
  db: DatabaseSync,
  policyId = DEFAULT_POLICY.policyId,
  version = DEFAULT_POLICY.version,
): ContextBudgetPolicy | null {
  try {
    return parsePolicyRow(db.prepare(
      `SELECT policy_id, version, total_utf8_bytes, section_json,
              token_estimate_divisor, created_at
       FROM context_budget_policies
       WHERE policy_id = ? AND version = ?`,
    ).get(policyId, version) as Record<string, unknown> | undefined);
  } catch {
    return null;
  }
}

export function ensureContextBudgetPolicy(
  db: DatabaseSync,
  input: Partial<ContextBudgetPolicy> = {},
): ContextBudgetPolicy {
  const policy: ContextBudgetPolicy = {
    policyId: input.policyId ?? DEFAULT_POLICY.policyId,
    version: input.version ?? DEFAULT_POLICY.version,
    totalUtf8Bytes: input.totalUtf8Bytes ?? DEFAULT_POLICY.totalUtf8Bytes,
    sectionBudgets: input.sectionBudgets ?? DEFAULT_POLICY.sectionBudgets,
    tokenEstimateDivisor: input.tokenEstimateDivisor ?? DEFAULT_POLICY.tokenEstimateDivisor,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  if (!policy.policyId.trim()) throw new Error("context_policy_id_required");
  asPositiveInteger(policy.version, "policy_version");
  asPositiveInteger(policy.totalUtf8Bytes, "policy_total_utf8_bytes");
  asPositiveInteger(policy.tokenEstimateDivisor, "policy_token_estimate_divisor");
  for (const [section, value] of Object.entries(policy.sectionBudgets)) {
    if (!section.trim() || !Number.isInteger(value) || value < 0 || value > policy.totalUtf8Bytes) {
      throw new Error(`context_section_budget_invalid:${section}`);
    }
  }
  db.prepare(
    `INSERT OR IGNORE INTO context_budget_policies
       (policy_id, version, total_utf8_bytes, section_json,
        token_estimate_divisor, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    policy.policyId,
    policy.version,
    policy.totalUtf8Bytes,
    json(policy.sectionBudgets),
    policy.tokenEstimateDivisor,
    policy.createdAt ?? new Date().toISOString(),
  );
  return loadContextBudgetPolicy(db, policy.policyId, policy.version) ?? policy;
}

function effectivePolicy(
  request: ContextRequest,
  policy?: ContextBudgetPolicy,
): ContextBudgetPolicy {
  const total = request.maxUtf8Bytes ?? request.totalUtf8Bytes ??
    policy?.totalUtf8Bytes ?? DEFAULT_POLICY.totalUtf8Bytes;
  const sectionBudgets = request.sectionBudgets ?? policy?.sectionBudgets ??
    DEFAULT_POLICY.sectionBudgets;
  const selected: ContextBudgetPolicy = {
    policyId: request.policyId ?? policy?.policyId ?? DEFAULT_POLICY.policyId,
    version: request.policyVersion ?? policy?.version ?? DEFAULT_POLICY.version,
    totalUtf8Bytes: total,
    sectionBudgets: { ...sectionBudgets },
    tokenEstimateDivisor: request.tokenEstimateDivisor ??
      policy?.tokenEstimateDivisor ?? DEFAULT_POLICY.tokenEstimateDivisor,
    createdAt: policy?.createdAt,
  };
  asPositiveInteger(selected.totalUtf8Bytes, "budget_total_utf8_bytes");
  asPositiveInteger(selected.version, "budget_policy_version");
  asPositiveInteger(selected.tokenEstimateDivisor, "budget_token_estimate_divisor");
  for (const [section, value] of Object.entries(selected.sectionBudgets)) {
    if (!section.trim() || !Number.isInteger(value) || value < 0 || value > selected.totalUtf8Bytes) {
      throw new Error(`context_section_budget_invalid:${section}`);
    }
  }
  return selected;
}

export function planBudget(
  request: ContextRequest,
  eligible: EligibleInputRef[],
  policy?: ContextBudgetPolicy,
): ContextBudgetPlan {
  const route = deriveContextRoute(request);
  const selectedPolicy = effectivePolicy(request, policy);
  const requestId = request.requestId?.trim() || randomUUID();
  const requiredSections = [...new Set([
    ...(request.requiredSections ?? []),
    ...eligible.filter((input) => input.required).map((input) => input.section),
  ])];
  for (const section of request.requiredSections ?? []) {
    if (!eligible.some((input) => input.section === section)) {
      throw new Error(`context_required_section_unavailable:${section}`);
    }
  }
  const requiredBytesBySection = new Map<string, number>();
  for (const input of eligible.filter((item) => item.required)) {
    requiredBytesBySection.set(
      input.section,
      (requiredBytesBySection.get(input.section) ?? 0) + bytes(input.content),
    );
  }
  let requiredTotal = 0;
  for (const [section, sectionBytes] of requiredBytesBySection) {
    const sectionLimit = selectedPolicy.sectionBudgets[section] ?? selectedPolicy.totalUtf8Bytes;
    if (sectionBytes > sectionLimit) throw new Error("context_required_minimum_overflow");
    requiredTotal += sectionBytes;
  }
  if (requiredTotal > selectedPolicy.totalUtf8Bytes) {
    throw new Error("context_required_minimum_overflow");
  }
  return {
    requestId,
    policyId: selectedPolicy.policyId,
    policyVersion: selectedPolicy.version,
    totalUtf8Bytes: selectedPolicy.totalUtf8Bytes,
    sectionBudgets: selectedPolicy.sectionBudgets,
    tokenEstimateDivisor: selectedPolicy.tokenEstimateDivisor,
    maxEstimatedTokens: Math.ceil(selectedPolicy.totalUtf8Bytes / selectedPolicy.tokenEstimateDivisor),
    requiredSections,
    route,
    snapshotId: request.snapshotId ?? `snapshot:${requestId}`,
  };
}

export function selectContextInputs(
  plan: ContextBudgetPlan,
  eligible: EligibleInputRef[],
): ContextSelectionDecision {
  const required = eligible.filter((input) => input.required);
  const optional = eligible
    .filter((input) => !input.required)
    .map((input, index) => ({ input, index }))
    .sort((left, right) => right.input.priority - left.input.priority || left.index - right.index)
    .map(({ input }) => input);
  const included: EligibleInputRef[] = [];
  const omitted: ContextSelectionDecision["omitted"] = [];
  const includedBytesBySection = new Map<string, number>();
  let includedUtf8Bytes = 0;

  const consider = (input: EligibleInputRef): void => {
    const inputBytes = bytes(input.content);
    const sectionLimit = plan.sectionBudgets[input.section] ?? plan.totalUtf8Bytes;
    const sectionUsed = includedBytesBySection.get(input.section) ?? 0;
    if (
      sectionUsed + inputBytes > sectionLimit ||
      includedUtf8Bytes + inputBytes > plan.totalUtf8Bytes
    ) {
      if (input.required) throw new Error("context_required_minimum_overflow");
      omitted.push({
        ref: input.ref,
        section: input.section,
        omitReason: "budget_omission",
        bytes: inputBytes,
      });
      return;
    }
    included.push(input);
    includedBytesBySection.set(input.section, sectionUsed + inputBytes);
    includedUtf8Bytes += inputBytes;
  };

  for (const input of required) consider(input);
  for (const input of optional) consider(input);
  return {
    included,
    omitted,
    truncated: [],
    compressed: [],
    degradation: omitted.length > 0 ? ["budget_omission"] : [],
    includedUtf8Bytes,
    estimatedTokens: Math.ceil(includedUtf8Bytes / plan.tokenEstimateDivisor),
  };
}
