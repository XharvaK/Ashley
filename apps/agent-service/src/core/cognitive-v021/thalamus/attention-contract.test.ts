// Attention must survive the actual semantic boundary, private projection and post-publication recovery.
import {describe,expect,it} from "vitest";
import type {ThoughtInput} from "../types.js";
import {openTestSidecar,admitTestCycle,makeThoughtDraft,makeSemanticSettlement} from "../test-support.js";
import {parseThoughtSemanticOutput} from "../thought/parse.js";
import {constrainThoughtOutputSchema,thoughtContractProfile,thoughtOutputDeepSeekJsonObjectInstruction} from "../thought/output-contract.js";
import {projectThoughtInput} from "../thought/projection.js";
import {buildThoughtInput} from "../thought/input.js";
import {buildAllocationCandidates} from "../thought/projection-allocator/sections.js";
import {publishSemanticTransaction} from "../settlement/publish.js";
import {validateThoughtSettlementDraft} from "../settlement/validate.js";
import {recordSettlementAftermath} from "../thought/aftermath.js";
import {applyV021Forget,planV021Forget,applyV021ForgetTargets} from "../memory/forget.js";
import {readAttentionWatches,readAttentionFlags,recordPublishedAttention} from "./store.js";
import type {OperationalEffectNamespace} from "../effect/effect-ref.js";
const T=100;
const watch={id:"fixture:watch",match:{source:"external",kind:"item",object:1,predicate:"eq"},action:"wake",expires:{atMs:1000},note:"A private authored attention note."};
const attention={watch:[watch],wakeWorth:"yes",resting:true};
function makeThoughtInput(overrides: Partial<ThoughtInput> = {}): ThoughtInput {
  return {
    cycleId: "cycle-1",
    generation: 1,
    occupantId: "occupant-1",
    authorityEpoch: 1,
    trigger: { kind: "owner_message", ref: "msg-1" },
    rawConversation: [],
    workingContext: [],
    occupancy: [],
    constitution: { constitutional: [], stableSelf: [] },
    learnedSelfSlice: { dispositions: [], interests: [] },
    capabilityReality: {
      vision: false,
      attachmentText: false,
      conversationalRead: false,
      webSearch: false,
      canOfferProjectInspection: false,
      canOfferWorkspace: false,
      canOfferVerification: false,
      canOfferAuthorship: false,
      canOfferBoundedOperation: false,
      canOfferInquiry: false,
      canOfferPatchExport: false,
      approvedProjectIds: [],
    },
    observations: [],
    retrieval: {
      request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
      hits: [],
      state: "ready",
      miss: true,
    },
    inFlight: [],
    authorityObjections: [],
    runtimeCondition: { fallback: false, compression: false, lookupFailed: false, thoughtUnavailable: false },
    rememberDirective: null,
    ...overrides,
  };
}


