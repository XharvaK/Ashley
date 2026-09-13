import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { REPO_CONFIG_PATH } from "../../paths.js";
import type { CognitionMode } from "../types.js";
import {
  DECLARED_CONTRACT_ID,
  MODEL_SENSITIVE_SET_FOR_CONTRACT,
} from "../attention/contract-material.js";
import {
  contractMismatch,
  contractMismatchReadOnly,
  ensureBootstrapContract,
} from "../attention/ledger.js";
import { currentModelEpoch } from "../attention/continuity.js";
import {
  beginImmediateIfNeeded,
  recallPromotionQualification,
  recordRecallIsolatedEvaluation,
  recordRecallLiveShadowEvent,
} from "./recall-qualification-epoch.js";
import {
  getCurrentMemoryEvidenceQualificationEpoch,
  getMemoryEvidenceQualificationReadiness,
  sealMemoryEvidenceQualificationEpoch,
} from "./memory-evidence-qualification-epoch.js";

export const capabilityNames = [
  "recall",
  "mind_state",
  "affect",
  "thought",
  "learning",
  "refusal",
  "relational_initiative",
  "relationship_state",
  "reading",
  "curiosity_consolidation",
  "source_discovery",
  "own_time_report",
  "vision",
  "attachment_text",
  "conversational_read",
  "web_search",
  "external_observe",
  "external_prepare",
  "external_private",
  "external_public",
  "project_inspection",
  "project_experimentation",
  "candidate_verification",
  "candidate_authorship",
  "bounded_operation",
  "patch_export",
  "memory_evidence",
  "context_budget",
  "learned_autonomy",
  "cognitive_graduation",
  "relational_graduation",
] as const;

export type CapabilityName = typeof capabilityNames[number];
export type CapabilityState = "observe" | "active" | "rolled_back" | "disabled";
export type CapabilityEventKind =
  | "isolated_eval"
  | "live_shadow"
  | "behavioral_breach"
  | "critical_failure"
  | "operator_promote"
  | "operator_rollback"
  | "operator_cutover";

/**
 * Capability graduation policy — wave M3.
 *
 * ONE global eligibility policy cannot honestly serve every capability
 * because capability effect semantics differ:
 *
 *  - `live_shadow` capabilities can accrue runtime-observed shadow evidence
 *    while observe-only (their operations execute read-only in shadow mode),
 *    so promotion legitimately requires live-shadow volume and span.
 *  - `operator_cutover` capabilities are effectful/border capabilities whose
 *    defining operation must NOT execute while observe-only. For those, the
 *    operation itself can never produce live_shadow evidence, so requiring it
 *    would make observe → active promotion structurally impossible. Their
 *    graduation path is: owner-attested qualification (evaluation evidence
 *    recorded through the canonical owner endpoint) → explicit owner
 *    promotion → durable audited cutover.
 *
 * The policy is a declaration, like `dependencies`. It is NOT persisted state
 * and does NOT bypass eligibility: every policy still requires eval seeds,
 * qualification, dependency readiness, and valid release/contract state.
 */
export type CapabilityGraduationPolicy =
  | {
      kind: "live_shadow";
      minEvalSeeds: number;
      minLiveShadowEvents: number;
      minLiveShadowSpanDays: number;
      requiresQualification: boolean;
    }
  | {
      kind: "operator_cutover";
      minEvalSeeds: number;
      requiresQualification: boolean;
    };

/** Default policy: exact historical live-shadow graduation semantics. */
const DEFAULT_GRADUATION_POLICY: CapabilityGraduationPolicy = {
  kind: "live_shadow",
  minEvalSeeds: 3,
  minLiveShadowEvents: 25,
  minLiveShadowSpanDays: 7,
  requiresQualification: true,
};

/** Per-capability graduation policy declarations (default applies otherwise). */
const GRADUATION_POLICIES: Partial<
  Record<CapabilityName, CapabilityGraduationPolicy>
> = {
  project_experimentation: {
    kind: "operator_cutover",
    minEvalSeeds: 3,
    requiresQualification: true,
  },
  candidate_verification: {
    kind: "operator_cutover",
    minEvalSeeds: 3,
    requiresQualification: true,
  },
  candidate_authorship: {
    kind: "operator_cutover",
    minEvalSeeds: 3,
    requiresQualification: true,
  },
  bounded_operation: {
    kind: "operator_cutover",
    minEvalSeeds: 3,
    requiresQualification: true,
  },
  patch_export: {
    kind: "operator_cutover",
    minEvalSeeds: 3,
    requiresQualification: true,
  },
};

export function graduationPolicyFor(
  capability: CapabilityName,
): CapabilityGraduationPolicy {
  return GRADUATION_POLICIES[capability] ?? DEFAULT_GRADUATION_POLICY;
}

