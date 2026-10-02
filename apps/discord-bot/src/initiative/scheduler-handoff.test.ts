import assert from "node:assert/strict";
import {test} from "node:test";
import {reconcileSchedulerOwnership} from "./scheduler.js";
test("handoff stops the bot, acknowledges its actual timer, and restores the legacy bot",async()=>{
 let active=true;const records:unknown[]=[];
 const deps={start:()=>{active=true;},stop:()=>{active=false;},active:()=>active,ack:async(c:unknown,a:boolean)=>{records.push([c,a]);}};
 assert.equal(await reconcileSchedulerOwnership({...deps,read:async()=>({owner:"thalamus",contractVersion:1})}),"thalamus");assert.equal(active,false);
 assert.equal(await reconcileSchedulerOwnership({...deps,read:async()=>({owner:"bot",contractVersion:1})}),"bot");assert.equal(active,true);
 assert.deepEqual(records,[[{owner:"thalamus",contractVersion:1},false],[{owner:"bot",contractVersion:1},true]]);
});
test("unknown versions, failed reads and stopped polls cannot change the timer or acknowledge",async()=>{
 let changes=0;const deps={start:()=>{changes++;},stop:()=>{changes++;},ack:async()=>{changes++;}};
 assert.equal(await reconcileSchedulerOwnership({...deps,read:async()=>({owner:"bot",contractVersion:2})}),"unknown");
 assert.equal(await reconcileSchedulerOwnership({...deps,read:async()=>{throw new Error("offline");}}),"unknown");
 assert.equal(await reconcileSchedulerOwnership({...deps,current:()=>false,read:async()=>({owner:"bot",contractVersion:1})}),"unknown");
 assert.equal(changes,0);
});
