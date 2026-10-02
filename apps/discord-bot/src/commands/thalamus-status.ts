import type {ThalamusStatus} from "../agent-client.js";
/** Timing proposals are evidence of arbitration, never evidence of execution or delivery. */
export function renderThalamusStatus(status?:ThalamusStatus):string {
 if(!status)return "Thalamus: unavailable";
 const header=`Thalamus: ${status.owner}; contract: ${status.contractVersion}; watches: ${status.availability==="available" ? status.watchCount ?? "unknown" : "unavailable"}`;
 if(status.availability!=="available")return `${header}\nTiming decision: unavailable`;
 const decision=status.lastDecision;
 if(!decision)return `${header}\nTiming decision: none`;
 const at=Number.isSafeInteger(decision.atMs) && decision.atMs>=0 && decision.atMs<=8.64e15 ? new Date(decision.atMs).toISOString() : "unknown";
 return `${header}\nTiming decision: ${decision.code} (${decision.reason}); pass: ${decision.passType ?? "none"}; at: ${at}`;
}
