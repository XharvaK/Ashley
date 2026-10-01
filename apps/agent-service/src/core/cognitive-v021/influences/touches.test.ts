// Only grown branches in a committed aftermath count as distinct lived cycles.
import {describe,expect,it} from "vitest";
import {openTestSidecar,admitTestCycle,makeThoughtDraft} from "../test-support.js";
import {publishSemanticTransaction} from "../settlement/publish.js";
import {recordSettlementAftermath} from "../thought/aftermath.js";
import {forgetInterestBranch} from "../memory/interests.js";
const NOW=Date.UTC(2026,9,1,12),options={identityStore:null,timeZone:"UTC",nowMs:NOW};
const hasTouches=(db:ReturnType<typeof openTestSidecar>)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='interest_touches'").get();
const receipts=(db:ReturnType<typeof openTestSidecar>)=>hasTouches(db)?db.prepare("SELECT branch_key,cycle_id,touched_at_ms FROM interest_touches ORDER BY branch_key,cycle_id").all():[];
function publish(db:ReturnType<typeof openTestSidecar>,cycleId:string,redacted=false){
 admitTestCycle(db,{cycleId,conversationId:"touch-fixture",generation:1,triggerKind:"idle_opportunity",triggerRef:cycleId,nowMs:NOW});
 const draft=makeThoughtDraft({cycleId,generation:1,speech:{mode:"none",mustSay:[],mustNot:[],surfaceDraft:null,acceptableRealizations:[],presentationDirectives:[]}});
 const settlement={...draft,settlementId:cycleId+":settlement",speech:{...draft.speech,finalLicensedText:null},interests:[{root:"Technology",branch:"compilers"},{root:"Technology",branch:"compilers"},{root:"invalid-root",branch:"discard"},{root:"Technology",branch:"   "}],...(redacted?{redacted:true}:{})};
 expect(publishSemanticTransaction(db,settlement as Parameters<typeof publishSemanticTransaction>[1],{nowMs:NOW,triggerKind:"idle_opportunity",aftermath:{conversationId:"touch-fixture",passKind:null,nightPass:null}}).published).toBe(true);
}
describe("A5a interest-touch receipts",()=>{
 it("records only grown IDs once per branch/cycle without replay double count",()=>{
  const db=openTestSidecar();try{
   publish(db,"one");recordSettlementAftermath(db,"one:settlement",options);recordSettlementAftermath(db,"one:settlement",options);
   publish(db,"two");recordSettlementAftermath(db,"two:settlement",options);
   expect(receipts(db)).toEqual([{branch_key:"technology/compilers",cycle_id:"one",touched_at_ms:NOW},{branch_key:"technology/compilers",cycle_id:"two",touched_at_ms:NOW}]);
   expect(db.prepare("SELECT lived_count FROM interest_branches WHERE branch_id='technology/compilers'").get()).toEqual({lived_count:2});
   db.prepare("INSERT OR IGNORE INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES ('technology/compilers','one',?)").run(NOW+1);
   expect(receipts(db)).toHaveLength(2);
  }finally{db.close();}
 });
 it("rolls back branch growth and touch receipts together on receipt failure",()=>{
  const db=openTestSidecar();try{
   publish(db,"rollback");if(hasTouches(db))db.exec("CREATE TRIGGER fixture_touch_fail BEFORE INSERT ON interest_touches BEGIN SELECT RAISE(ABORT,'fixture_touch_fail'); END");
   expect(()=>recordSettlementAftermath(db,"rollback:settlement",options)).toThrow("fixture_touch_fail");
   expect(receipts(db)).toEqual([]);
   expect(db.prepare("SELECT branch_id FROM interest_branches WHERE origin='ashley'").all()).toEqual([]);
   expect(db.prepare("SELECT status FROM settlement_aftermath WHERE cycle_id='rollback'").get()).toEqual({status:"pending"});
  }finally{db.close();}
 });
 it("ignores redacted claims and deletes forgotten branch identifiers",()=>{
  const db=openTestSidecar();try{
   publish(db,"redacted",true);recordSettlementAftermath(db,"redacted:settlement",options);expect(receipts(db)).toEqual([]);
   publish(db,"standing");recordSettlementAftermath(db,"standing:settlement",options);expect(receipts(db)).toHaveLength(1);
   forgetInterestBranch(db,"technology/compilers");expect(receipts(db)).toEqual([]);
  }finally{db.close();}
 });
});