describe("T3 attention contract wiring",()=>{
 it("accepts bounded structured attention in semantic settlement and rejects malformed claims",()=>{
  const parse=(value:unknown)=>parseThoughtSemanticOutput({...makeSemanticSettlement({speech:{mode:"none"},commitments:{}}),attention:value},new Set());
  expect(parse(attention)).toMatchObject({ok:true,value:{attention}});
  for(const invalid of [{resting:"true"},{wakeWorth:"maybe"},{watch:[{...watch,note:"x".repeat(201)}]},{watch:[...Array(5)].map((_,i)=>({...watch,id:String(i)}))}])expect(parse(invalid).ok).toBe(false);
 });
 it("offers private attention and only wake value in social profiles",()=>{
  const namespace={allowedOperationalEffectRefs:[],fingerprint:"sha256:fixture"} as unknown as OperationalEffectNamespace;
  const owner=thoughtContractProfile({trigger:{kind:"owner_message"}});
  const social=thoughtContractProfile({trigger:{kind:"external_message"},audience:{kind:"room"}});
  const fields=(profile:typeof owner)=>(constrainThoughtOutputSchema(namespace,profile).schema as any).oneOf[0].properties;
  expect(fields(owner).attention).toBeDefined();expect(Object.keys(fields(social).attention.properties)).toEqual(["wakeWorth"]);
  expect(fields(owner).attention.properties.watch.maxItems).toBe(4);
  expect(fields(owner).attention.description).toContain("attention is your private attention");
  expect(thoughtOutputDeepSeekJsonObjectInstruction()).toContain("attention is your private attention");
  expect(thoughtOutputDeepSeekJsonObjectInstruction()).toContain("expires:{atMs:integer>=0}|{event:");
 });
 it("retains attention in the model-visible projection and required allocator section",()=>{
  const input=makeThoughtInput({attention:{watching:[watch],wokeBecause:[],alsoOnYourMind:[]}} as any);
  expect(projectThoughtInput(input,[]).projected.attention).toEqual(input.attention);
  const section=buildAllocationCandidates(input,[]).find(candidate=>candidate.section==="attention");
  expect(section).toMatchObject({required:true,data:input.attention});
 });
 it("assembles attention only for the effective Owner-private audience",()=>{
  const db=openTestSidecar();try{
   const cycle=admitTestCycle(db,{cycleId:"input-cycle",conversationId:"fixture:owner",generation:1,triggerKind:"owner_message",triggerRef:"fixture:input",nowMs:T});
   const fixture=makeThoughtInput();const value={watching:[watch],wokeBecause:[],alsoOnYourMind:[]} as any;
   const options={sidecar:db,cycle,triggerText:"",constitution:{constitutional:["truth first"],stableSelf:["curious"]},capabilityReality:fixture.capabilityReality,workingContext:[],occupancy:[],learnedSelfSlice:fixture.learnedSelfSlice,attention:value};
   expect(buildThoughtInput({...options,audience:{kind:"owner_private"}}).attention).toEqual(value);
   expect(buildThoughtInput({...options,audience:{kind:"room",roomId:"fixture:room"}}).attention).toBeUndefined();
  }finally{db.close();}
 });
 it("uses the publication audience instead of the Discord conversation prefix",()=>{
  for(const ownerPrivate of [true,false]){
   const db=openTestSidecar();try{
    admitTestCycle(db,{cycleId:"audience-cycle",conversationId:"dm:owner",generation:1,triggerKind:"idle_opportunity",triggerRef:"fixture:audience",nowMs:T});
    const draft=makeThoughtDraft({cycleId:"audience-cycle",generation:1});
    const settlement={...draft,sawSecret:false,settlementId:"audience-settlement",speech:{...draft.speech,finalLicensedText:null},attention};
    expect(publishSemanticTransaction(db,settlement as any,{nowMs:T,triggerKind:"idle_opportunity",aftermath:{conversationId:"dm:owner",ownerPrivate,passKind:null,nightPass:null}}).published).toBe(true);
    expect(recordPublishedAttention(db,"audience-settlement","fixture:owner",T)).toBe(ownerPrivate?"recorded":"ignored");
    expect(readAttentionWatches(db,"fixture:owner",T)).toHaveLength(ownerPrivate?1:0);
   }finally{db.close();}
  }
 });
 it("validates attention again at the host settlement draft boundary",()=>{
  const draft=makeThoughtDraft();expect(validateThoughtSettlementDraft({...draft,attention:{resting:"malformed"}}).ok).toBe(false);
  expect(validateThoughtSettlementDraft({...draft,attention})).toMatchObject({ok:true});
 });
 it("recovers private published attention once without losing the authored note",()=>{
  const db=openTestSidecar();try{
   admitTestCycle(db,{cycleId:"cycle-attention",conversationId:"fixture:owner",generation:1,triggerKind:"idle_opportunity",triggerRef:"fixture:attention",nowMs:T});
   const draft=makeThoughtDraft({cycleId:"cycle-attention",generation:1});
   const settlement={...draft,sawSecret:false,settlementId:"settlement-attention",speech:{...draft.speech,finalLicensedText:null},attention};
   expect(publishSemanticTransaction(db,settlement as any,{nowMs:T,triggerKind:"idle_opportunity",aftermath:{conversationId:"fixture:owner",passKind:null,nightPass:null}}).published).toBe(true);
   const options={identityStore:{ownerId:"fixture:owner",nuclear:db},timeZone:"UTC",nowMs:T};
   expect(recordSettlementAftermath(db,"settlement-attention",options)).toBe("recorded");
   expect(readAttentionWatches(db,"fixture:owner",T)).toEqual([watch]);expect(readAttentionFlags(db,"fixture:owner")).toMatchObject({resting:true,wakeWorth:"yes"});
   expect(recordSettlementAftermath(db,"settlement-attention",options)).toBe("not_pending");expect(readAttentionWatches(db,"fixture:owner",T)).toHaveLength(1);
  }finally{db.close();}
 });
 it("forgets authored attention in direct and preview-confirmed erasure paths",()=>{
  for(const planned of [false,true]){
   const db=openTestSidecar();try{
    admitTestCycle(db,{cycleId:"forget-cycle",conversationId:"fixture:owner",generation:1,triggerKind:"idle_opportunity",triggerRef:"fixture:forget",nowMs:T});
    db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES ('forget-settlement','forget-cycle',1,?)").run(JSON.stringify({sawSecret:false,attention}));
    recordPublishedAttention(db,"forget-settlement","fixture:owner",T);
    if(planned){const plan=planV021Forget(db,{topic:"authored attention note"});expect(plan.targets.some(t=>t.entityType==="v021_attention_watch")).toBe(true);applyV021ForgetTargets(db,plan.targets,{nowMs:T+1});}
    else applyV021Forget(db,{topic:"authored attention note",nowMs:T+1});
    expect(readAttentionWatches(db,"fixture:owner",T+1)).toEqual([]);
    expect(readAttentionFlags(db,"fixture:owner").resting).toBeUndefined();
    expect(recordPublishedAttention(db,"forget-settlement","fixture:owner",T+2)).toBe("ignored");
   }finally{db.close();}
  }
 });

});
