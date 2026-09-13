import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ContextProjection } from "../model-fabric/projection.js";
import type {
  ContextAllocationReceipt,
  ContextBudgetPlan,
  ContextBudgetMode,
  ContextRouteBinding,
  ContextSelectionDecision,
} from "./types.js";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function receiptItems(selection: ContextSelectionDecision): unknown[] {
  return selection.included.map((item) => ({
    ref: item.ref,
    section: item.section,
    bytes: Buffer.byteLength(item.content, "utf8"),
    classification: item.classification,
    memoryContextRole: item.memoryContextRole,
  }));
}

function writeReceiptRow(db: DatabaseSync, receipt: ContextAllocationReceipt): void {
  db.prepare(
    `INSERT INTO context_allocation_receipts
       (receipt_id, request_id, owner_id, purpose,
        route_policy_snapshot_id, route_id, profile_id, profile_version,
        profile_fingerprint, provider_adapter_class, egress_approval_ref,
        route_class, policy_id, policy_version, projection_id, content_binding,
        included_json, omitted_json, truncated_json, compressed_json,
        degradation_json, same_snapshot_id, capability_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  ).run(
    receipt.receiptId,
    receipt.requestId,
    receipt.ownerId,
    receipt.purpose,
    receipt.route.routePolicySnapshotId,
    receipt.route.routeId,
    receipt.route.profileId,
    receipt.route.profileVersion,
    receipt.route.profileFingerprint,
    receipt.route.adapterClass,
    null,
    receipt.route.routeClass,
    receipt.policyId,
    receipt.policyVersion,
    receipt.projectionId,
    receipt.contentBinding,
    json({ items: receipt.included }),
    json({ items: receipt.omitted }),
    json({ items: receipt.truncated }),
    json({ items: receipt.compressed }),
    json({ items: receipt.degradation }),
    receipt.sameSnapshotId,
    receipt.capabilityMode,
    receipt.createdAt,
  );
}

export function writeContextAllocationReceipt(input: {
  db: DatabaseSync;
  requestId: string;
  ownerId: string;
  purpose: string;
  route: ContextRouteBinding;
  plan: ContextBudgetPlan;
  projection: ContextProjection;
  selection: ContextSelectionDecision;
  capabilityMode?: ContextBudgetMode;
  sameSnapshotId?: string | null;
}): ContextAllocationReceipt {
  const receipt: ContextAllocationReceipt = {
    receiptId: randomUUID(),
    requestId: input.requestId,
    ownerId: input.ownerId,
    purpose: input.purpose,
    route: input.route,
    policyId: input.plan.policyId,
    policyVersion: input.plan.policyVersion,
    projectionId: input.projection.projectionId,
    contentBinding: input.projection.contentBinding.value,
    included: receiptItems(input.selection),
    omitted: input.selection.omitted.map((item) => ({ ...item })),
    truncated: input.selection.truncated.map((item) => ({ ...item })),
    compressed: input.selection.compressed.map((item) => ({ ...item })),
    degradation: [...input.selection.degradation],
    sameSnapshotId: input.sameSnapshotId ?? null,
    capabilityMode: input.capabilityMode ?? "observe",
    createdAt: new Date().toISOString(),
  };
  writeReceiptRow(input.db, receipt);
  return receipt;
}

/** Alias matching the C2 library vocabulary. */
export const recordContextAllocationReceipt = writeContextAllocationReceipt;
