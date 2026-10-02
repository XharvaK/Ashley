import { config } from "../config.js";
import {
  initiativeStatus,
  pauseProactiveRemote,
  resumeProactiveRemote,
  tickCognitiveIdle,
  checkHealth,
  initiativeScheduler,
  acknowledgeInitiativeScheduler,
  type InitiativeSchedulerContract,
} from "../agent-client.js";

let cognitiveIdleTimer: ReturnType<typeof setInterval> | null = null;
let cognitiveIdleRunning = false;
let handoffTimer:ReturnType<typeof setInterval>|null=null;
let handoffRunning=false;
let schedulerOwner:"bot"|"thalamus"|"unknown"="unknown";
let handoffGeneration=0;
const SCHEDULER_CONTRACT_VERSION=1;
const SCHEDULER_POLL_MS=60_000;

/** Apply only a recognized host contract; network errors never guess a new owner. */
export async function reconcileSchedulerOwnership(deps:{
  read?:()=>Promise<InitiativeSchedulerContract>;start?:()=>void;stop?:()=>void;
  active?:()=>boolean;ack?:(contract:InitiativeSchedulerContract,active:boolean)=>Promise<void>;
  current?:()=>boolean;
  botUserId?:string;
}={}):Promise<"bot"|"thalamus"|"unknown">{
 try{
  const contract=await (deps.read ?? initiativeScheduler)();
  if(deps.current && !deps.current())return "unknown";
  if(contract.contractVersion!==SCHEDULER_CONTRACT_VERSION || !["bot","thalamus"].includes(contract.owner))return "unknown";
  if(contract.owner==="bot")(deps.start ?? startCognitiveIdleScheduler)();
  else (deps.stop ?? stopCognitiveIdleScheduler)();
  schedulerOwner=contract.owner;
  const active=(deps.active ?? (()=>cognitiveIdleTimer!==null))();
  if(deps.ack)await deps.ack(contract,active);
  else await acknowledgeInitiativeScheduler(contract,active,deps.botUserId);
  return contract.owner;
 }catch{return "unknown";}
}
export function startSchedulerHandoff(botUserId?:string):void{
 if(handoffTimer)return;
 const generation=++handoffGeneration;
 stopCognitiveIdleScheduler();
 const poll=async()=>{if(handoffRunning)return;handoffRunning=true;try{await reconcileSchedulerOwnership({current:()=>generation===handoffGeneration,botUserId});}finally{handoffRunning=false;}};
 void poll();handoffTimer=setInterval(()=>{void poll();},SCHEDULER_POLL_MS);
}

export type CognitiveIdleSchedulerCycleResult = {
  outcome: "tick" | "not_ready" | "error";
  result?: Awaited<ReturnType<typeof tickCognitiveIdle>>;
};

/** One private cognition tick. It never sends a Discord message directly. */
export async function runCognitiveIdleSchedulerCycle(
  tick: typeof tickCognitiveIdle = tickCognitiveIdle,
  health: typeof checkHealth = checkHealth,
): Promise<CognitiveIdleSchedulerCycleResult> {
  try {
    if (!(await health())) return { outcome: "not_ready" };
    return { outcome: "tick", result: await tick() };
  } catch {
    return { outcome: "error" };
  }
}

/** Start the current V0.2.1 idle wake scheduler. */
export function startCognitiveIdleScheduler(): void {
  if (cognitiveIdleTimer) return;
  const intervalMs = config.proactiveCheckIntervalMin * 60 * 1000;
  const tick = async (): Promise<void> => {
    if (cognitiveIdleRunning) return;
    cognitiveIdleRunning = true;
    try {
      const cycle = await runCognitiveIdleSchedulerCycle();
      if (cycle.outcome === "tick" && cycle.result?.reason) {
        console.log(`[discord-bot] cognitive idle: ${cycle.result.reason}`);
      } else if (cycle.outcome === "error") {
        console.warn("[discord-bot] cognitive idle tick failed");
      }
    } finally {
      cognitiveIdleRunning = false;
    }
  };
  console.log(`[discord-bot] cognitive idle scheduler every ~${config.proactiveCheckIntervalMin}m`);
  void tick();
  cognitiveIdleTimer = setInterval(() => { void tick(); }, intervalMs);
}

function stopCognitiveIdleScheduler(): void {
  if (cognitiveIdleTimer) clearInterval(cognitiveIdleTimer);
  cognitiveIdleTimer = null;
}
export function stopProactiveScheduler():void{
 handoffGeneration++;
 if(handoffTimer)clearInterval(handoffTimer);handoffTimer=null;
 stopCognitiveIdleScheduler();schedulerOwner="unknown";
}

export type CognitiveIdleSchedulerStatus = {
  active: boolean;
  running: boolean;
  cadenceMinutes: number;
  owner?:"bot"|"thalamus"|"unknown";
};

export function getCognitiveIdleSchedulerStatus(): CognitiveIdleSchedulerStatus {
  return {
    active: cognitiveIdleTimer !== null,
    running: cognitiveIdleRunning,
    cadenceMinutes: config.proactiveCheckIntervalMin,
    owner:schedulerOwner,
  };
}

export async function pauseProactive(): Promise<void> {
  await pauseProactiveRemote();
}

export async function resumeProactive(): Promise<void> {
  await resumeProactiveRemote();
}

export async function getProactiveStatus() {
  return initiativeStatus();
}