const dependencies: Record<CapabilityName, CapabilityName[]> = {
  recall: [],
  mind_state: ["recall"],
  affect: ["recall"],
  thought: ["recall", "mind_state"],
  learning: ["recall"],
  refusal: ["thought"],
  relational_initiative: ["mind_state", "thought"],
  relationship_state: ["mind_state", "thought"],
  reading: [],
  curiosity_consolidation: ["reading"],
  source_discovery: ["reading"],
  own_time_report: ["thought", "curiosity_consolidation"],
  vision: ["thought"],
  attachment_text: ["thought"],
  conversational_read: ["reading", "thought"],
  web_search: ["thought"],
  external_observe: ["thought"],
  external_prepare: ["external_observe"],
  external_private: ["external_prepare", "thought"],
  external_public: ["external_prepare", "thought"],
  project_inspection: ["thought"],
  project_experimentation: ["thought"],
  candidate_verification: ["thought"],
  candidate_authorship: ["thought"],
  bounded_operation: ["thought"],
  patch_export: ["thought"],
  memory_evidence: ["recall"],
  context_budget: ["memory_evidence"],
  learned_autonomy: ["memory_evidence"],
  cognitive_graduation: ["memory_evidence", "learned_autonomy"],
  relational_graduation: ["memory_evidence", "relationship_state"],
};

const modelSensitive = new Set<string>(MODEL_SENSITIVE_SET_FOR_CONTRACT);

export type CapabilityStatus = {
  capability: CapabilityName;
  releaseId: string;
  contractId: string;
  buildIdentity: string;
  modelEpoch: number;
  state: CapabilityState;
  effective: boolean;
  graduationPolicy: CapabilityGraduationPolicy["kind"];
  dependencies: CapabilityName[];
  dependenciesReady: boolean;
  shadowExecutable: boolean;
  shadowDependenciesReady: boolean;
  influenceDependenciesReady: boolean;
  evalSeedCount: number;
  qualifiedAt: string | null;
  promotionEligible: boolean;
  liveShadowEvents: number;
  liveShadowSpanDays: number;
  /** Recall only: the current qualification epoch (null for non-Recall and when none exists). */
  qualificationEpochId: string | null;
  behavioralBreachesSevenDays: number;
  promotedAt: string | null;
  rolledBackAt: string | null;
  failureKind: string | null;
  failureReason: string | null;
  contractMismatch: boolean;
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function readGitRelease(): string {
  try {
    const repoRoot = resolve(REPO_CONFIG_PATH, "..");
    const dotGit = join(repoRoot, ".git");
    let gitDir = dotGit;
    try {
      const marker = readFileSync(dotGit, "utf8").trim();
      const match = marker.match(/^gitdir:\s*(.+)$/i);
      if (match?.[1]) gitDir = resolve(repoRoot, match[1]);
    } catch {
      // A normal checkout stores .git as a directory.
    }
    const gitDirs = [gitDir];
    try {
      const commonDirMarker = readFileSync(join(gitDir, "commondir"), "utf8").trim();
      if (commonDirMarker) {
        const commonDir = isAbsolute(commonDirMarker)
          ? commonDirMarker
          : resolve(gitDir, commonDirMarker);
        if (commonDir !== gitDir) gitDirs.push(commonDir);
      }
    } catch {
      // A normal checkout has no separate worktree common directory.
    }
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 40);
    const ref = head.slice(5);
    for (const candidateGitDir of gitDirs) {
      try {
        return readFileSync(join(candidateGitDir, ref), "utf8").trim().slice(0, 40);
      } catch {
        try {
          const packed = readFileSync(join(candidateGitDir, "packed-refs"), "utf8")
            .split(/\r?\n/)
            .find((line) => !line.startsWith("#") && !line.startsWith("^") && line.endsWith(` ${ref}`));
          if (packed) return packed.split(" ")[0]?.slice(0, 40) || "unversioned";
        } catch {
          // Try the next Git directory in a linked worktree.
        }
      }
    }
    return "unversioned";
  } catch {
    return "unversioned";
  }
}

function normalizeQualificationSha(value: string, invalidCode: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    const error = new Error(invalidCode) as Error & { code: string };
    error.code = invalidCode;
    throw error;
  }
  return normalized;
}

/** The checkout-derived identity used by isolated candidate qualification. */
export function qualificationCheckoutIdentity(): string {
  return readGitRelease();
}

/**
 * Resolve candidate identity without allowing credentials or a production
 * environment's release label to stand in for the checked-out source.
 *
 * An empty qualification release label is allowed because credentials may be
 * inherited without an identity label. A non-empty label must agree exactly.
 */
export function resolveQualificationBuildIdentity(input: {
  expectedCandidateSha: string;
  actualCheckoutIdentity: string;
  qualificationReleaseIdentity: string;
}): string {
  const expected = normalizeQualificationSha(
    input.expectedCandidateSha,
    "qualification_candidate_sha_invalid",
  );
  const actual = normalizeQualificationSha(
    input.actualCheckoutIdentity,
    "qualification_checkout_identity_invalid",
  );
  if (actual !== expected) {
    const error = new Error("qualification_checkout_identity_mismatch") as Error & { code: string };
    error.code = "qualification_checkout_identity_mismatch";
    throw error;
  }

  const release = input.qualificationReleaseIdentity.trim();
  if (release.length > 0) {
    const normalizedRelease = normalizeQualificationSha(
      release,
      "qualification_release_identity_invalid",
    );
    if (normalizedRelease !== expected) {
      const error = new Error("qualification_release_identity_mismatch") as Error & { code: string };
      error.code = "qualification_release_identity_mismatch";
      throw error;
    }
  }
  return expected;
}

