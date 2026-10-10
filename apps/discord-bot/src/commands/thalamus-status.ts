import type {ThalamusStatus} from "../agent-client.js";
/** Timing proposals are evidence of arbitration, never evidence of execution or delivery. */
export function renderThalamusStatus(status?:ThalamusStatus):string {
 if(!status)return "Timing: unavailable";
 const header=`Timing watches: ${status.availability==="available" ? status.watchCount ?? "unknown" : "unavailable"}`;
 if(status.availability!=="available")return `${header}\nLast timing decision: unavailable`;
 const decision=status.lastDecision;
 if(!decision)return `${header}\nLast timing decision: none yet`;
 const at=Number.isSafeInteger(decision.atMs) && decision.atMs>=0 && decision.atMs<=8.64e15 ? new Date(decision.atMs).toISOString() : "unknown time";
 const pass=decision.passType ? `${decision.passType} pass` : "no pass";
 return `${header}\nLast timing decision: ${decision.code} (${decision.reason}), ${pass}, ${at}`;
}
