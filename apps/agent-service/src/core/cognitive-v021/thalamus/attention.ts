// Thought authors attention; Host compares typed facts without reading notes for meaning.
import type { Candidate } from "./core.js";
import { THALAMUS_PARAMETERS as P } from "./parameters.js";
export type AttentionObject = string | number | boolean;
export type AttentionSelector = { source: string; kind: string; subject?: string; object?: AttentionObject };
export type AttentionWatch = {
  id: string;
  match: AttentionSelector & { predicate: "eq" | "lt" | "gt" | "enters" | "leaves" | "changes" | "posts_about" };
  action: "wake" | "wake_urgent" | "suppress" | "quiet_until";
  expires: { atMs: number } | { event: AttentionSelector };
  note: string;
};
export type AttentionClaim = { watch?: AttentionWatch[]; wakeWorth?: "yes" | "no" | "sooner" | "later"; resting?: boolean };
export type AttentionFact = AttentionSelector & { previousObject?: AttentionObject; topics?: readonly string[] };
export type ThoughtAttention = { watching: readonly AttentionWatch[]; wokeBecause: readonly Candidate[]; alsoOnYourMind: readonly Candidate[] };
type RecordValue = Record<string,unknown>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length>0;
const primitive = (value: unknown): value is AttentionObject => typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
function selector(value: unknown, predicate=false): boolean {
  if (!record(value) || !text(value.source) || !text(value.kind)
    || Object.keys(value).some(key=>!["source","kind","subject","object",...(predicate?["predicate"]:[])].includes(key))
    || (value.subject !== undefined && !text(value.subject)) || (value.object !== undefined && !primitive(value.object))) return false;
  if (!predicate) return true;
  if (!["eq","lt","gt","enters","leaves","changes","posts_about"].includes(String(value.predicate))) return false;
  if (value.predicate !== "changes" && value.object === undefined) return false;
  if (["lt","gt"].includes(String(value.predicate)) && typeof value.object !== "number") return false;
  return value.predicate !== "posts_about" || text(value.object);
}
export function isValidAttentionClaim(value: unknown): value is AttentionClaim {
  if (!record(value) || Object.keys(value).length===0 || Object.keys(value).some(key=>!["watch","wakeWorth","resting"].includes(key))) return false;
  if (value.resting !== undefined && typeof value.resting !== "boolean") return false;
  if (value.wakeWorth !== undefined && !["yes","no","sooner","later"].includes(String(value.wakeWorth))) return false;
  if (value.watch === undefined) return true;
  if (!Array.isArray(value.watch) || value.watch.length>P.watchPerSettlement.default) return false;
  const ids = new Set<string>();
  for (const watch of value.watch) {
    if (!record(watch) || Object.keys(watch).some(key=>!["id","match","action","expires","note"].includes(key))
      || !text(watch.id) || ids.has(watch.id) || !selector(watch.match,true)
      || !["wake","wake_urgent","suppress","quiet_until"].includes(String(watch.action))
      || typeof watch.note !== "string" || watch.note.length>P.watchNoteCharacters.default || !record(watch.expires)) return false;
    const expiry = watch.expires;
    if (!(Object.keys(expiry).length===1 && ((Number.isSafeInteger(expiry.atMs) && Number(expiry.atMs)>=0)
      || selector(expiry.event)))) return false;
    ids.add(watch.id);
  }
  return true;
}
function selected(selector: AttentionSelector, fact: AttentionFact): boolean {
  return selector.source === fact.source && selector.kind === fact.kind
    && (selector.subject === undefined || selector.subject === fact.subject)
    && (selector.object === undefined || selector.object === fact.object);
}
export function watchExpired(watch: AttentionWatch, nowMs: number, fact?: AttentionFact): boolean {
  if (!Number.isFinite(nowMs)) throw new Error("attention_nonfinite_time");
  return "atMs" in watch.expires ? nowMs>=watch.expires.atMs : !!fact && selected(watch.expires.event,fact);
}
export function matchesWatch(watch: AttentionWatch, fact: AttentionFact, nowMs: number): boolean {
  if (watchExpired(watch,nowMs,fact) || watch.match.source !== fact.source || watch.match.kind !== fact.kind
    || (watch.match.subject !== undefined && watch.match.subject !== fact.subject)) return false;
  const expected = watch.match.object;
  switch(watch.match.predicate) {
    case "eq": return fact.object===expected;
    case "lt": return typeof fact.object === "number" && Number.isFinite(fact.object) && typeof expected === "number" && fact.object<expected;
    case "gt": return typeof fact.object === "number" && Number.isFinite(fact.object) && typeof expected === "number" && fact.object>expected;
    case "enters": return fact.previousObject !== undefined && fact.previousObject!==expected && fact.object===expected;
    case "leaves": return fact.previousObject !== undefined && fact.previousObject===expected && fact.object!==undefined && fact.object!==expected;
    case "changes": return fact.previousObject !== undefined && fact.object!==undefined && fact.previousObject!==fact.object;
    case "posts_about": return typeof expected === "string" && !!fact.topics?.includes(expected);
  }
}
/** Mandatory or due obligations retain their score; matching urgent attention cannot be suppressed. */
export function applyAttention(candidate: Candidate, watches: readonly AttentionWatch[], fact: AttentionFact, nowMs: number): Candidate {
  const matches = watches.filter(watch=>matchesWatch(watch,fact,nowMs));
  const result = { ...candidate, refs:[...candidate.refs] };
  if (candidate.class === "ALWAYS_THROUGH" || (candidate.deadlineMs !== undefined && candidate.deadlineMs<=nowMs)) return {...result,suppressed:false};
  if (matches.some(watch=>watch.action === "wake_urgent")) return {...result,class:"ALWAYS_THROUGH",suppressed:false};
  if (matches.some(watch=>watch.action === "suppress" || watch.action === "quiet_until")) return {...result,salience:0,suppressed:true};
  if (matches.some(watch=>watch.action === "wake")) return {...result,salience:Math.max(candidate.salience,P.theta0.default),suppressed:false};
  return result;
}