/** Observability only — never keys capability evidence. */
export function currentBuildIdentity(): string {
  return env.ashleyReleaseId.trim() || readGitRelease();
}

/** @deprecated Prefer currentContractId — kept for call-site compatibility. */
export function currentReleaseId(): string {
  return currentContractId();
}

export function currentContractId(): string {
  return DECLARED_CONTRACT_ID;
}

function ensureRelease(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId: string,
): void {
  ensureBootstrapContract(db);
  const build = currentBuildIdentity();
  db.prepare(
    `INSERT OR IGNORE INTO capability_releases
       (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'observe', ?, ?, ?, 0)`,
  ).run(
    capability,
    releaseId,
    new Date().toISOString(),
    currentContractId(),
    build,
  );
}

function releaseState(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId: string,
): CapabilityState {
  ensureRelease(db, capability, releaseId);
  const value = db.prepare(
    `SELECT state FROM capability_releases
     WHERE capability = ? AND release_id = ?`,
  ).get(capability, releaseId);
  if (!isRow(value)) return "observe";
  switch (value.state) {
    case "active":
    case "rolled_back":
    case "disabled":
      return value.state;
    default:
      return "observe";
  }
}

/**
 * Wave 3 — shadow vs. live influence dependency readiness.
 *
 * Previously a single `dependenciesReady` conflated two concerns:
 *   - "can dependencies participate in shadow execution?"
 *   - "do dependencies have behavioral influence authority?"
 *
 * `influenceDependenciesReady` preserves the existing active-state check
 * used by promotionEligible / capabilityCanInfluence (live influence).
 *
 * `canExecuteShadowInternal` + `shadowDependenciesReady` answer whether a
 * capability / dependency chain is permitted to run in observe shadow mode.
 */

/** Private: does this release's own state permit shadow execution? */
function canExecuteShadowInternal(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId: string,
): boolean {
  if (contractMismatch(db)) return false;
  return releaseState(db, capability, releaseId) !== "rolled_back" &&
    releaseState(db, capability, releaseId) !== "disabled";
}

/** Exported Wave 3 predicate: pure / read-only. */
export function capabilityCanExecuteShadow(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId = currentReleaseId(),
): boolean {
  return canExecuteShadowInternal(db, capability, releaseId);
}

/**
 * Exported Wave 3 predicate: pure / read-only.
 * True when every dependency in the transitive closure can participate
 * in shadow execution (observe or active, not rolled_back/disabled).
 */
export function capabilityShadowDependenciesReady(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId = currentReleaseId(),
): boolean {
  return dependencies[capability].every(
    (dependency) =>
      canExecuteShadowInternal(db, dependency, releaseId) &&
      capabilityShadowDependenciesReady(db, dependency, releaseId),
  );
}

/**
 * Exported Wave 3 predicate: pure / read-only.
 * True when every direct dependency is `active` — the LIVE influence
 * dependency chain. Preserves Wave 1/2 semantics used by
 * `capabilityCanInfluence` and `promotionEligible`.
 */
export function capabilityInfluenceDependenciesReady(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId = currentReleaseId(),
): boolean {
  return dependencies[capability].every(
    (dependency) => releaseState(db, dependency, releaseId) === "active",
  );
}

function eventWindow(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId: string,
  kind: CapabilityEventKind,
  cutoff?: string,
  modelEpoch?: number | null,
): { count: number; first: string | null; last: string | null } {
  const value = db.prepare(
    `SELECT COUNT(*) AS count, MIN(occurred_at) AS first,
            MAX(occurred_at) AS last
     FROM capability_events
     WHERE capability = ? AND release_id = ? AND kind = ?
       AND (? IS NULL OR occurred_at >= ?)
       AND (? IS NULL OR model_epoch = ?)`,
  ).get(
    capability,
    releaseId,
    kind,
    cutoff ?? null,
    cutoff ?? null,
    modelEpoch ?? null,
    modelEpoch ?? null,
  );
  return isRow(value)
    ? {
        count: Number(value.count ?? 0),
        first: typeof value.first === "string" ? value.first : null,
        last: typeof value.last === "string" ? value.last : null,
      }
    : { count: 0, first: null, last: null };
}

function liveSpanDays(window: { first: string | null; last: string | null }): number {
  if (!window.first || !window.last) return 0;
  return Math.max(
    0,
    (Date.parse(window.last) - Date.parse(window.first)) / 86_400_000,
  );
}

