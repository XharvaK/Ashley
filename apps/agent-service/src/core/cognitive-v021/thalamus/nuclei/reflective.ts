// Reflection pressure uses the authoritative row watermark and supplied appraisal, never conversation text.
import { THALAMUS_PARAMETERS as P } from "../parameters.js";
import { proposal, nonnegative, unit, type Fact } from "./facts.js";
export type ReflectiveFacts = Fact & { unreflectedRows: number; lastMessageAtMs: number; appraisalMagnitude: number };
export function reflective(input: ReflectiveFacts, nowMs: number) {
  const rows = nonnegative(input.unreflectedRows);
  if (!rows) return null;
  const score = rows / P.reflectiveRowsAtFullPressure.default
    * nonnegative(nowMs - input.lastMessageAtMs) / P.reflectiveIdleMsAtFullPressure.default
    * (1 + unit(input.appraisalMagnitude));
  return proposal(input, "reflective", "reflection", score, "afterglow",
    rows >= P.reflectionWindowRows.default ? "ALWAYS_THROUGH" : "PRESSURE");
}
/** M2: a stretch of play the Host found due (ended, or long) goes through as it stands. */
export function sessionReflective(input: Fact, _nowMs: number) {
  return proposal(input, "reflective", "reflection", 1, "afterglow", "ALWAYS_THROUGH");
}
