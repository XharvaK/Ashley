// Provider schema and Host validation share the same fixed attention bounds.
import { THALAMUS_PARAMETERS as P } from "./parameters.js";
const object=(properties:Record<string,unknown>,required:string[])=>({type:"object",properties,required,additionalProperties:false});
const text={type:"string",minLength:1};
const primitive={oneOf:[{type:"string"},{type:"number"},{type:"boolean"}]};
const selector={source:text,kind:text,subject:text,object:primitive};
const match=(predicates:string[],value:unknown,requiredObject=true)=>object({...selector,object:value,predicate:{enum:predicates}},["source","kind","predicate",...(requiredObject?["object"]:[])]);
export const ATTENTION_GUIDANCE="attention is your private attention (16 live watches). watch replaces matching ids; expires.atMs now cancels. Match typed facts or producer-authored topic IDs; never put matching instructions in notes. object is required except for changes; lt/gt need a number, posts_about a topic ID. Suppression cannot mute mandatory or due obligations. wakeWorth reports this wake's value; resting states your current rest. watching shows your set; wokeBecause and alsoOnYourMind are timing causes, never execution proof. Attention never grants permissions. Omit unused fields.";
export const ATTENTION_CLAIM_SCHEMA={
 description:ATTENTION_GUIDANCE,
 type:"object",additionalProperties:false,minProperties:1,properties:{
  watch:{type:"array",maxItems:P.watchPerSettlement.default,items:object({
   id:text,match:{oneOf:[match(["eq","enters","leaves"],primitive),match(["changes"],primitive,false),match(["lt","gt"],{type:"number"}),match(["posts_about"],text)]},
   action:{enum:["wake","wake_urgent","suppress","quiet_until"]},
   expires:{oneOf:[object({atMs:{type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER}},["atMs"]),object({event:object(selector,["source","kind"])},["event"])]},
   note:{type:"string",maxLength:P.watchNoteCharacters.default},
  },["id","match","action","expires","note"])},
  wakeWorth:{enum:["yes","no","sooner","later"]},resting:{type:"boolean"},
 },
};

export const ATTENTION_JSON_OBJECT_SHAPE_GUIDANCE=`Owner-private attention syntax: {watch?:[{id:string,match:{source:string,kind:string,subject?:string,object?:string|number|boolean,predicate:eq|lt|gt|enters|leaves|changes|posts_about},action:wake|wake_urgent|suppress|quiet_until,expires:{atMs:integer>=0}|{event:{source:string,kind:string,subject?:string,object?:string|number|boolean}},note:string}],wakeWorth?:yes|no|sooner|later,resting?:boolean}. watch has at most ${P.watchPerSettlement.default} items per settlement and ${P.watchLive.default} live; note at most ${P.watchNoteCharacters.default} characters. The Host rejects duplicate ids, nonfinite numbers and fields outside these shapes.`;