/**
 * Pure eligibility evaluation for an observe release. Never mutates state:
 * qualification evidence and live-shadow evidence are only consulted, and
 * activation happens exclusively through `promoteCapability`.
 *
 * Eligibility is graduation-policy driven: the capability's declared policy
 * determines which evidence classes promotion requires. Default
 * (`live_shadow`) preserves the historical semantics exactly; capabilities
 * declared `operator_cutover` require the same qualification evidence but no
 * live-shadow volume, because their defining operation cannot legitimately
 * run while observe-only.
 */
export function promotionEligible(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId = currentReleaseId(),
): boolean {
  if (contractMismatch(db)) return false;
  ensureRelease(db, capability, releaseId);
  if (releaseState(db, capability, releaseId) !== "observe") return false;
  if (capability === "recall") {
    return recallPromotionQualified(db, releaseId);
  }
  if (capability === "memory_evidence") {
    if (releaseId !== currentContractId()) return false;
    const epoch = getCurrentMemoryEvidenceQualificationEpoch(db);
    return epoch !== null && getMemoryEvidenceQualificationReadiness(
      db,
      epoch.ownerId,
    ).eligible;
  }
  const policy = graduationPolicyFor(capability);
  const release = db.prepare(
    `SELECT eval_seed_count, qualified_at, model_epoch FROM capability_releases
     WHERE capability = ? AND release_id = ?`,
  ).get(capability, releaseId);
  if (
    !isRow(release) ||
    Number(release.eval_seed_count ?? 0) < policy.minEvalSeeds ||
    (policy.requiresQualification && typeof release.qualified_at !== "string")
  ) {
    return false;
  }
  const epoch = currentModelEpoch(db, env.mistralModel);
  if (
    modelSensitive.has(capability) &&
    epoch > 0 &&
    Number(release.model_epoch ?? 0) !== epoch
  ) {
    return false;
  }
  if (policy.kind === "live_shadow") {
    const live = eventWindow(
      db,
      capability,
      releaseId,
      "live_shadow",
      undefined,
      modelSensitive.has(capability) ? epoch : null,
    );
    if (
      live.count < policy.minLiveShadowEvents ||
      liveSpanDays(live) < policy.minLiveShadowSpanDays
    ) {
      return false;
    }
  }
  return capabilityInfluenceDependenciesReady(db, capability, releaseId);
}

/**
 * Recall promotion qualification: authority preconditions are checked by
 * `promotionEligible`; this applies the CURRENT qualification epoch
 * thresholds (seeds >= 3, qualified_at, live_shadow >= 25, span >= 7 days)
 * against the epoch registry.
 *
 * Fail closed: no current epoch means FALSE, and historical v3 authority-row
 * metadata (`capability_releases.eval_seed_count` / `qualified_at`) and old
 * `capability_events` campaign evidence are never consulted. That v3 metadata
 * is intentionally left untouched as legacy rollout history.
 */
function recallPromotionQualified(
  db: DatabaseSync,
  releaseId: string,
): boolean {
  const qualification = recallPromotionQualification(db);
  if (!qualification) return false;
  if (qualification.evalSeedCount < 3) return false;
  if (typeof qualification.qualifiedAt !== "string") return false;
  if (qualification.liveShadowEvents < 25) return false;
  if (qualification.liveShadowSpanDays < 7) return false;
  return capabilityInfluenceDependenciesReady(db, "recall", releaseId);
}

export type PromoteCapabilityResult =
  | { ok: true; alreadyActive?: boolean; state: "active" }
  | {
      ok: false;
      reason: "contract_mismatch" | "authorization_required" | "not_eligible" | "rolled_back" | "disabled";
    };

/**
 * Explicit observe → active promotion. Authorized callers only; the
 * authorized-by identity is recorded in the `operator_promote` audit event.
 * Re-evaluates eligibility at invocation time and fails closed on
 * ineligible, rolled-back, or disabled releases without any state change or
 * event. Idempotent for releases already active.
 */
