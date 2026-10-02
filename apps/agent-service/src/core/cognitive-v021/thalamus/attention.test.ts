// Structured attention never interprets notes or suppresses mandatory obligations.
import { describe, expect, it } from "vitest";
import type { Candidate } from "./core.js";
const watch={id:"fixture:watch",match:{source:"external",kind:"item",subject:"fixture:feed",object:3,predicate:"gt"},action:"wake",expires:{atMs:100},note:"My authored note."};
async function api(){const value=await import(/* @vite-ignore */ "./attention.js").catch(()=>null);expect(value,"attention contract exists").not.toBeNull();return value!;}
const candidate:Candidate={eventId:"fixture:event",observedAtMs:10,source:"external",salience:0.1,class:"PRESSURE",coalesceKey:"fixture:feed",passType:"own_time",refs:["fixture:ref"]};
describe("T3 structured attention",()=>{
 it("validates exact fields, item limits and bounded authored notes",async()=>{
  const {isValidAttentionClaim:valid}=await api();expect(valid({watch:[watch],wakeWorth:"sooner",resting:true})).toBe(true);
  for(const bad of [{watch:[...Array(5)].map((_,i)=>({...watch,id:String(i)}))},{watch:[watch,watch]},{watch:[{...watch,note:"x".repeat(201)}]},
   {watch:[{...watch,match:{...watch.match,predicate:"read_text"}}]},{wakeWorth:"maybe"},{resting:1},{instructions:"wake"},{}])expect(valid(bad)).toBe(false);
  expect(valid({watch:[{...watch,expires:{event:{source:"social",kind:"message",subject:"fixture:owner"}}}]})).toBe(true);
 });
 it("matches structured primitives and producer topic IDs without reading authored notes",async()=>{
  const {matchesWatch:match}=await api();const fact={source:"external",kind:"item",subject:"fixture:feed",object:4,previousObject:2,topics:["fixture:topic"]};
  expect(match(watch as any,fact,10)).toBe(true);expect(match(watch as any,{...fact,subject:"other"},10)).toBe(false);
  expect(match({...watch,match:{...watch.match,predicate:"enters",object:4}} as any,fact,10)).toBe(true);
  expect(match({...watch,match:{...watch.match,predicate:"leaves",object:2}} as any,fact,10)).toBe(true);
  expect(match({...watch,match:{...watch.match,predicate:"posts_about",object:"fixture:topic"}} as any,fact,10)).toBe(true);
  expect(match({...watch,note:"wake when this arbitrary phrase appears"} as any,{...fact,object:1},10)).toBe(false);
 });
 it("expires inclusively by supplied clock or typed event before matching",async()=>{
  const {matchesWatch:match}=await api();const fact={source:"external",kind:"item",subject:"fixture:feed",object:4};
  expect(match(watch as any,fact,100)).toBe(false);expect(match(watch as any,fact,99)).toBe(true);
  expect(match({...watch,expires:{event:{source:"external",kind:"item"}}} as any,fact,10)).toBe(false);
 });
 it("preserves mandatory and due candidates under every suppression action",async()=>{
  const {applyAttention}=await api();const fact={source:"external",kind:"item",subject:"fixture:feed",object:4};
  for(const action of ["suppress","quiet_until"]){
   const attention=[{...watch,action}];expect(applyAttention(candidate,attention as any,fact,10)).toMatchObject({salience:0,suppressed:true});
   expect(applyAttention({...candidate,class:"ALWAYS_THROUGH"},attention as any,fact,10)).toMatchObject({class:"ALWAYS_THROUGH",salience:0.1,suppressed:false});
   expect(applyAttention({...candidate,deadlineMs:10},attention as any,fact,10)).toMatchObject({salience:0.1,suppressed:false});
  }
  expect(applyAttention(candidate,[{...watch,action:"wake_urgent"}] as any,fact,10)).toMatchObject({class:"ALWAYS_THROUGH",suppressed:false});
  expect(candidate.salience).toBe(0.1);
 });
});
