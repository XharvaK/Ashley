import type { DatabaseSync } from "node:sqlite";
import { listInFlight, markInFlightUnknown } from "./in-flight.js";
import type { InFlightRecord } from "../types.js";

export function recoverInFlight(db: DatabaseSync, _nowMs = Date.now()): InFlightRecord[] {
  return listInFlight(db).map((record) => {
    if (record.status === "in_flight") return markInFlightUnknown(db, record.effectId);
    return record;
  });
}