export function promoteCapability(
  db: DatabaseSync,
  capability: CapabilityName,
  input: { authorizedBy: string; releaseId?: string },
): PromoteCapabilityResult {
  const releaseId = input.releaseId ?? currentReleaseId();
  const authorizedBy = input.authorizedBy.trim();
  if (!authorizedBy) {
    return { ok: false, reason: "authorization_required" };
  }
  ensureRelease(db, capability, releaseId);
  if (contractMismatch(db)) {
    return { ok: false, reason: "contract_mismatch" };
  }
  const state = releaseState(db, capability, releaseId);
  if (state === "active") {
    return { ok: true, alreadyActive: true, state };
  }
  if (state === "rolled_back" || state === "disabled") {
    return { ok: false, reason: state };
  }
  if (!promotionEligible(db, capability, releaseId)) {
    return { ok: false, reason: "not_eligible" };
  }
  if (capability === "memory_evidence") {
    const epoch = getCurrentMemoryEvidenceQualificationEpoch(db);
    if (!epoch || epoch.ownerId !== authorizedBy || releaseId !== currentContractId()) {
      return { ok: false, reason: "not_eligible" };
    }
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    let transactionOpen = true;
    try {
      const sealed = sealMemoryEvidenceQualificationEpoch(db, {
        ownerId: authorizedBy,
        epochId: epoch.epochId,
        releaseId,
        sealedAt: now,
      });
      if (!sealed) throw new Error("memory_evidence_epoch_seal_failed");
      const updated = db.prepare(
        `UPDATE capability_releases
         SET state = 'active', promoted_at = ?, failure_kind = NULL,
             failure_reason = NULL, updated_at = ?, model_epoch = 0
         WHERE capability = 'memory_evidence' AND release_id = ? AND state = 'observe'`,
      ).run(now, now, releaseId);
      if (Number(updated.changes) !== 1) {
        throw new Error("memory_evidence_release_state_changed");
      }
      const recorded = recordEvent(db, {
        capability,
        releaseId,
        kind: "operator_promote",
        sourceKey: `promote:${now}`,
        detail: {
          authorizedBy: authorizedBy.slice(0, 200),
          promotionPath: graduationPolicyFor(capability).kind,
          qualificationEpochId: epoch.epochId,
        },
        occurredAt: now,
      });
      if (!recorded) throw new Error("memory_evidence_operator_promote_not_recorded");
      db.exec("COMMIT");
      transactionOpen = false;
      return { ok: true, state: "active" };
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* preserve the original failure */
        }
      }
      throw error;
    }
  }
  const now = new Date().toISOString();
  const epoch = modelSensitive.has(capability)
    ? currentModelEpoch(db, env.mistralModel)
    : 0;
  db.prepare(
    `UPDATE capability_releases
     SET state = 'active', promoted_at = ?, failure_kind = NULL,
         failure_reason = NULL, updated_at = ?, model_epoch = ?
     WHERE capability = ? AND release_id = ? AND state = 'observe'`,
  ).run(now, now, epoch, capability, releaseId);
  recordEvent(db, {
    capability,
    releaseId,
    kind: "operator_promote",
    sourceKey: `promote:${now}`,
    detail: {
      authorizedBy: authorizedBy.slice(0, 200),
      promotionPath: graduationPolicyFor(capability).kind,
    },
    occurredAt: now,
  });
  return { ok: true, state: "active" };
}

