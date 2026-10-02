import type {IdleThoughtRunner,IdleObservationDraft,IdleThoughtContext} from "../initiative/idle.js";
import type {DatabaseSync} from "node:sqlite";
import {persistOrVerifyObservations,canonicalObservation,observationBindingHash} from "../observation/persistence.js";
import {PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE} from "../types.js";
export type SelectedPassExecution = {timing:"thalamus";bind:(cycleId:string)=>void;observations?:readonly IdleObservationDraft[]};
/** The executor retains admission and budget ownership; only an actual admission binds a proposal. */
export function bindAdmittedCause(runner:IdleThoughtRunner,bind:(cycleId:string)=>void):IdleThoughtRunner {
 return input=>{bind(input.cycle.cycleId);return runner(input);};
}
/** Add compatible observations only after existing admission, without changing the inner-pass contract. */
export function attachSelectedObservations(db:DatabaseSync,input:IdleThoughtContext,extra:readonly IdleObservationDraft[]):IdleThoughtContext {
 if(!extra.length)return input;
 if(extra.length>PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE)throw new Error("thalamus_observation_limit");
 const {cycle,event}=input;
 if(event && (event.conversationId!==cycle.conversationId || (event.payload as Record<string,unknown>)?.cycleId!==cycle.cycleId))throw new Error("thalamus_observation_event_identity");
 const stored=db.prepare("SELECT conversation_id,generation FROM cycle_records WHERE cycle_id=?").get(cycle.cycleId);
 if(!stored || stored.conversation_id!==cycle.conversationId || Number(stored.generation)!==cycle.generation)throw new Error("thalamus_observation_cycle_identity");
 const merged=new Map(input.observations.map(observation=>[observation.observationId,observation]));
 for(const draft of extra){
  const observation={...draft,cycleId:cycle.cycleId,generation:cycle.generation},existing=merged.get(observation.observationId);
  const hash=(value:typeof observation)=>observationBindingHash({observationIds:[value.observationId],observations:[canonicalObservation(value)]});
  if(existing && hash(existing)!==hash(observation))throw new Error("thalamus_observation_binding_conflict");
  if(!existing)merged.set(observation.observationId,observation);
 }
 const observations=[...merged.values()];
 db.exec("SAVEPOINT thalamus_observation_attachment");
 try{
  persistOrVerifyObservations(db,observations,cycle.admittedAtMs);
  let nextEvent=event;
  if(event){
   const row=db.prepare("SELECT payload_json FROM inbox_events WHERE id=? AND conversation_id=? AND state='pending' AND status='pending'").get(event.id,cycle.conversationId);
   if(!row)throw new Error("thalamus_observation_event_identity");
   const original=JSON.parse(String(row.payload_json)) as Record<string,unknown>;
   if(original.cycleId!==cycle.cycleId)throw new Error("thalamus_observation_event_identity");
   const payload={...original,observations};
   db.prepare("UPDATE inbox_events SET payload_json=? WHERE id=?").run(JSON.stringify(payload),event.id);
   nextEvent={...event,payload};
  }
  db.exec("RELEASE thalamus_observation_attachment");return {...input,observations,event:nextEvent};
 }catch(error){db.exec("ROLLBACK TO thalamus_observation_attachment; RELEASE thalamus_observation_attachment");throw error;}
}
