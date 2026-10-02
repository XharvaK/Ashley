import {describe,it,expect} from "vitest";
import {ResourceFuse} from "../social/resource-fuse.js";
const policy={windowMs:60000,computeMs:10,outputTokens:20,networkRequests:4,rapidLoopWindowMs:30000,rapidLoopLimit:1,backoffDelaysMs:[1000]};
const input={conversationKey:"dm:bot",consequenceChainId:"chain",lifecycleId:"actual",botParticipantId:"bot",nowMs:1000,usage:{computeMs:2,outputTokens:4,networkRequests:1}};
describe("social wake resource projection",()=>{
 it("reads existing backoff pressure without moving its retry clock",()=>{
  const fuse=new ResourceFuse(policy);fuse.admitAndRecord(input);
  expect((fuse as any).projectWake?.({conversationKey:"dm:bot",botParticipantId:"bot",nowMs:1100})).toMatchObject({accepted:false,fact:{operational:"backing_off"}});
  expect(fuse.admit({...input,lifecycleId:"next",nowMs:1200})).toMatchObject({accepted:false,retryAtMs:2200});
 });
 it("reports a pause without admitting or recording provider work",()=>{
  const fuse=new ResourceFuse(policy);
  expect((fuse as any).projectWake?.({conversationKey:"dm:bot",nowMs:1100,paused:true})).toMatchObject({accepted:false,fact:{operational:"paused"}});
  expect(fuse.admit(input)).toMatchObject({accepted:true});
 });
});