function recordEvent(
  db: DatabaseSync,
  input: {
    capability: CapabilityName;
    releaseId: string;
    kind: CapabilityEventKind;
    sourceKey: string;
    detail?: Record<string, unknown>;
    occurredAt?: string;
  },
): boolean {
  ensureRelease(db, input.capability, input.releaseId);
  const detail = JSON.stringify(input.detail ?? {}).slice(0, 4000);
  const result = db.prepare(
    `INSERT OR IGNORE INTO capability_events
       (capability, release_id, kind, source_key, detail_json, occurred_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.capability,
    input.releaseId,
    input.kind,
    input.sourceKey.slice(0, 300),
    detail,
    input.occurredAt ?? new Date().toISOString(),
    currentContractId(),
    currentBuildIdentity(),
    modelSensitive.has(input.capability)
      ? currentModelEpoch(db, env.mistralModel)
      : 0,
  );
  return result.changes > 0;
}

export function recordIsolatedEvaluation(
  db: DatabaseSync,
  capability: CapabilityName,
  input: {
    seeds: number;
    passed: boolean;
    sourceKey: string;
    releaseId?: string;
    occurredAt?: string;
  },
): void {
  const releaseId = input.releaseId ?? currentReleaseId();
  const seeds = Math.max(0, Math.trunc(input.seeds));
  if (capability === "memory_evidence") {
    throw new Error("memory_evidence_requires_bound_evaluation");
  }
  if (capability === "recall") {
    // Recall dual-write: the provenance-bearing capability_events row and the
    // epoch-registry mirror converge in ONE transaction, so no failure can
    // split them. capability_events keeps its historical/provenance role
    // (it is written even when no epoch exists and never qualifies anything);
    // the epoch registry is the qualification authority and the v3
    // authority-row metadata is never mutated by new evidence.
    const ownsTransaction = beginImmediateIfNeeded(db);
    try {
      recordEvent(db, {
        capability,
        releaseId,
        kind: "isolated_eval",
        sourceKey: input.sourceKey,
        detail: { seeds, passed: input.passed },
        occurredAt: input.occurredAt,
      });
      recordRecallIsolatedEvaluation(db, {
        seeds,
        passed: input.passed,
        sourceKey: input.sourceKey,
        occurredAt: input.occurredAt,
      });
      if (ownsTransaction) db.exec("COMMIT");
    } catch (error) {
      if (ownsTransaction) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* preserve the original failure */
        }
      }
      throw error;
    }
    return;
  }
  recordEvent(db, {
    capability,
    releaseId,
    kind: "isolated_eval",
    sourceKey: input.sourceKey,
    detail: { seeds, passed: input.passed },
    occurredAt: input.occurredAt,
  });
  if (input.passed && seeds >= 3) {
    const now = input.occurredAt ?? new Date().toISOString();
    const epoch = modelSensitive.has(capability)
      ? currentModelEpoch(db, env.mistralModel)
      : 0;
    db.prepare(
      `UPDATE capability_releases
       SET eval_seed_count = MAX(eval_seed_count, ?), qualified_at = ?,
           model_epoch = ?, updated_at = ?
       WHERE capability = ? AND release_id = ? AND state = 'observe'`,
    ).run(seeds, now, epoch, now, capability, releaseId);
  }
}

export function recordLiveShadowEvent(
  db: DatabaseSync,
  capability: CapabilityName,
  sourceKey: string,
  input: {
    releaseId?: string;
    occurredAt?: string;
    detail?: Record<string, unknown>;
  } = {},
): { recorded: boolean; reason?: "recall_qualification_epoch_unavailable" } {
  const releaseId = input.releaseId ?? currentReleaseId();
  if (capability === "memory_evidence") {
    throw new Error("memory_evidence_requires_semantic_witness");
  }
  if (capability === "recall") {
    // Recall dual-write: provenance ledger row and epoch-registry mirror
    // converge in ONE transaction. The returned result reflects the
    // epoch-scoped idempotency: the same source_key is idempotent within one
    // epoch, independent across epochs, and `recorded: false` with
    // `recall_qualification_epoch_unavailable` when no campaign exists (the
    // provenance row is still the historical record and never qualifies).
    const ownsTransaction = beginImmediateIfNeeded(db);
    try {
      recordEvent(db, {
        capability,
        releaseId,
        kind: "live_shadow",
        sourceKey,
        detail: input.detail,
        occurredAt: input.occurredAt,
      });
      const mirrored = recordRecallLiveShadowEvent(db, sourceKey, input);
      if (ownsTransaction) db.exec("COMMIT");
      if (mirrored.reason) return { recorded: mirrored.recorded, reason: mirrored.reason };
      return { recorded: mirrored.recorded };
    } catch (error) {
      if (ownsTransaction) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* preserve the original failure */
        }
      }
      throw error;
    }
  }
  const recorded = recordEvent(db, {
    capability,
    releaseId,
    kind: "live_shadow",
    sourceKey,
    detail: input.detail,
    occurredAt: input.occurredAt,
  });
  return { recorded };
}

export function recordBehavioralBreach(
  db: DatabaseSync,
  capability: CapabilityName,
  sourceKey: string,
  reason: string,
  input: { releaseId?: string; occurredAt?: string } = {},
): void {
  const releaseId = input.releaseId ?? currentReleaseId();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  recordEvent(db, {
    capability,
    releaseId,
    kind: "behavioral_breach",
    sourceKey,
    detail: { reason: reason.slice(0, 500) },
    occurredAt,
  });
  const cutoff = new Date(Date.parse(occurredAt) - 7 * 86_400_000).toISOString();
  const breaches = eventWindow(
    db,
    capability,
    releaseId,
    "behavioral_breach",
    cutoff,
  );
  if (breaches.count >= 2) {
    db.prepare(
      `UPDATE capability_releases
       SET state = 'rolled_back', rolled_back_at = ?,
           failure_kind = 'behavioral_breach', failure_reason = ?, updated_at = ?
       WHERE capability = ? AND release_id = ?`,
    ).run(occurredAt, reason.slice(0, 500), occurredAt, capability, releaseId);
  }
}

export function recordCriticalFailure(
  db: DatabaseSync,
  capability: CapabilityName,
  sourceKey: string,
  failureKind: "security" | "corruption" | "deletion_integrity" | "provenance",
  reason: string,
  input: { releaseId?: string; occurredAt?: string } = {},
): void {
  const releaseId = input.releaseId ?? currentReleaseId();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  recordEvent(db, {
    capability,
    releaseId,
    kind: "critical_failure",
    sourceKey,
    detail: { failureKind, reason: reason.slice(0, 500) },
    occurredAt,
  });
  db.prepare(
    `UPDATE capability_releases
     SET state = 'disabled', rolled_back_at = ?, failure_kind = ?,
         failure_reason = ?, updated_at = ?
     WHERE capability = ? AND release_id = ?`,
  ).run(
    occurredAt,
    failureKind,
    reason.slice(0, 500),
    occurredAt,
    capability,
    releaseId,
  );
}

export function listCapabilityStatuses(
  db: DatabaseSync,
  masterMode: CognitionMode = env.cognitionMode,
  releaseId = currentReleaseId(),
  now = new Date(),
): CapabilityStatus[] {
  const mismatch = contractMismatch(db);
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const epoch = currentModelEpoch(db, env.mistralModel);
  const build = currentBuildIdentity();
  const memoryEvidenceEpoch = getCurrentMemoryEvidenceQualificationEpoch(db);
  const memoryEvidenceReadiness = memoryEvidenceEpoch
    ? getMemoryEvidenceQualificationReadiness(db, memoryEvidenceEpoch.ownerId, now)
    : null;
  return capabilityNames.map((capability) => {
    ensureRelease(db, capability, releaseId);
    const release = db.prepare(
      `SELECT state, eval_seed_count, qualified_at, promoted_at,
              rolled_back_at, failure_kind, failure_reason, model_epoch
       FROM capability_releases
       WHERE capability = ? AND release_id = ?`,
    ).get(capability, releaseId);
    const state = releaseState(db, capability, releaseId);
    const epochFilter = modelSensitive.has(capability) ? epoch : null;
    const live = eventWindow(
      db,
      capability,
      releaseId,
      "live_shadow",
      undefined,
      epochFilter,
    );
    const breaches = eventWindow(
      db,
      capability,
      releaseId,
      "behavioral_breach",
      cutoff,
    );
    const ready = capabilityInfluenceDependenciesReady(db, capability, releaseId);
    const shadowDepsReady = capabilityShadowDependenciesReady(db, capability, releaseId);
      // Recall status truth comes from the current qualification epoch only.
      // With no current epoch every Recall qualification field is zero/null:
      // historical v3 authority-row metadata is legacy and is never displayed
      // as current campaign evidence.
      const recallQualification =
        capability === "recall" ? recallPromotionQualification(db) : null;
    return {
      capability,
      releaseId,
      contractId: currentContractId(),
      buildIdentity: build,
      modelEpoch: isRow(release) ? Number(release.model_epoch ?? 0) : 0,
      state,
      effective:
        !mismatch &&
        masterMode === "apply" &&
        state === "active" &&
        ready,
      graduationPolicy: graduationPolicyFor(capability).kind,
      dependencies: dependencies[capability],
      dependenciesReady: ready,
      shadowExecutable: canExecuteShadowInternal(db, capability, releaseId),
      shadowDependenciesReady: shadowDepsReady,
      influenceDependenciesReady: ready,
      evalSeedCount: capability === "recall"
        ? recallQualification?.evalSeedCount ?? 0
        : capability === "memory_evidence"
          ? memoryEvidenceReadiness?.evalSeedCount ?? 0
        : isRow(release)
          ? Number(release.eval_seed_count ?? 0)
          : 0,
      qualifiedAt: capability === "recall"
        ? recallQualification?.qualifiedAt ?? null
        : capability === "memory_evidence"
          ? memoryEvidenceReadiness?.qualifiedAt ?? null
        : isRow(release) && typeof release.qualified_at === "string"
          ? release.qualified_at
          : null,
      promotionEligible: promotionEligible(db, capability, releaseId),
      liveShadowEvents: capability === "recall"
        ? recallQualification?.liveShadowEvents ?? 0
        : capability === "memory_evidence"
          ? memoryEvidenceReadiness?.qualifyingCount ?? 0
        : live.count,
      liveShadowSpanDays: capability === "recall"
        ? recallQualification?.liveShadowSpanDays ?? 0
        : capability === "memory_evidence"
          ? memoryEvidenceReadiness?.spanDays ?? 0
        : liveSpanDays(live),
      qualificationEpochId: capability === "recall"
        ? recallQualification?.epochId ?? null
        : capability === "memory_evidence"
          ? memoryEvidenceReadiness?.epochId ?? null
        : null,
      behavioralBreachesSevenDays: breaches.count,
      promotedAt: isRow(release) && typeof release.promoted_at === "string"
        ? release.promoted_at
        : null,
      rolledBackAt: isRow(release) && typeof release.rolled_back_at === "string"
        ? release.rolled_back_at
        : null,
      failureKind: isRow(release) && typeof release.failure_kind === "string"
        ? release.failure_kind
        : null,
      failureReason: isRow(release) && typeof release.failure_reason === "string"
        ? release.failure_reason
        : null,
      contractMismatch: mismatch,
    };
  });
}

export function capabilityCanInfluence(
  db: DatabaseSync,
  capability: CapabilityName,
  masterMode: CognitionMode = env.cognitionMode,
  releaseId = currentReleaseId(),
): boolean {
  if (contractMismatch(db)) return false;
  if (masterMode !== "apply") return false;
  return releaseState(db, capability, releaseId) === "active" &&
    capabilityInfluenceDependenciesReady(db, capability, releaseId);
}

function releaseIsActiveReadOnly(
  db: DatabaseSync,
  capability: CapabilityName,
  releaseId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT state FROM capability_releases
       WHERE capability = ? AND release_id = ?`,
    )
    .get(capability, releaseId) as { state?: string } | undefined;
  return row?.state === "active";
}

