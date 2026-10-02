import {describe,expect,it,vi} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {tickAwake,awakePassFromPayload} from "../initiative/awake.js";
import {tickNight,nightPassFromPayload} from "../initiative/night.js";
import type {IdleThoughtRunner} from "../initiative/idle.js";
import {tickAfterglow,afterglowPassFromPayload} from "../initiative/afterglow.js";
import {appendOwnerUtterance} from "../evidence/conversation-log.js";
const T=Date.UTC(2026,9,1,12);
describe("T4 selected pass execution",()=>{
 it("executes selected reflection pressure with exact row coverage and preserves the quiet pause",async()=>{
  const db=openTestSidecar();try{
   const thought=vi.fn<IdleThoughtRunner>(async()=>({published:true,acceptedSettlements:1,thoughtModelAttempts:1}));
   appendOwnerUtterance(db,{conversationId:"fixture:owner",text:"fixture private conversation",nowMs:T,audienceAtCapture:"owner_private"});
   const options={conversationId:"fixture:owner",occupantId:"owner",authorityEpoch:1,nowMs:T+1,thought,timing:"thalamus"};
   expect(await tickAfterglow(db,options as any)).toMatchObject({outcome:"not_due"});
   expect(await tickAfterglow(db,{...options,nowMs:T+5*60_000} as any)).toMatchObject({outcome:"ran",coveredRows:1});
   expect(afterglowPassFromPayload(thought.mock.calls[0]![0].event?.payload)).toMatchObject({kind:"afterglow",mode:"silence",rowIds:expect.any(Array)});
   expect(thought.mock.calls[0]![0].privateBudgetReservation.state).toBe("held");
  }finally{db.close();}
 });
 it("executes a selected AWAKE before its legacy timer while preserving admission and payload",async()=>{
  const db=openTestSidecar();try{
   const thought=vi.fn<IdleThoughtRunner>(async()=>({published:true,acceptedSettlements:1,thoughtModelAttempts:1}));
   const options={conversationId:"fixture:owner",occupantId:"owner",authorityEpoch:1,nowMs:T,thought};
   expect(await tickAwake(db,options)).toMatchObject({outcome:"scheduled"});
   expect(await tickAwake(db,{...options,nowMs:T+1,timing:"thalamus"} as any)).toMatchObject({outcome:"ran",slot:1});
   expect(thought).toHaveBeenCalledTimes(1);const call=thought.mock.calls[0]![0];
   expect(call.privateBudgetReservation.state).toBe("held");expect(awakePassFromPayload(call.event?.payload)).toEqual({kind:"awake",slot:1,sinceMs:0});
  }finally{db.close();}
 });
 it("executes work-selected NIGHT without a time floor and retains weekly/payload laws",async()=>{
  const db=openTestSidecar();try{
   const thought=vi.fn<IdleThoughtRunner>(async()=>({published:true,acceptedSettlements:1,thoughtModelAttempts:1}));
   const options={conversationId:"fixture:owner",occupantId:"owner",authorityEpoch:1,timeZone:"UTC",nowMs:T,thought};
   expect(await tickNight(db,options)).toMatchObject({outcome:"scheduled"});
   expect(await tickNight(db,{...options,nowMs:T+1,timing:"thalamus"} as any)).toMatchObject({outcome:"ran",slot:1,weekly:false});
   const call=thought.mock.calls[0]![0];expect(call.privateBudgetReservation.state).toBe("held");
   expect(nightPassFromPayload(call.event?.payload)).toMatchObject({kind:"night",slot:1,weekly:false,weekSinceMs:T});
  }finally{db.close();}
 });
 it("never bypasses an active Owner cycle when a pass was selected",async()=>{
  for(const kind of ["awake","night"]){const db=openTestSidecar();try{
   const thought=vi.fn<IdleThoughtRunner>(()=>({published:true}));
   const options={conversationId:"fixture:owner",occupantId:"owner",authorityEpoch:1,timeZone:"UTC",nowMs:T,thought,timing:"thalamus"};
   admitTestCycle(db,{conversationId:"fixture:owner",triggerKind:"owner_message",triggerRef:"busy",occupantId:"owner",nowMs:T});
   const result=kind==="awake"?await tickAwake(db,options as any):await tickNight(db,options as any);
   expect(result.outcome).toBe("busy");expect(thought).not.toHaveBeenCalled();
  }finally{db.close();}}
 });
});
