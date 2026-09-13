import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { beginAuthorityTransition, captureAuthorityCurrentness, stabilizeAuthorityBarrier } from "./barrier.js";
import { checkAuthority } from "./check.js";
import { loadAuthorityPacks } from "./packs.js";
import type { EffectProposal } from "../types.js";

const proposal: EffectProposal = {
  effectId: "effect-pack-1",
  cycleId: "cycle-pack-1",
  generation: 1,
  idempotencyKey: "idem-pack-1",
  kind: "workspace.read_file",
  request: {},
  authorityEpoch: 1,
};

describe("v0.2.1 complete and current Authority packs", () => {
  it("captures a stable binding and bounds receipt projections", () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openTestSidecar();
    try {
      sidecar.exec(`
        INSERT INTO effect_receipts
          (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms, data_classification, secret_omitted)
        VALUES
          ('receipt-pack-1', 'effect-pack-1', 'idem-pack-1', 'succeeded', '{}', 1, 'ordinary', 0),
          ('receipt-pack-2', 'effect-pack-2', 'idem-pack-2', 'failed', '{}', 2, 'ordinary', 0)
      `);

      const packs = loadAuthorityPacks(sidecar, {
        authorityDb: nuclear,
        receiptLimit: 1,
      });

      expect(packs.currentness).toMatchObject({
        complete: true,
        receiptLimit: 1,
        receiptsTruncated: true,
      });
      expect(packs.currentness.binding).toEqual(captureAuthorityCurrentness(nuclear));
      expect(packs.receipt.bounded).toBe(true);
      expect(Object.keys(packs.receipt.receiptsByEffectId)).toHaveLength(1);
      expect(checkAuthority("dispatch", {
        proposal,
        packs,
        authorityEpoch: 1,
        authorityDb: nuclear,
      })).toEqual({ ok: true });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("rejects an incomplete pack and preserves the transition or stale-vector code", () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openTestSidecar();
    try {
      const incomplete = loadAuthorityPacks(sidecar);
      expect(checkAuthority("dispatch", {
        proposal,
        packs: incomplete,
        authorityEpoch: 1,
        authorityDb: nuclear,
      })).toEqual({ ok: false, codes: ["AUTHORITY_PACK_INCOMPLETE"] });

      const current = loadAuthorityPacks(sidecar, { authorityDb: nuclear });
      const transition = beginAuthorityTransition(nuclear, "pack-test", 10);
      expect(checkAuthority("dispatch", {
        proposal,
        packs: current,
        authorityEpoch: 1,
        authorityDb: nuclear,
      })).toEqual({ ok: false, codes: ["AUTHORITY_TRANSITION_ACTIVE"] });

      const stabilized = stabilizeAuthorityBarrier(nuclear, transition.vector, 11, transition.transitionId);
      expect(stabilized.state).toBe("stable");
      expect(checkAuthority("dispatch", {
        proposal,
        packs: current,
        authorityEpoch: 1,
        authorityDb: nuclear,
        expectedCurrentness: current.currentness.binding,
      })).toEqual({ ok: false, codes: ["AUTHORITY_VECTOR_STALE"] });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
