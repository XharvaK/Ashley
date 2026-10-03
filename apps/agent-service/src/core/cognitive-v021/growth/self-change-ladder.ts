// The ladder records Owner decisions and safety drops; it never grants automatic merge authority.
import type {DatabaseSync} from "node:sqlite";
import {detectCredentialShape} from "../../privacy/secrets.js";
type FindingKind="accepted"|"BLOCKING"|"revert";
function text(value:string){if(typeof value!=="string" || !value.trim() || value.length>200 || detectCredentialShape(value).hit)throw new Error("self_change_ladder_input_invalid");}
export function readSelfChangeLadder(db:DatabaseSync){
 const row=db.prepare("SELECT level,revision FROM self_change_ladder WHERE id=1").get();
 if(!row)throw new Error("self_change_ladder_missing");
 return {level:Number(row.level),revision:Number(row.revision),automaticMerge:false as const,
  history:db.prepare("SELECT event_id,kind,actor,reference,from_level,to_level,revision,created_at_ms FROM self_change_ladder_history ORDER BY revision DESC LIMIT 20").all()};
}
function change(db:DatabaseSync,input:{eventId:string;kind:"owner_command"|"BLOCKING"|"revert";actor:string;reference:string;nowMs:number;level?:number;expectedRevision?:number}){
 for(const value of [input.eventId,input.actor,input.reference])text(value);
 if(!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("self_change_ladder_input_invalid");
 db.exec("SAVEPOINT self_change_ladder_change");
 try{
  const previous=db.prepare("SELECT * FROM self_change_ladder_history WHERE event_id=?").get(input.eventId);
  if(previous){
   if(previous.kind!==input.kind || previous.actor!==input.actor || previous.reference!==input.reference || (input.level!==undefined && previous.to_level!==input.level))throw new Error("self_change_ladder_event_conflict");
  }else{
   const current=readSelfChangeLadder(db);
   if(input.expectedRevision!==undefined && input.expectedRevision!==current.revision)throw new Error("self_change_ladder_revision_conflict");
   const level=input.level ?? Math.max(0,current.level-1),revision=current.revision+1;
   db.prepare("INSERT INTO self_change_ladder_history (event_id,kind,actor,reference,from_level,to_level,revision,created_at_ms) VALUES (?,?,?,?,?,?,?,?)")
    .run(input.eventId,input.kind,input.actor,input.reference,current.level,level,revision,input.nowMs);
   db.prepare("UPDATE self_change_ladder SET level=?,revision=? WHERE id=1").run(level,revision);
  }
  db.exec("RELEASE self_change_ladder_change");return readSelfChangeLadder(db);
 }catch(error){db.exec("ROLLBACK TO self_change_ladder_change; RELEASE self_change_ladder_change");throw error;}
}
/** Caller must establish Owner authority at the authenticated control boundary. */
export function commandSelfChangeLadder(db:DatabaseSync,input:{level:number;expectedRevision:number;commandId:string;actor:string;nowMs:number}){
 if(!Number.isInteger(input.level)||input.level<0||input.level>3||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new Error("self_change_ladder_input_invalid");
 return change(db,{...input,eventId:"owner:"+input.commandId,kind:"owner_command",reference:input.commandId});
}
/** An accepted result cannot earn a level; authenticated BLOCKING/revert observations drop once. */
export function recordSelfChangeLadderFinding(db:DatabaseSync,input:{eventId:string;kind:FindingKind;reference:string;nowMs:number;actor?:string}){
 if(input.kind==="accepted")return readSelfChangeLadder(db);
 if(input.kind!=="BLOCKING" && input.kind!=="revert")throw new Error("self_change_ladder_input_invalid");
 return change(db,{...input,kind:input.kind,eventId:"finding:"+input.eventId,actor:input.actor ?? "operator_observation"});
}
