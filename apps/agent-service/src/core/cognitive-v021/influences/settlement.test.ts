// Real publication/aftermath binds evidence and later Thought positions atomically.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle, makeThoughtDraft } from "../test-support.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import { recordSettlementAftermath } from "../thought/aftermath.js";
const T=Date.UTC(2026,9,1,12);
function fixture(){
 const db=openTestSidecar(),nuclear=openNuclearDb(new DatabaseSync(":memory:"));
 const options={identityStore:{nuclear,ownerId:"fixture:settlement-owner"},timeZone:"UTC",nowMs:T};
 const settle=(cycleId:string,n:number,touch=true,positionId?:number)=>{
  admitTestCycle(db,{cycleId,conversationId:"fixture:settlement",generation:n,triggerKind:"idle_opportunity",triggerRef:cycleId,nowMs:T+n});
  const draft=makeThoughtDraft({cycleId,generation:n,speech:{mode:"none",mustSay:[],mustNot:[],surfaceDraft:null,acceptableRealizations:[],presentationDirectives:[]}});
  const settlement={...draft,settlementId:cycleId+":settlement",speech:{...draft.speech,finalLicensedText:null},
    ...(touch?{interests:[{root:"Technology",branch:"compilers"}]}:{}),
    ...(positionId?{growth:{influencePositions:[{influenceId:positionId,position:"admit",rationale:"A continuing interest."}]}}:{})};
  expect(publishSemanticTransaction(db,settlement as any,{nowMs:T+n,triggerKind:"idle_opportunity",aftermath:{conversationId:"fixture:settlement",passKind:null,nightPass:null}}).published).toBe(true);
  return recordSettlementAftermath(db,cycleId+":settlement",{...options,nowMs:T+n});
 };
 return {db,nuclear,options,settle};
}
describe("A5b published settlement witnesses",()=>{
 it("counts actual aftermath cycles, rejects guessed same-pass adoption and replays without double count",()=>{
  const f=fixture();try{
   const changes=f.nuclear.prepare("SELECT total_changes() AS n").get()!.n;
   f.settle("one",1);f.settle("two",2);f.settle("three",3,true,1);
   const row=f.db.prepare("SELECT * FROM learned_influences").get()!;expect(row).toBeTruthy();expect(row.adjudication_state).toBe("pending");
   recordSettlementAftermath(f.db,"three:settlement",{...f.options,nowMs:T+3});
   expect(f.db.prepare("SELECT * FROM interest_touches").all()).toHaveLength(3);expect(f.db.prepare("SELECT * FROM learned_influences").all()).toHaveLength(1);
   f.settle("later",4,false,Number(row.id));expect(f.db.prepare("SELECT adjudication_state,admitting_cycle_id FROM learned_influences").get()).toEqual({adjudication_state:"accepted",admitting_cycle_id:"later"});
   expect(f.nuclear.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("rolls back third-touch growth and its receipt when proposal persistence fails",()=>{
  const f=fixture();try{
   f.settle("one",1);f.settle("two",2);
   f.db.exec("CREATE TRIGGER fixture_proposal_failure BEFORE INSERT ON learned_influences BEGIN SELECT RAISE(ABORT,'fixture_proposal_failure'); END");
   expect(()=>f.settle("three",3)).toThrow("fixture_proposal_failure");
   expect(f.db.prepare("SELECT * FROM interest_touches").all()).toHaveLength(2);
   expect(f.db.prepare("SELECT lived_count FROM interest_branches WHERE branch_id='technology/compilers'").get()).toEqual({lived_count:2});
   expect(f.db.prepare("SELECT status FROM settlement_aftermath WHERE cycle_id='three'").get()).toEqual({status:"pending"});
   expect(f.db.prepare("SELECT * FROM learned_influences").all()).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
});
