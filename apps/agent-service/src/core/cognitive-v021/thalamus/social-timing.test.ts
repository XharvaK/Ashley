import {DatabaseSync} from "node:sqlite";
import {describe,it,expect} from "vitest";
import {openNuclearDb} from "../../db.js";
import {openTestSidecar} from "../test-support.js";
import {grantPerson} from "../../relationship/social-authority.js";
import {admitExternalCapture,admitExternalBatch} from "../ingress/http.js";
import {promoteEligiblePending} from "../social/dm-activation.js";
import {appendAshleyEvidence} from "../evidence/conversation-log.js";
import {observeGatewayUserId} from "./scheduler.js";
import {addressedToHer,ROOM_ADDRESS} from "./social-timing.js";
import {arbitrate,type ThalamusState} from "./core.js";
import {social} from "./nuclei/social.js";
const T=Date.parse("2026-10-02T12:00:00Z"),ownerId="owner",principalId="person";
function fixture(){
 const db=openTestSidecar(),nuclear=openNuclearDb(new DatabaseSync(":memory:"));
 grantPerson(nuclear,{ownerId,principalId,scope:"dm_only",sourceSpan:{source:"fixture"},nowMs:T});
 const captured=admitExternalCapture(db,nuclear,{envelope:{speakerPrincipalId:principalId,speakerKind:"external_human",location:{kind:"external_dm",principalId,channelId:"dm-person"},audienceAtCapture:"unknown",sentAtMs:T,discordMessageId:"capture",mentionIds:[],attachmentRefs:[],provenance:{source:"discord",receivedAtMs:T}},message:"private contact message",discordMessageId:"capture",attachments:[],gateHint:"capture_quarantine",conversationKey:"dm:ashley:person"},{nowMs:T});
 admitExternalBatch(db,nuclear,{captureRefs:[captured.captureRef],conversationKey:captured.conversationKey},{nowMs:T,ownerId});
 return {db,nuclear};
}
const env={RA_DM_PRINCIPAL:principalId,RA_DM_COGNITION:"true"};
describe("social timing wraps existing admission",()=>{
 it("a timing hold retains the eligible marker without creating a cycle",()=>{
  const {db,nuclear}=fixture();try{
   const result=promoteEligiblePending(db,nuclear,{nowMs:T,ownerId,env,timing:{beforePromotion:()=>false,afterPromotion:()=>{throw new Error("must not promote");}}} as any);
   expect(result.promoted).toBe(0);expect(db.prepare("SELECT count(*) AS n FROM cycle_records").get()!.n).toBe(0);
   expect(db.prepare("SELECT state FROM inbox_events WHERE kind='external_eligible_pending'").get()!.state).toBe("pending");
  }finally{db.close();nuclear.close();}
 });
 it("binds a contact timing decision only to its actual social admission",async()=>{
  const module=await import("./social-timing.js").catch(()=>null);expect(module,"social timing hooks must exist").not.toBeNull();
  const {db,nuclear}=fixture();try{
   const timing=module!.createSocialTimingHooks(db,{ownerId,ownerConversationId:"owner-private",nowMs:T,context:{budgetAvailable:true,conversationClaimHeld:false,spentFraction:0,energy:.5,tension:0,circadianPhase:0},resourceAvailable:()=>true});
   const result=promoteEligiblePending(db,nuclear,{nowMs:T,ownerId,env,timing} as any);
   expect(result).toMatchObject({promoted:1,rejected:0});
   expect(db.prepare("SELECT cycle_id,pass_type FROM thalamus_decisions").get()).toMatchObject({cycle_id:result.cycleIds[0],pass_type:"conversation"});
   expect(db.prepare("SELECT occupant_id,trigger_kind FROM cycle_records").get()).toMatchObject({occupant_id:null,trigger_kind:"external_message"});
  }finally{db.close();nuclear.close();}
 });
 it("Owner conversation hold retains a contact knock and its unbound timing receipt",async()=>{
  const {createSocialTimingHooks}=await import("./social-timing.js");const {db,nuclear}=fixture();try{
   const timing=createSocialTimingHooks(db,{ownerId,ownerConversationId:"owner-private",nowMs:T,context:{budgetAvailable:true,conversationClaimHeld:true,spentFraction:0,energy:.5,tension:0,circadianPhase:0},resourceAvailable:()=>true});
   const result=promoteEligiblePending(db,nuclear,{nowMs:T,ownerId,env,timing});
   expect(result.promoted).toBe(0);expect(db.prepare("SELECT cycle_id,reason_code FROM thalamus_decisions").get()).toMatchObject({cycle_id:null,reason_code:"conversation"});
   expect(db.prepare("SELECT state FROM inbox_events WHERE kind='external_eligible_pending'").get()!.state).toBe("pending");
  }finally{db.close();nuclear.close();}
 });

 it("uses the social resource owner rather than borrowing private Thought budget permission",async()=>{
  const {createSocialTimingHooks}=await import("./social-timing.js");const {db,nuclear}=fixture();try{
   const timing=createSocialTimingHooks(db,{ownerId,ownerConversationId:"owner-private",nowMs:T,context:{budgetAvailable:false,conversationClaimHeld:false,spentFraction:1,energy:.5,tension:0,circadianPhase:0},resourceAvailable:()=>true});
   expect(promoteEligiblePending(db,nuclear,{nowMs:T,ownerId,env,timing}).promoted).toBe(1);
  }finally{db.close();nuclear.close();}
 });

 it("grades how much a room message is meant for her",()=>{
  const db=openTestSidecar();try{
   const room="room:g:c",self="1234567890123456";observeGatewayUserId(self);
   const msg=(text:string,extra:Record<string,unknown>={})=>({markerId:"m",conversationId:room,kind:"room" as const,
    evidence:{rowId:"r",text,createdAtMs:T,mentionIds:[],replyToMessageId:null,...extra} as any});
   expect(addressedToHer(db,{...msg("hi"),kind:"dm"},T)).toBe(ROOM_ADDRESS.direct);
   expect(addressedToHer(db,msg("hey you",{mentionIds:[self]}),T)).toBe(ROOM_ADDRESS.direct);
   expect(addressedToHer(db,msg("what do you think, Ashley?"),T)).toBe(ROOM_ADDRESS.name);
   expect(addressedToHer(db,msg("ashleys are nice"),T)).toBe(ROOM_ADDRESS.ambient);
   expect(addressedToHer(db,msg("anyone up for pizza"),T)).toBe(ROOM_ADDRESS.ambient);
   appendAshleyEvidence(db,{conversationId:room,text:"I'd go for pizza",discordMessageIds:["her-1"],nowMs:T-60_000});
   expect(addressedToHer(db,msg("haha same"),T)).toBe(ROOM_ADDRESS.inConversation);
   expect(addressedToHer(db,msg("later",{createdAtMs:T+ROOM_ADDRESS.inConversationMs}),T)).toBe(ROOM_ADDRESS.ambient);
   expect(addressedToHer(db,msg("later",{createdAtMs:T+ROOM_ADDRESS.inConversationMs,replyToMessageId:"her-1"}),T)).toBe(ROOM_ADDRESS.direct);
   // Alone ambient chatter stays under the threshold; a direct or in-conversation message does not.
   expect(ROOM_ADDRESS.ambient).toBeLessThan(0.5);expect(ROOM_ADDRESS.inConversation).toBeGreaterThan(0.5);
  }finally{db.close();}
 });

 it("one ambient line stays quiet; a lively room wakes her",()=>{
  const context={budgetAvailable:true,conversationClaimHeld:false,spentFraction:0,energy:.5,tension:0,circadianPhase:0};
  const line=(i:number)=>social({eventId:`m${i}`,observedAtMs:T+i*10_000,refs:[`r${i}`],coalesceKey:"room:g:c",isOwner:false,eligible:true,
   fuseAvailable:true,relationshipBasis:1,addressedToHer:ROOM_ADDRESS.ambient,novelty:1})!;
  let state:ThalamusState={lastNowMs:T,families:{},lastSelectedAtMs:{}};
  const one=arbitrate(state,[line(0)],T,context);expect(one.decision.kind).toBe("none");
  state=one.state;let fired=false;
  for(const i of [1,2,3]){const r=arbitrate(state,[line(i)],T+i*10_000,context);state=r.state;if(r.decision.kind==="fire"){fired=true;break;}}
  expect(fired).toBe(true);
 });

});
