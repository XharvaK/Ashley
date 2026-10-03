// Ladder history records authority changes without supplying automatic merge permission.
import {it,expect} from "vitest";
import {openTestSidecar} from "../test-support.js";
const module=await import("./self-change-ladder.js").catch(()=>({})) as typeof import("./self-change-ladder.js");
function api(){expect(typeof module.readSelfChangeLadder).toBe("function");return module;}
it("starts at L1 and does not earn levels from successful results",()=>{
 const port=api(),db=openTestSidecar();try{
  expect(port.readSelfChangeLadder(db)).toMatchObject({level:1,revision:0,automaticMerge:false});
  expect(port.recordSelfChangeLadderFinding(db,{eventId:"accepted",kind:"accepted",reference:"cs_fixture",nowMs:1})).toMatchObject({level:1,revision:0});
 }finally{db.close();}
});
it("records Owner commands and one drop per attributable finding with an L0 floor",()=>{
 const port=api(),db=openTestSidecar();try{
  port.commandSelfChangeLadder(db,{level:2,expectedRevision:0,commandId:"owner:1",actor:"owner",nowMs:1});
  expect(port.recordSelfChangeLadderFinding(db,{eventId:"finding:1",kind:"BLOCKING",reference:"cs_fixture",nowMs:2})).toMatchObject({level:1,revision:2,automaticMerge:false});
  expect(port.recordSelfChangeLadderFinding(db,{eventId:"finding:1",kind:"BLOCKING",reference:"cs_fixture",nowMs:3})).toMatchObject({level:1,revision:2});
  expect(port.recordSelfChangeLadderFinding(db,{eventId:"finding:2",kind:"revert",reference:"cs_fixture",nowMs:4})).toMatchObject({level:0,revision:3});
  expect(port.recordSelfChangeLadderFinding(db,{eventId:"finding:3",kind:"BLOCKING",reference:"cs_other",nowMs:5})).toMatchObject({level:0,revision:4});
  expect(()=>port.commandSelfChangeLadder(db,{level:3,expectedRevision:0,commandId:"stale",actor:"owner",nowMs:6})).toThrow("self_change_ladder_revision_conflict");
  expect(port.readSelfChangeLadder(db).history).toHaveLength(4);
 }finally{db.close();}
});
it("shows the current ladder as a private factual sense",async()=>{
 const port=api(),db=openTestSidecar();try{
  port.recordSelfChangeLadderFinding(db,{eventId:"reverted",kind:"revert",reference:"cs_fixture",nowMs:1});
  const {sensesForThought}=await import("../senses/senses.js");
  expect(sensesForThought(db,{ownerId:"owner",conversationId:"fixture",nowMs:2}).lines).toContain("self-change: L0; automatic merge unavailable; Owner approval required");
 }finally{db.close();}
});

it("L0 refuses a new declared self-change opportunity without affecting ordinary work",async()=>{
 const port=api(),db=openTestSidecar();try{
  port.recordSelfChangeLadderFinding(db,{eventId:"blocking",kind:"BLOCKING",reference:"cs_fixture",nowMs:1});
  const {selfChangeOpportunityPolicy}=await import("./self-change.js");
  expect(selfChangeOpportunityPolicy(db,{conversationId:"fixture",nowMs:2,dueTriggers:[{payload:{budgetPolicyId:"ashley.self_change.v1"}} as any]})).toEqual({kind:"refused",reason:"self_change_ladder_l0"});
  expect(selfChangeOpportunityPolicy(db,{conversationId:"fixture",nowMs:2,dueTriggers:[]})).toEqual({kind:"ordinary"});
 }finally{db.close();}
});
