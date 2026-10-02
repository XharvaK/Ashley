// A nucleus preserves fact identity and evidence references without interpreting their content.
import type { Candidate } from "../core.js";
export type Fact = { eventId: string; observedAtMs: number; refs: readonly string[] };
export function unit(value: number): number {
  if (!Number.isFinite(value)) throw new Error("thalamus_nonfinite_fact");
  return Math.max(0, Math.min(1, value));
}
export function nonnegative(value: number): number {
  if (!Number.isFinite(value)) throw new Error("thalamus_nonfinite_fact");
  return Math.max(0, value);
}
export function proposal(fact: Fact, source: Candidate["source"], coalesceKey: string,
  salience: number, passType: Candidate["passType"], classification: Candidate["class"] = "PRESSURE"): Candidate {
  return { eventId: fact.eventId, observedAtMs: fact.observedAtMs, refs: [...fact.refs],
    source, coalesceKey, salience: unit(salience), passType, class: classification };
}
