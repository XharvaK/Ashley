// Isolated numeric-C1 fixtures exercise explicit evidence ownership; no production admission path.
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { insertAssertion } from "../../memory/assertions.js";
import { MIGRATION_38_LEARNED_AUTONOMY_DDL } from "../../cognition/legacy-learned-migration-37.js";
export const OWNER_ID="c3-owner";
export function c1Assertion(
  db: DatabaseSync,
  input: {
    text: string;
    observedAt: string;
    subjectFacet?: "owner_model" | "ashley_side";
    classification?: "ordinary" | "sensitive" | "never_public" | "secret";
  },
): number {
  return insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "owner_interpretation",
    subjectFacet: input.subjectFacet ?? "ashley_side",
    lineageKind: input.subjectFacet === "owner_model" ? "owner_designated" : "ashley_native",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    claimText: input.text,
    sourceKind: "c3_fixture_live",
    recordedAt: input.observedAt,
    authorityFrom: input.observedAt,
    worldIntervalBasis: "adjudicated",
    dataClassification: input.classification ?? "ordinary",
  });
}

export function evidence(
  assertionId: number,
  observedAt: string,
  provenance: "live" | "shadow" = "live",
): {assertionId:number;observedAt:string;provenance:string;evidenceType:string;evidenceId:string} {
  return {
    evidenceType: "assertion",
    evidenceId: String(assertionId),
    assertionId,
    observedAt,
    provenance,
  };
}

export function admitAndAccept(db:DatabaseSync,items:Array<{assertionId:number;observedAt:string;provenance:string}>){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='learned_influences'").get())db.exec(MIGRATION_38_LEARNED_AUTONOMY_DDL);
 const row=db.prepare(`INSERT INTO learned_influences (entity_uuid,owner_id,kind,subject_facet,semantic_owner,semantic_owner_ref,lineage_kind,influence_class,text,content_hash,proposal_lifecycle,adjudication_state,adjudicator,adjudication_decision_id,qualified_at,provenance,capability_mode_at_write,data_classification,classification_source,created_at,updated_at)
 VALUES (?,?,'interest','ashley_side','memory_evidence','interest:compilers','ashley_native','I1','Ashley is interested in compilers','fixture','admitted_to_review','accepted','thought','fixture','2026-08-03T00:00:00Z','live','dark_apply','ordinary','copied','2026-08-03T00:00:00Z','2026-08-03T00:00:00Z')`).run(randomUUID(),OWNER_ID);
 const id=Number(row.lastInsertRowid);
 for(const item of items)db.prepare(`INSERT INTO learned_influence_evidence (entity_uuid,learned_influence_id,owner_id,evidence_type,evidence_id,assertion_id,observed_at,provenance,data_classification,created_at) VALUES (?,?,?,'assertion',?,?,?,?,'ordinary',?)`).run(randomUUID(),id,OWNER_ID,String(item.assertionId),item.assertionId,item.observedAt,item.provenance,item.observedAt);
 return {id,ownerId:OWNER_ID};
}
