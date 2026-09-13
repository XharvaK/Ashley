import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { activeWithdrawal } from "./repair.js";
import { relationshipCanInfluence } from "./influence.js";
import type { MotivationKind, Trigger } from "../types.js";
import { env } from "../../env.js";
import { listEligibleAssertions } from "../memory/eligibility.js";
import { listIdentity } from "../identity/store.js";
import { listActiveLearnedInfluences } from "../learned-autonomy/eligibility.js";
import { maxClassification, type DataClassification } from "../privacy/classification.js";
import {
  normalizeC5WriteMode,
  provenanceForC5Mode,
  assertC5ContractCompatible,
  relationalGraduationCanInfluence,
} from "./c5-contract-state.js";
import { bilateralRelationshipConsentEligible } from "./consent.js";
import { listInteractionContracts } from "./interaction-contracts.js";
import type {
  C5Mode,
  C5Provenance,
  RelationshipProjectionKind,
} from "./types.js";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";

export type SharedCultureSourceBindings = {
  ownerAssertionIds: number[];
  ashleyAssertionIds: number[];
  ashleyIdentityEntryIds: number[];
  learnedInfluenceIds: number[];
  interactionContractIds: number[];
};

export type RelationshipProjection = {
  id: number;
  entityUuid: string;
  ownerId: string;
  kind: RelationshipProjectionKind;
  projectionPolicyId: string;
  projectionPolicyVersion: number;
  sourceBindings: SharedCultureSourceBindings;
  sourceWatermark: Record<string, unknown>;
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  supersedesProjectionId: number | null;
  contentBinding: string;
  computedAt: string;
};

export type SharedCultureRecomputeOptions = {
  at?: Date;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
  projectionPolicyId?: string;
  projectionPolicyVersion?: number;
};

export type SharedCultureRecomputeResult = RelationshipProjection & {
  current: true;
};

export type RelationshipMotivationProjection = {
  kind: Extract<MotivationKind, "unfinished" | "callback">;
  score: number;
  summary: string;
  refType:
    | "ashley_self_commitment"
    | "mutual_commitment"
    | "relational_tension";
  refId: string;
};

export type RelationshipMotivationProjectionOptions = {
  /** Dark apply is a fixture-only C5 influence mode. */
  capabilityMode?: C5Mode;
};

const MAX_SELF_COMMITMENTS = 4;
const MAX_MUTUAL_COMMITMENTS = 4;
const MAX_TENSIONS = 1;

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u00c0-\u00ff]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