/**
 * Read-only live-influence check for owner diagnostics. It never bootstraps
 * capability or contract rows, unlike the legacy runtime predicate.
 */
export function capabilityCanInfluenceReadOnly(
  db: DatabaseSync,
  capability: CapabilityName,
  masterMode: CognitionMode = env.cognitionMode,
  releaseId = currentReleaseId(),
): boolean {
  if (!(capabilityNames as readonly string[]).includes(capability)) {
    return false;
  }
  if (contractMismatchReadOnly(db)) return false;
  if (masterMode !== "apply") return false;
  return releaseIsActiveReadOnly(db, capability, releaseId) &&
    dependencies[capability].every((dependency) =>
      releaseIsActiveReadOnly(db, dependency, releaseId),
    );
}

export function operatorRollbackCapability(
  db: DatabaseSync,
  capability: CapabilityName,
  input: { authorizedBy: string; releaseId?: string },
): { success: boolean; status: string; message: string } {
  const releaseId = input.releaseId ?? currentReleaseId();
  const authorizedBy = input.authorizedBy.trim();
  if (!authorizedBy) {
    return {
      success: false,
      status: "authorization_required",
      message: "authorization required",
    };
  }
  if (contractMismatch(db)) {
    return {
      success: false,
      status: "contract_mismatch",
      message: "contract mismatch",
    };
  }
  const current = releaseState(db, capability, releaseId);
  if (current === "rolled_back") {
    return { success: true, status: "already_rolled_back", message: "capability already rolled back" };
  }
  if (current !== "active") {
    return {
      success: false,
      status: "not_active",
      message: "capability must be active to roll back",
    };
  }

  db.exec("BEGIN IMMEDIATE");
  let transactionOpen = true;
  try {
    const updated = db.prepare(
      `UPDATE capability_releases SET state = 'rolled_back', rolled_back_at = ?, updated_at = ?
       WHERE capability = ? AND release_id = ? AND state = 'active'`,
    ).run(new Date().toISOString(), new Date().toISOString(), capability, releaseId);
    if (updated.changes !== 1) {
      throw new Error("rollback_state_changed");
    }

    const recorded = recordEvent(db, {
      capability,
      releaseId,
      kind: "operator_rollback",
      sourceKey: `operator_rollback:${capability}:${releaseId}`,
      detail: { authorizedBy },
    });
    if (!recorded) {
      throw new Error("operator_rollback_audit_not_recorded");
    }
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original failure */
      }
    }
    throw error;
  }

  return { success: true, status: "rolled_back", message: "capability successfully rolled back" };
}

