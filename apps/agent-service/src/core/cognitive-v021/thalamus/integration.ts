import type {DatabaseSync} from "node:sqlite";
import {tick,type TickOptions} from "./tick.js";
import type {SelectedPassExecution} from "./execution.js";
type Selection={triggerId?:string;commitmentId?:string};
type Executor=(selected:SelectedPassExecution)=>Promise<unknown>;
export type PassExecutors={afterglow:Executor;night:Executor;awake:Executor;
 selfChangeResult?:(changesetId:string,selected:SelectedPassExecution)=>Promise<unknown>;
 idle:(selection:Selection,selected:SelectedPassExecution)=>Promise<unknown>};
/** Dispatch one selected pass. Coalesced timing proposals do not mature extra obligations. */
export function runThalamusPass(db:DatabaseSync,options:Omit<TickOptions,"execute"> & {executors:PassExecutors;
 prepare?:(decision:Extract<import("./core.js").Decision,{kind:"fire"}>,selected:SelectedPassExecution)=>SelectedPassExecution}){
 return tick(db,{...options,execute:async(decision,bind)=>{
  const initial={timing:"thalamus" as const,bind};
  const selected=options.prepare?.(decision,initial) ?? initial;
  if(decision.passType==="afterglow")return options.executors.afterglow(selected);
  if(decision.passType==="night")return options.executors.night(selected);
  const first=decision.bundle[0]!;
  if(first.source==="prospective"){
   if(first.eventId.startsWith("self-result:")){
    if(!options.executors.selfChangeResult)throw new Error("thalamus_self_change_executor_required");
    return options.executors.selfChangeResult(first.eventId.slice(12),selected);
   }
   const selection:Selection=first.eventId.startsWith("trigger:")?{triggerId:first.eventId.slice(8)}
    :first.eventId.startsWith("commitment:")?{commitmentId:first.eventId.slice(11)}:{};
   return options.executors.idle(selection,selected);
  }
  if(first.source==="external")return options.executors.idle({},selected);
  if(decision.passType==="conversation")throw new Error("thalamus_social_executor_required");
  return options.executors.awake(selected);
 }});
}