function isTextRelevant(message: string, candidate: string): boolean {
  const messageTokens = tokens(message);
  if (messageTokens.size === 0) return false;
  let hits = 0;
  for (const token of tokens(candidate)) {
    if (messageTokens.has(token)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function sourceText(row: Record<string, unknown>): string {
  const value = typeof row.text === "string" ? row.text.trim() : "";
  return value.slice(0, 600);
}

function sourceRef(
  row: Record<string, unknown>,
  refType: RelationshipMotivationProjection["refType"],
): RelationshipMotivationProjection | null {
  const refId = typeof row.entity_uuid === "string" ? row.entity_uuid : "";
  const summary = sourceText(row);
  if (!refId || !summary || String(row.data_classification) === "secret") {
    return null;
  }
  const score =
    refType === "ashley_self_commitment"
      ? 62
      : refType === "mutual_commitment"
        ? 54
        : 36;
  return {
    kind: "unfinished",
    score,
    summary,
    refType,
    refId,
  };
}

function filterReactive(
  projection: RelationshipMotivationProjection,
  trigger: Trigger,
  message: string,
): boolean {
  return (
    trigger !== "reactive" ||
    !message ||
    isTextRelevant(message, projection.summary)
  );
}

/**
 * Read-only relationship source projections. Source rows remain authoritative.
 * This function never creates or updates relationship records.
 */
export function listRelationshipMotivationProjections(
  db: DatabaseSync,
  ownerId: string,
  trigger: Trigger,
  message = "",
  options: RelationshipMotivationProjectionOptions = {},
): RelationshipMotivationProjection[] {
  const projections: RelationshipMotivationProjection[] = [];
  if (trigger !== "proactive") return projections;
  const legacyAuthority = relationshipCanInfluence(
    db,
    env.cognitionMode,
    "relational_initiative",
  );
  const c5Mode = options.capabilityMode ?? "observe";
  const c5Authority = relationalGraduationCanInfluence(db, c5Mode);
  if (!legacyAuthority && !c5Authority) {
    return projections;
  }
  const withdrawal = activeWithdrawal(db, ownerId);

  const selfRows = withdrawal
    ? []
    : db
    .prepare(
      `SELECT entity_uuid, text, data_classification, decision_id, provenance,
              party_subject_scope
       FROM ashley_self_commitments
       WHERE owner_id = ? AND status = 'active'
         AND data_classification <> 'secret'
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(ownerId, MAX_SELF_COMMITMENTS) as Array<Record<string, unknown>>;
  for (const row of selfRows) {
    const legacy = !rowIsC5Managed(row) && legacyAuthority;
    const c5 = c5RowMayInfluence(
      db,
      ownerId,
      row,
      c5Mode,
      "ashley_self_commitment",
    );
    if (!legacy && !c5) continue;
    const projection = sourceRef(row, "ashley_self_commitment");
    if (projection && filterReactive(projection, trigger, message)) {
      projections.push(projection);
    }
  }

  const mutualRows = withdrawal
    ? []
    : db
    .prepare(
      `SELECT entity_uuid, text, data_classification, ashley_decision_id, provenance,
              party_subject_scope
       FROM mutual_commitments
       WHERE owner_id = ? AND status = 'active'
         AND data_classification <> 'secret'
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(ownerId, MAX_MUTUAL_COMMITMENTS) as Array<Record<string, unknown>>;
  for (const row of mutualRows) {
    const legacy = !rowIsC5Managed(row) && legacyAuthority;
    const c5 = c5RowMayInfluence(
      db,
      ownerId,
      row,
      c5Mode,
      "mutual_commitment",
    );
    if (!legacy && !c5) continue;
    const projection = sourceRef(row, "mutual_commitment");
    if (projection && filterReactive(projection, trigger, message)) {
      projections.push(projection);
    }
  }

  // Explicit repair eligibility is the only withdrawal state that may let a
  // bounded tension candidate reach Thought. Withdrawal itself is never fuel.
  if (
    !withdrawal ||
    String(withdrawal.repair_status ?? "") === "eligible"
  ) {
    const tensionRows = db
      .prepare(
         `SELECT entity_uuid, text, data_classification, decision_id, provenance,
                 party_subject_scope
         FROM relational_tensions
         WHERE owner_id = ? AND status = 'open'
           AND repair_status IN ('open', 'repairing')
           AND data_classification <> 'secret'
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(ownerId, MAX_TENSIONS) as Array<Record<string, unknown>>;
    for (const row of tensionRows) {
      const legacy = !rowIsC5Managed(row) && legacyAuthority;
      const c5 = c5RowMayInfluence(
        db,
        ownerId,
        row,
        c5Mode,
        "relational_tension",
      );
      if (!legacy && !c5) continue;
      const projection = sourceRef(row, "relational_tension");
      if (projection && filterReactive(projection, trigger, message)) {
        projections.push(projection);
      }
    }
  }

  return projections;
}

function normalizeCultureText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cultureTokens(text: string): Set<string> {
  return new Set(
    normalizeCultureText(text)
      .split(" ")
      .filter((token) => token.length >= 4),
  );
}

function rowIsC5Managed(row: Record<string, unknown>): boolean {
  const partySubjectScope = String(row.party_subject_scope ?? "owner").trim().toLowerCase();
  return row.decision_id != null || row.ashley_decision_id != null ||
    String(row.provenance ?? "shadow") === "live" ||
    (partySubjectScope !== "" && partySubjectScope !== "owner");
}

function c5RowMayInfluence(
  db: DatabaseSync,
  ownerId: string,
  row: Record<string, unknown>,
  mode: C5Mode,
  kind: RelationshipMotivationProjection["refType"],
): boolean {
  if (!rowIsC5Managed(row)) return false;
  if (!relationalGraduationCanInfluence(db, mode)) return false;
  if (String(row.provenance ?? "shadow") !== "live") return false;
  if (kind === "mutual_commitment" && !bilateralRelationshipConsentEligible(db, ownerId)) {
    return false;
  }
  return true;
}

function cultureOverlaps(left: string, right: string): boolean {
  const leftNormalized = normalizeCultureText(left);
  const rightNormalized = normalizeCultureText(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  const leftTokens = cultureTokens(leftNormalized);
  const rightTokens = cultureTokens(rightNormalized);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common += 1;
  }
  return common >= 2 && common / Math.max(leftTokens.size, rightTokens.size) >= 0.75;
}

function bindingHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 64);
}

function assertionText(assertion: {
  claimText: string | null;
  key: string | null;
  value: string | null;
}): string {
  return assertion.claimText?.trim() || `${assertion.key ?? ""} ${assertion.value ?? ""}`.trim();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function mapProjection(row: unknown): RelationshipProjection | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  const kind = String(source.kind ?? "");
  if (kind !== "current_shared_culture" && kind !== "historical_as_of") return null;
  return {
    id: Number(source.id ?? 0),
    entityUuid: String(source.entity_uuid ?? ""),
    ownerId: String(source.owner_id ?? ""),
    kind,
    projectionPolicyId: String(source.projection_policy_id ?? ""),
    projectionPolicyVersion: Number(source.projection_policy_version ?? 0),
    sourceBindings: parseJson<SharedCultureSourceBindings>(source.source_bindings_json, {
      ownerAssertionIds: [],
      ashleyAssertionIds: [],
      ashleyIdentityEntryIds: [],
      learnedInfluenceIds: [],
      interactionContractIds: [],
    }),
    sourceWatermark: parseJson<Record<string, unknown>>(source.source_watermark_json, {}),
    dataClassification: String(source.data_classification ?? "never_public") as DataClassification,
    provenance: String(source.provenance ?? "shadow") as C5Provenance,
    partySubjectScope: String(source.party_subject_scope ?? "owner"),
    effectiveFrom: String(source.effective_from ?? ""),
    effectiveTo: source.effective_to == null ? null : String(source.effective_to),
    supersedesProjectionId: numberOrNull(source.supersedes_projection_id),
    contentBinding: String(source.content_binding ?? ""),
    computedAt: String(source.computed_at ?? ""),
  };
}

function currentRelationshipContractIds(
  db: DatabaseSync,
  ownerId: string,
  mode: C5Mode,
  at: Date,
): number[] {
  try {
    if (!bilateralRelationshipConsentEligible(db, ownerId, at)) return [];
    const atIso = at.toISOString();
    const provenance = provenanceForC5Mode(mode);
    return listInteractionContracts(db, ownerId, "mutual_contract")
      .filter((contract) =>
        contract.lifecycleState === "in_force" &&
        contract.provenance === provenance &&
        contract.dataClassification !== "secret" &&
        contract.effectiveFrom <= atIso &&
        (contract.effectiveTo === null || atIso < contract.effectiveTo),
      )
      .map((contract) => contract.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
  } catch {
    return [];
  }
}

function currentLearnedInfluenceIds(
  db: DatabaseSync,
  ownerId: string,
  mode: C5Mode,
  at: Date,
): number[] {
  if (mode !== "dark_apply") return [];
  try {
    return listActiveLearnedInfluences(db, ownerId, {
      mode: "dark_apply",
      at,
    })
      .filter((influence) => influence.lineageKind === "ashley_native")
      .map((influence) => influence.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0);
  } catch {
    return [];
  }
}

function currentSharedCultureBindings(
  db: DatabaseSync,
  ownerId: string,
  at: Date,
  mode: C5Mode,
): {
  bindings: SharedCultureSourceBindings;
  classification: DataClassification;
  overlapKeys: string[];
  watermark: Record<string, unknown>;
} {
  const assertions = listEligibleAssertions(db, ownerId, at.toISOString())
    .filter((assertion) =>
      (assertion.subjectFacet === "owner_model" || assertion.subjectFacet === "ashley_side") &&
      assertion.dataClassification !== "secret",
    );
  const owner = assertions.filter((assertion) => assertion.subjectFacet === "owner_model");
  const ashley = assertions.filter((assertion) => assertion.subjectFacet === "ashley_side");
  const identity = listIdentity(db, ownerId, { limit: 100, seed: false });
  const ownerAssertionIds = new Set<number>();
  const ashleyAssertionIds = new Set<number>();
  const ashleyIdentityEntryIds = new Set<number>();
  const overlapKeys: string[] = [];
  const classifications: DataClassification[] = [];

  for (const ownerAssertion of owner) {
    const ownerText = assertionText(ownerAssertion);
    const ownerSources: Array<{
      kind: "assertion" | "identity";
      id: number;
      text: string;
      classification: DataClassification;
    }> = [
      ...ashley.map((item) => ({
        kind: "assertion" as const,
        id: item.id,
        text: assertionText(item),
        classification: item.dataClassification,
      })),
      ...identity.map((entry) => ({
        kind: "identity" as const,
        id: entry.id,
        text: entry.text,
        classification: "ordinary" as const,
      })),
    ];
    for (const ashleySource of ownerSources) {
      if (!cultureOverlaps(ownerText, ashleySource.text)) continue;
      ownerAssertionIds.add(ownerAssertion.id);
      classifications.push(ownerAssertion.dataClassification, ashleySource.classification);
      if (ashleySource.kind === "assertion") ashleyAssertionIds.add(ashleySource.id);
      else ashleyIdentityEntryIds.add(ashleySource.id);
      overlapKeys.push(bindingHash({
        ownerAssertionId: ownerAssertion.id,
        ashleySourceKind: ashleySource.kind,
        ashleySourceId: ashleySource.id,
      }));
    }
  }

  const learnedInfluenceIds = currentLearnedInfluenceIds(db, ownerId, mode, at);
  const interactionContractIds = currentRelationshipContractIds(db, ownerId, mode, at);
  const bindings: SharedCultureSourceBindings = {
    ownerAssertionIds: [...ownerAssertionIds].sort((a, b) => a - b),
    ashleyAssertionIds: [...ashleyAssertionIds].sort((a, b) => a - b),
    ashleyIdentityEntryIds: [...ashleyIdentityEntryIds].sort((a, b) => a - b),
    learnedInfluenceIds,
    interactionContractIds,
  };
  const maxAssertionId = assertions.reduce((max, item) => Math.max(max, item.id), 0);
  const maxIdentityUpdatedAt = identity.reduce(
    (latest, item) => item.updatedAt > latest ? item.updatedAt : latest,
    "",
  );
  return {
    bindings,
    classification: maxClassification(...classifications),
    overlapKeys: [...new Set(overlapKeys)].sort(),
    watermark: {
      evaluatedAt: at.toISOString(),
      maxEligibleAssertionId: maxAssertionId,
      maxCurrentIdentityUpdatedAt: maxIdentityUpdatedAt || null,
      learnedInfluenceIds,
      interactionContractIds,
    },
  };
}

function projectionEqual(
  current: RelationshipProjection,
  bindings: SharedCultureSourceBindings,
  contentBinding: string,
  classification: DataClassification,
  provenance: C5Provenance,
  policyId: string,
  policyVersion: number,
): boolean {
  return current.contentBinding === contentBinding &&
    JSON.stringify(current.sourceBindings) === JSON.stringify(bindings) &&
    current.dataClassification === classification &&
    current.provenance === provenance &&
    current.projectionPolicyId === policyId &&
    current.projectionPolicyVersion === policyVersion;
}

/** Recompute current shared culture from separately current owner and Ashley state. */
export function recomputeSharedCulture(
  db: DatabaseSync,
  ownerId: string,
  options: SharedCultureRecomputeOptions = {},
): SharedCultureRecomputeResult {
  assertC5ContractCompatible(db);
  const at = options.at ?? new Date();
  const requestedMode = options.capabilityMode ?? options.mode ?? "observe";
  const mode = normalizeC5WriteMode(db, requestedMode);
  const policyId = options.projectionPolicyId ?? "c5.shared_culture.current.v1";
  const policyVersion = options.projectionPolicyVersion ?? 1;
  const computedAt = new Date().toISOString();
  const { bindings, classification, overlapKeys, watermark } =
    currentSharedCultureBindings(db, ownerId, at, mode);
  const provenance = provenanceForC5Mode(mode);
  const contentBinding = bindingHash({
    policyId,
    policyVersion,
    bindings,
    overlapKeys,
  });
  const current = getCurrentSharedCulture(db, ownerId);
  if (current && projectionEqual(
    current,
    bindings,
    contentBinding,
    classification,
    provenance,
    policyId,
    policyVersion,
  )) {
    return { ...current, current: true };
  }

  let effectiveFrom = at.toISOString();
  if (current && effectiveFrom <= current.effectiveFrom) {
    effectiveFrom = new Date(Date.parse(current.effectiveFrom) + 1).toISOString();
  }
  if (current) {
    db.prepare(
      `UPDATE relationship_projections
       SET kind = 'historical_as_of', effective_to = ?
       WHERE id = ? AND kind = 'current_shared_culture' AND effective_to IS NULL`,
    ).run(effectiveFrom, current.id);
  }
  const result = db.prepare(
    `INSERT INTO relationship_projections
       (entity_uuid, owner_id, kind, projection_policy_id,
        projection_policy_version, source_bindings_json, source_watermark_json,
        data_classification, provenance, party_subject_scope, effective_from,
        effective_to, supersedes_projection_id, content_binding, computed_at)
     VALUES (?, ?, 'current_shared_culture', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    assignNewEntityUuid(),
    ownerId,
    policyId,
    policyVersion,
    JSON.stringify(bindings),
    JSON.stringify(watermark),
    classification,
    provenance,
    "owner_state + ashley_state + relationship_state",
    effectiveFrom,
    current?.id ?? null,
    contentBinding,
    computedAt,
  );
  const inserted = db.prepare(
    `SELECT * FROM relationship_projections WHERE id = ?`,
  ).get(Number(result.lastInsertRowid));
  const mapped = mapProjection(inserted);
  if (!mapped) throw new Error("relationship_projection_write_unreadable");
  return { ...mapped, current: true };
}

export function getCurrentSharedCulture(
  db: DatabaseSync,
  ownerId: string,
): RelationshipProjection | null {
  assertC5ContractCompatible(db);
  return mapProjection(db.prepare(
    `SELECT * FROM relationship_projections
     WHERE owner_id = ? AND kind = 'current_shared_culture'
       AND effective_to IS NULL`,
  ).get(ownerId));
}

export function listHistoricalSharedCulture(
  db: DatabaseSync,
  ownerId: string,
): RelationshipProjection[] {
  assertC5ContractCompatible(db);
  return db.prepare(
    `SELECT * FROM relationship_projections
     WHERE owner_id = ? AND kind = 'historical_as_of'
     ORDER BY effective_from DESC, id DESC`,
  ).all(ownerId)
    .map(mapProjection)
    .filter((row): row is RelationshipProjection => row !== null);
}

export function relationshipProjectionDiagnostics(
  db: DatabaseSync,
  ownerId: string,
): {
  currentCount: number;
  historicalCount: number;
  currentClassification: DataClassification | null;
  currentProvenance: C5Provenance | null;
  privateThoughtPolicy: string;
  commitmentsSurfacePolicy: string;
} {
  assertC5ContractCompatible(db);
  const current = getCurrentSharedCulture(db, ownerId);
  const counts = db.prepare(
    `SELECT kind, COUNT(*) AS count FROM relationship_projections
     WHERE owner_id = ? GROUP BY kind`,
  ).all(ownerId) as Array<{ kind?: string; count?: number }>;
  return {
    currentCount: Number(counts.find((row) => row.kind === "current_shared_culture")?.count ?? 0),
    historicalCount: Number(counts.find((row) => row.kind === "historical_as_of")?.count ?? 0),
    currentClassification: current?.dataClassification ?? null,
    currentProvenance: current?.provenance ?? null,
    privateThoughtPolicy: "never_public may enter authorized private Thought; secret is excluded",
    commitmentsSurfacePolicy: "never_public and secret are hidden from /commitments",
  };
}
