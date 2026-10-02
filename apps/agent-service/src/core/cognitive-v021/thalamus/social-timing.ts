import type {DatabaseSync} from "node:sqlite";
import type {ConversationEvidenceRecord} from "../types.js";
import type {ThalamusContext} from "./core.js";
import {prepareTick} from "./tick.js";
import {social} from "./nuclei/social.js";
import {getCurrentCycle} from "../cycle/inbox.js";
import {isPrivateThoughtActive} from "../initiative/idle.js";
import {currentGatewayUserId} from "./scheduler.js";
import {THALAMUS_PARAMETERS as P} from "./parameters.js";
export type SocialTimingInput={markerId:string;conversationId:string;evidence:ConversationEvidenceRecord;kind:"dm"|"room"};
export type SocialTimingHooks={beforePromotion:(input:SocialTimingInput)=>boolean;afterPromotion:(input:SocialTimingInput & {cycleId:string})=>void};
/** Existing social eligibility calls these hooks only after its current grant checks. */
export function createSocialTimingHooks(db:DatabaseSync,options:{ownerId:string;ownerConversationId:string;nowMs:number;context:ThalamusContext;
 resourceAvailable:(input:SocialTimingInput)=>boolean}):SocialTimingHooks {
 const selected=new Map<string,ReturnType<typeof prepareTick>>();let admitted=false;
 return {
  beforePromotion(input){
   if(input.evidence.speakerPrincipalId===options.ownerId)return false;
   // Fresh messages in an existing live conversation keep their normal absorption/fence path.
   if(getCurrentCycle(db,input.conversationId,{includeIdle:false}))return true;
   if(admitted)return false;
   const gateway=currentGatewayUserId();
   const reply=input.evidence.replyToMessageId && db.prepare(`SELECT e.row_id FROM conversation_evidence_discord_ids d
    JOIN conversation_evidence_log e ON e.lineage_id=d.lineage_id WHERE d.discord_message_id=? AND e.role='ashley' AND e.conversation_id=? LIMIT 1`).get(input.evidence.replyToMessageId,input.conversationId);
   const addressed=input.kind==="dm" || Boolean(gateway && input.evidence.mentionIds?.includes(gateway)) || Boolean(reply);
   // There is no current numeric relationship-strength owner. Keep its old admission amplitude neutral.
   const candidate=social({eventId:input.markerId,observedAtMs:input.evidence.createdAtMs,refs:[input.evidence.rowId],coalesceKey:input.conversationId,
    isOwner:false,eligible:true,fuseAvailable:options.resourceAvailable(input),relationshipBasis:P.nucleusGain.default,addressedToHer:addressed?1:0,novelty:1});
   const context={...options.context,conversationClaimHeld:options.context.conversationClaimHeld
    || getCurrentCycle(db,options.ownerConversationId)!==null || isPrivateThoughtActive(options.ownerConversationId)};
   const prepared=prepareTick(db,{ownerId:options.ownerId,conversationId:input.conversationId,nowMs:options.nowMs,enabled:true,socialBinding:true,
    candidates:candidate?[candidate]:[],facts:[{eventId:input.markerId,source:"social",kind:"message",subject:input.evidence.speakerPrincipalId ?? "unknown",object:input.conversationId}],context});
   selected.set(input.markerId,prepared);return prepared.kind==="prepared" && prepared.decision.kind==="fire";
  },
  afterPromotion(input){
   const prepared=selected.get(input.markerId);
   if(prepared?.kind==="prepared" && prepared.decision.kind==="fire"){prepared.bind(input.cycleId);admitted=true;}
  },
 };
}