export type CutoverResult = {
  success: boolean;
  status: "cutover_recorded" | "already_cutover" | "not_active" | "not_observe" | "contract_mismatch";
  cutoffMessageId?: number;
  message: string;
};

/**
 * Freeze the current owner's historical Recall boundary and its audit event
 * in one control-plane transaction.
 */
export function recordRecallLiveCutover(
  db: DatabaseSync,
  ownerId: string,
  input: { authorizedBy: string; masterMode?: string },
): CutoverResult {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) {
    throw new Error("cutover_requires_owner");
  }
  const authorizedBy = input.authorizedBy.trim();
  if (!authorizedBy) {
    throw new Error("cutover_requires_authorization");
  }

  const masterMode = input.masterMode ?? env.cognitionMode;
  const releaseId = currentContractId();

  db.exec("BEGIN IMMEDIATE");
  let transactionOpen = true;
  try {
    if (contractMismatch(db)) {
      db.exec("COMMIT");
      transactionOpen = false;
      return { success: false, status: "contract_mismatch", message: "contract mismatch" };
    }

    const state = releaseState(db, "recall", releaseId);
    if (state !== "active") {
      db.exec("COMMIT");
      transactionOpen = false;
      return { success: false, status: "not_active", message: "recall must be active to record a cutover" };
    }

    if (masterMode !== "observe") {
      db.exec("COMMIT");
      transactionOpen = false;
      return { success: false, status: "not_observe", message: "masterMode must be observe to record a cutover" };
    }

    const existing = db.prepare(
      `SELECT cutoff_message_id
       FROM recall_live_cutovers
       WHERE owner_id = ? AND capability = 'recall' AND release_id = ?`,
    ).get(normalizedOwnerId, releaseId) as { cutoff_message_id: number } | undefined;

    if (existing !== undefined) {
      db.exec("COMMIT");
      transactionOpen = false;
      return {
        success: true,
        status: "already_cutover",
        cutoffMessageId: existing.cutoff_message_id,
        message: "cutover already recorded for this release",
      };
    }

    const maxRow = db.prepare(
      "SELECT COALESCE(MAX(id), 0) AS max_id FROM mem_messages WHERE owner_id = ?",
    ).get(normalizedOwnerId) as { max_id: number };
    const cutoff = Number(maxRow.max_id ?? 0);
    const buildIdentity = currentBuildIdentity();
    db.prepare(
      `INSERT INTO recall_live_cutovers
         (owner_id, capability, release_id, cutoff_message_id, authorized_by, contract_id, build_identity, created_at)
       VALUES (?, 'recall', ?, ?, ?, ?, ?, ?)`,
    ).run(normalizedOwnerId, releaseId, cutoff, authorizedBy, releaseId, buildIdentity, new Date().toISOString());

    const recorded = recordEvent(db, {
      capability: "recall",
      releaseId,
      kind: "operator_cutover",
      sourceKey: `operator_cutover:${normalizedOwnerId}:${releaseId}`,
      detail: { authorizedBy, cutoffMessageId: cutoff, ownerId: normalizedOwnerId },
    });
    if (!recorded) {
      throw new Error("operator_cutover_audit_not_recorded");
    }
    db.exec("COMMIT");
    transactionOpen = false;
    return { success: true, status: "cutover_recorded", cutoffMessageId: cutoff, message: "cutover recorded" };
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original failure */
      }
    }
    throw error;
  }
}
