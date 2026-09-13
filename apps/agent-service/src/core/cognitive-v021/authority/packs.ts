import type { DatabaseSync } from "node:sqlite";
import { readCognitiveSidecarMeta, updateCognitiveAuthorityEpoch } from "../sidecar/db.js";
import type { AuthorityPacks, CapabilityReality, EffectReceipt } from "../types.js";
import { captureAuthorityCurrentness } from "./barrier.js";

type Row = Record<string, unknown>;
const noCapability: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function json(value: unknown): unknown {
  try { return JSON.parse(typeof value === "string" ? value : "null"); } catch { return {}; }
}

export function loadEffectReceipts(
  db: DatabaseSync,
  options: { limit?: number; effectIds?: readonly string[] } = {},
): Record<string, EffectReceipt> {
  const result: Record<string, EffectReceipt> = {};
  const effectIds = [...new Set(options.effectIds ?? [])].filter(Boolean);
  const rows = effectIds.length > 0
    ? db.prepare(
      `SELECT * FROM effect_receipts
        WHERE effect_id IN (${effectIds.map(() => "?").join(",")})
        ORDER BY at_ms DESC`,
    ).all(...effectIds)
    : options.limit == null
      ? db.prepare("SELECT * FROM effect_receipts ORDER BY at_ms ASC").all()
      : db.prepare("SELECT * FROM effect_receipts ORDER BY at_ms DESC, effect_id DESC LIMIT ?").all(
        Math.max(1, Math.min(512, Math.floor(options.limit))),
      );
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = row as Row;
    const claims = json(value.claims_json);
    result[String(value.effect_id ?? "")] = {
      receiptId: String(value.receipt_id ?? ""),
      effectId: String(value.effect_id ?? ""),
      idempotencyKey: String(value.idempotency_key ?? ""),
      outcome: (String(value.outcome) === "unknown" ? "outcome_unknown" : String(value.outcome ?? "outcome_unknown")) as EffectReceipt["outcome"],
      claims: typeof claims === "object" && claims !== null && !Array.isArray(claims) ? claims as Record<string, unknown> : {},
      atMs: Number(value.at_ms ?? 0),
      dataClassification: String(value.data_classification ?? "never_public") as EffectReceipt["dataClassification"],
      secretOmitted: Number(value.secret_omitted ?? 0) === 1,
    };
  }
  return result;
}

export function loadAuthorityPacks(
  db: DatabaseSync,
  options: Partial<Pick<AuthorityPacks, "capability" | "operational" | "relational">> & {
    observedObservationIds?: string[];
    authorityDb?: DatabaseSync;
    receiptLimit?: number;
    effectIds?: readonly string[];
  } = {},
): AuthorityPacks {
  const meta = readCognitiveSidecarMeta(db);
  const binding = options.authorityDb ? captureAuthorityCurrentness(options.authorityDb) : undefined;
  const receiptLimit = options.receiptLimit == null
    ? undefined
    : Math.max(1, Math.min(512, Math.floor(options.receiptLimit)));
  const receiptsByEffectId = loadEffectReceipts(db, {
    limit: receiptLimit,
    effectIds: options.effectIds,
  });
  return {
    epistemic: { allowInferredWorldClaims: false },
    currentness: {
      requireObservationForLatest: true,
      observedObservationIds: options.observedObservationIds ?? [],
      binding,
      complete: binding != null,
      receiptLimit,
      receiptsTruncated: receiptLimit != null && Object.keys(receiptsByEffectId).length >= receiptLimit,
    },
    receipt: { receiptsByEffectId, bounded: receiptLimit != null },
    capability: options.capability ?? noCapability,
    operational: options.operational ?? { sandboxAvailable: false },
    relational: options.relational ?? { withdrawalActive: false, neverMention: [] },
    stateEpoch: { authorityEpoch: meta.authority_epoch },
  };
}

export function bumpAuthorityEpoch(db: DatabaseSync): number {
  const next = readCognitiveSidecarMeta(db).authority_epoch + 1;
  updateCognitiveAuthorityEpoch(db, next);
  return next;
}
