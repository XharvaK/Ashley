// Known mechanical band changes can raise a sense; an active decline quiets it without invented failure history.
import type { SenseName } from "../../senses/senses.js";
import type { Candidate } from "../core.js";
import { THALAMUS_PARAMETERS as P } from "../parameters.js";
import { proposal, type Fact } from "./facts.js";
export type InteroceptiveFact = Fact & { sense: SenseName; band: string; previousBand: string | null;
  declinedBand?: string; declineUntilMs?: number; declineReraised?: boolean };
export function interoceptive(readings: readonly InteroceptiveFact[], nowMs: number): Candidate[] {
  const result: Candidate[] = [];
  for (const reading of readings) {
    const declined = reading.declinedBand === reading.band;
    if (reading.band === "unknown" || (declined && nowMs < (reading.declineUntilMs ?? Infinity))) continue;
    const expiredDecline = declined && reading.declineReraised === false && reading.declineUntilMs !== undefined && nowMs >= reading.declineUntilMs;
    if (reading.previousBand === reading.band && !expiredDecline) continue;
    const critical = ["high", "backlogged", "stale"].includes(reading.band);
    result.push(proposal(reading, "interoceptive", `sense:${reading.sense}`, P.theta0.default, "own_time",
      critical ? "PRESSURE" : "OPPORTUNISTIC"));
  }
  return result;
}
