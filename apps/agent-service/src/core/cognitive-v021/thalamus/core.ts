// Nuclei propose timing facts; this pure arbiter selects a pass without authoring meaning or granting execution authority.
import { THALAMUS_PARAMETERS as P } from "./parameters.js";
export type Nucleus = "reflective" | "sleep" | "prospective" | "external" | "boredom" | "interoceptive" | "social";
export type Candidate = {
  eventId: string; observedAtMs: number; source: Nucleus; salience: number;
  class: "ALWAYS_THROUGH" | "PRESSURE" | "OPPORTUNISTIC";
  coalesceKey: string; deadlineMs?: number; passType: "afterglow" | "night" | "own_time" | "conversation";
  refs: readonly string[]; suppressed?: boolean;
};
export type FamilyState = { response: number; arousal: number; lastObservedAtMs: number; lastEventId: string; lastEvaluatedAtMs: number };
export type ThalamusState = {
  lastNowMs: number; families: Record<string, FamilyState>; lastSelectedAtMs: Partial<Record<Nucleus, number>>;
};
export type ThalamusContext = {
  budgetAvailable: boolean; conversationClaimHeld: boolean; spentFraction: number;
  energy: number; tension: number; circadianPhase: number;
  gains?: Partial<Record<Nucleus, number>>; familyGains?: Record<string, number>;
};
export type Decision =
  | { kind: "none"; reason: "budget" | "conversation" | "no_candidate"; pending: Candidate[] }
  | { kind: "fire"; passType: Candidate["passType"]; bundle: Candidate[]; pending: Candidate[] };
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const orderText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const refractory: Record<Nucleus, number> = {
  reflective: P.reflectiveRefractoryMs.default, sleep: P.sleepRefractoryMs.default,
  prospective: P.prospectiveRefractoryMs.default, external: P.externalRefractoryMs.default,
  boredom: P.boredomRefractoryMs.default, interoceptive: P.interoceptiveRefractoryMs.default,
  social: P.socialRefractoryMs.default,
};
function threshold(source: Nucleus, context: ThalamusContext): number {
  const mood = clamp(1 + P.moodAmplitude.default * (1 - 2 * clamp(context.energy, 0, 1)
    - (source === "social" ? clamp(context.tension, 0, 1) : 0)),
    1 - P.moodAmplitude.default, 1 + P.moodAmplitude.default);
  return P.theta0.default * (1 + P.fatigueAmplitude.default * clamp(context.spentFraction, 0, 1) ** P.fatigueExponent.default)
    * (1 + P.circadianAmplitude.default * clamp(context.circadianPhase, -1, 1)) * mood;
}
/** A fire result proposes timing. The existing kernel must still admit and execute the pass. */
export function arbitrate(state: ThalamusState, candidates: readonly Candidate[], now: number, context: ThalamusContext): { decision: Decision; state: ThalamusState } {
  if (![now, state.lastNowMs, context.spentFraction, context.energy, context.tension, context.circadianPhase].every(Number.isFinite))
    throw new Error("thalamus_nonfinite_context");
  const effectiveNow = Math.max(now, state.lastNowMs);
  const next: ThalamusState = { lastNowMs: effectiveNow,
    families: Object.assign(Object.create(null), state.families), lastSelectedAtMs: { ...state.lastSelectedAtMs } };
  const byEvent = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (String(candidate.source) === "owner") throw new Error("thalamus_owner_ingress_required");
    if (!(Object.hasOwn(refractory, candidate.source)) || !candidate.eventId || !candidate.coalesceKey
      || !Number.isFinite(candidate.salience) || !Number.isFinite(candidate.observedAtMs)
      || (candidate.deadlineMs !== undefined && !Number.isFinite(candidate.deadlineMs)))
      throw new Error("thalamus_invalid_candidate");
    const previous = byEvent.get(candidate.eventId);
    if (previous && JSON.stringify([previous.source, previous.salience, previous.class, previous.coalesceKey, previous.deadlineMs, previous.passType, previous.refs, previous.observedAtMs, previous.suppressed ?? false]) !== JSON.stringify([candidate.source, candidate.salience, candidate.class, candidate.coalesceKey, candidate.deadlineMs, candidate.passType, candidate.refs, candidate.observedAtMs, candidate.suppressed ?? false])) throw new Error("thalamus_event_conflict");
    byEvent.set(candidate.eventId, candidate);
  }
  const pending = [...byEvent.values()].sort((a,b) => orderText(a.eventId,b.eventId));
  const ranked = pending.map(candidate => {
    const mandatory = candidate.class === "ALWAYS_THROUGH" || (candidate.deadlineMs !== undefined && candidate.deadlineMs <= effectiveNow);
    const gain = context.gains?.[candidate.source] ?? P.nucleusGain.default;
    const familyGain = context.familyGains?.[candidate.coalesceKey] ?? P.familyGain.default;
    if (!Number.isFinite(gain) || !Number.isFinite(familyGain)) throw new Error("thalamus_invalid_gain");
    const score = clamp(candidate.salience, P.salienceMinimum.default, P.salienceMaximum.default)
      * clamp(gain, P.nucleusGain.learningBound.min, P.nucleusGain.learningBound.max)
      * clamp(familyGain, P.familyGain.learningBound.min, P.familyGain.learningBound.max);
    const selectedAt = state.lastSelectedAtMs[candidate.source];
    const available = mandatory || (!candidate.suppressed && !context.conversationClaimHeld
      && (selectedAt === undefined || effectiveNow - selectedAt >= refractory[candidate.source]));
    return { candidate, mandatory, score, available };
  });
  if (!context.budgetAvailable) return { decision: { kind: "none", reason: "budget", pending }, state: next };
  const eligible = ranked.filter(row => row.available && (row.mandatory
    || (row.candidate.class === "PRESSURE" && row.score >= threshold(row.candidate.source, context))));
  eligible.sort((a,b) => Number(b.mandatory) - Number(a.mandatory)
    || (a.mandatory && b.mandatory ? Number(b.candidate.passType === "afterglow") - Number(a.candidate.passType === "afterglow") : 0)
    || b.score - a.score || orderText(a.candidate.eventId,b.candidate.eventId));
  const winner = eligible[0];
  if (!winner) return { decision: { kind: "none", reason: context.conversationClaimHeld ? "conversation" : "no_candidate", pending }, state: next };
  const bundle = [winner.candidate, ...ranked.filter(row => row.candidate.eventId !== winner.candidate.eventId
    && row.available && row.candidate.passType === winner.candidate.passType).map(row => row.candidate)];
  for (const candidate of bundle) next.lastSelectedAtMs[candidate.source] = effectiveNow;
  const selected = new Set(bundle.map(candidate => candidate.eventId));
  return { decision: { kind: "fire", passType: winner.candidate.passType, bundle,
    pending: pending.filter(candidate => !selected.has(candidate.eventId)) }, state: next };
}
