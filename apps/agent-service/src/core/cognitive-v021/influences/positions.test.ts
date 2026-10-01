// Counted repetition proposes; only a later Thought settlement may admit it.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { recordInterestTouches } from "../memory/interests.js";
import { growthForThought, recordGrowth } from "../growth/growth.js";
import { isValidGrowthClaim } from "../growth/claim.js";
import { readEligibility, refreshEligibility } from "./eligibility.js";
const T = Date.UTC(2026,9,1,12), OWNER = "fixture:position-owner";
function fixture() {
  const db = openTestSidecar(), nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  const identityStore = { nuclear, ownerId: OWNER };
  for (let n=1;n<=3;n++) {
    admit(db,"proposal"+n,n);
    const [branch] = recordInterestTouches(db,[{root:"Technology",branch:"compilers"}],T+n);
    db.prepare("INSERT INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES (?,?,?)").run(branch,"proposal"+n,T+n);
  }
  recordGrowth(db,{cycleId:"proposal3",identityStore,dataClassification:"ordinary",nowMs:T+3});
  const id = Number(db.prepare("SELECT id FROM learned_influences WHERE branch_key='technology/compilers'").get()!.id);
  return {db,nuclear,identityStore,id};
}
function admit(db:ReturnType<typeof openTestSidecar>,cycleId:string,n:number) {
  admitTestCycle(db,{cycleId,conversationId:"fixture:positions",generation:n+1,triggerKind:"idle_opportunity",triggerRef:cycleId,nowMs:T+n});
}
function position(f:ReturnType<typeof fixture>,cycleId:string,n:number,position="admit",extra={}) {
  return recordGrowth(f.db,{cycleId,identityStore:f.identityStore,dataClassification:"ordinary",nowMs:T+n,
    claim:{influencePositions:[{influenceId:f.id,position,rationale:"This remains worth returning to.",...extra}]} as any});
}
const stored=(f:ReturnType<typeof fixture>)=>f.db.prepare("SELECT * FROM learned_influences WHERE id=?").get(f.id)!;
describe("A5b later-pass Thought positions",()=>{
  it("shows counted proposals without presenting them as an adopted identity",()=>{
    const f=fixture();try {
      expect((growthForThought(f.db,f.identityStore,T+4) as any).influenceProposals).toEqual([{influenceId:f.id,branchKey:"technology/compilers",label:"compilers",distinctCycles:3}]);
      expect(stored(f).adjudication_state).toBe("pending");
    }finally{f.db.close();f.nuclear.close();}
  });
  it("rejects same-pass adoption and accepts only a genuinely later admitted cycle",()=>{
    const f=fixture();try {
      position(f,"proposal3",4);expect(stored(f).adjudication_state).toBe("pending");
      admit(f.db,"earlier",2);position(f,"earlier",5);expect(stored(f).adjudication_state).toBe("pending");
      admit(f.db,"later",6);position(f,"later",7);
      expect(stored(f)).toMatchObject({adjudication_state:"accepted",adjudicator:"thought",admitting_cycle_id:"later",position_rationale:"This remains worth returning to."});
      expect(readEligibility(f.db,f.id,{at:new Date(T+8)})).toBe(true);
      expect((growthForThought(f.db,f.identityStore,T+8) as any).influenceProposals).toBeUndefined();
    }finally{f.db.close();f.nuclear.close();}
  });
  it("records an explicit later decline and does not silently propose it again",()=>{
    const f=fixture();try {
      admit(f.db,"declining",5);position(f,"declining",6,"decline");
      expect(stored(f).adjudication_state).toBe("declined");
      recordGrowth(f.db,{cycleId:"declining",identityStore:f.identityStore,dataClassification:"ordinary",nowMs:T+7});
      expect(f.db.prepare("SELECT * FROM learned_influences").all()).toHaveLength(1);
      expect(readEligibility(f.db,f.id,{at:new Date(T+8)})).toBe(false);
    }finally{f.db.close();f.nuclear.close();}
  });
  it("validates only three bounded Thought positions and rejects claimed Owner authority",()=>{
    const item={influenceId:1,position:"admit",rationale:"Worth returning to."};
    expect(isValidGrowthClaim({influencePositions:[item]})).toBe(true);
    expect(isValidGrowthClaim({influencePositions:Array(4).fill(item)})).toBe(false);
    expect(isValidGrowthClaim({influencePositions:[{...item,ownerApproval:true}]})).toBe(false);
    expect(isValidGrowthClaim({influencePositions:[{...item,rationale:"x".repeat(201)}]})).toBe(false);
  });
  it("refuses claimed Owner authority, I3 escalation and stale basis without changing Identity",()=>{
    const f=fixture();try {
      const nuclearChanges=f.nuclear.prepare("SELECT total_changes() AS n").get()!.n;
      admit(f.db,"guarded",5);position(f,"guarded",6,"admit",{ownerApproval:true});
      expect(stored(f).adjudication_state).toBe("pending");
      f.db.prepare("UPDATE learned_influences SET influence_class='I3' WHERE id=?").run(f.id);
      position(f,"guarded",6);expect(stored(f).adjudication_state).toBe("pending");
      f.db.prepare("UPDATE learned_influences SET influence_class='I1' WHERE id=?").run(f.id);
      f.db.prepare("DELETE FROM interest_touches WHERE cycle_id='proposal1'").run();
      position(f,"guarded",6);expect(stored(f).adjudication_state).toBe("pending");
      expect(f.nuclear.prepare("SELECT total_changes() AS n").get()!.n).toBe(nuclearChanges);
    }finally{f.db.close();f.nuclear.close();}
  });
  it("keeps accepted branch reads pure and records stale basis only through explicit refresh",()=>{
    const f=fixture();try {
      admit(f.db,"current",5);position(f,"current",6);expect(stored(f).adjudication_state).toBe("accepted");
      f.db.prepare("DELETE FROM interest_touches WHERE cycle_id='proposal1'").run();
      const writes:string[]=[];
      for(const db of [f.db,f.nuclear]) {
        const prepare=db.prepare.bind(db),exec=db.exec.bind(db);
        vi.spyOn(db,"exec").mockImplementation(sql=>{writes.push(sql);return exec(sql);});
        vi.spyOn(db,"prepare").mockImplementation(sql=>{
          const statement=prepare(sql),run=statement.run.bind(statement);
          vi.spyOn(statement,"run").mockImplementation((...args)=>{writes.push(sql);return run(...args);});return statement;
        });
      }
      expect(readEligibility(f.db,f.id,{at:new Date(T+8)})).toBe(false);expect(writes).toEqual([]);
      expect(stored(f).contradiction_state).toBe("none");vi.restoreAllMocks();
      refreshEligibility(f.db,f.id,{at:new Date(T+8)});expect(stored(f).contradiction_state).toBe("owner_corrected");
    }finally{vi.restoreAllMocks();f.db.close();f.nuclear.close();}
  });
});
