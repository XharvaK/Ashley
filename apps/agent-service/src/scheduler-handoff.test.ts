import {describe,expect,it} from "vitest";
import type {AddressInfo} from "node:net";
import {env} from "./env.js";
import {createServer} from "./server.js";
import type {AgentManager} from "./agent.js";
const headers={"X-Ashley-Bot-Service":"fixture-token","Content-Type":"application/json"};
async function fixture(test:(url:string,calls:()=>number)=>Promise<void>){
 let count=0;const originalOwner=env.discordOwnerId;env.discordOwnerId="owner";const original=process.env.ASHLEY_THALAMUS_ENABLED;
 const manager={getState:()=>"ready",isPaused:()=>false,tickCognitiveIdle:async()=>{count++;return {reason:"legacy"};},core:{}} as unknown as AgentManager;
 const server=createServer(manager,{ownerId:"owner",botServiceToken:"fixture-token"}).listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>server.once("listening",resolve));
 try{await test(`http://127.0.0.1:${(server.address() as AddressInfo).port}`,()=>count);}
 finally{env.discordOwnerId=originalOwner;await new Promise<void>(resolve=>server.close(()=>resolve()));if(original===undefined)delete process.env.ASHLEY_THALAMUS_ENABLED;else process.env.ASHLEY_THALAMUS_ENABLED=original;}
}
describe("T4 scheduler handoff",()=>{
 it("reports versioned ownership and restores the bot on the kill switch",async()=>fixture(async(url)=>{
  process.env.ASHLEY_THALAMUS_ENABLED="true";
  const get=()=>fetch(`${url}/initiative/scheduler?owner_id=owner`,{headers});
  const active=await get();expect(active.status).toBe(200);expect(await active.json()).toEqual({owner:"thalamus",contractVersion:1});
  process.env.ASHLEY_THALAMUS_ENABLED="false";
  expect(await (await get()).json()).toEqual({owner:"bot",contractVersion:1});
  expect((await fetch(`${url}/initiative/scheduler?owner_id=owner`)).status).toBe(401);
  expect((await fetch(`${url}/initiative/scheduler?owner_id=other`,{headers})).status).toBe(403);
 }));
 it("refuses stale bot ticks and validates acknowledgement without granting ownership",async()=>fixture(async(url,calls)=>{
  process.env.ASHLEY_THALAMUS_ENABLED="true";
  const post=(path:string,body:unknown)=>fetch(`${url}${path}`,{method:"POST",headers,body:JSON.stringify(body)});
  const tick=await post("/initiative/idle",{userId:"owner"});expect(await tick.json()).toMatchObject({reason:"scheduler_owned_by_thalamus"});expect(calls()).toBe(0);
  expect((await post("/initiative/scheduler/ack",{userId:"owner",owner:"thalamus",contractVersion:1,active:false})).status).toBe(200);
  expect((await post("/initiative/scheduler/ack",{userId:"owner",owner:"bot",contractVersion:1,active:true})).status).toBe(409);
  expect((await post("/initiative/scheduler/ack",{userId:"owner",owner:"thalamus",contractVersion:2,active:false})).status).toBe(409);
  process.env.ASHLEY_THALAMUS_ENABLED="false";
  expect(await (await post("/initiative/idle",{userId:"owner"})).json()).toMatchObject({reason:"legacy"});expect(calls()).toBe(1);
 }));
});
