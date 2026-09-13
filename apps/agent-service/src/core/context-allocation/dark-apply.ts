import type { DatabaseSync } from "node:sqlite";
import { assertC2ContractCompatible } from "./contract-state.js";
import { selectAndRender } from "./render.js";
import type { ContextAllocation, ContextRequest } from "./types.js";

/** Test-only full C2 path. It never turns on live authority or provider dispatch. */
export function darkApplyContext(
  db: DatabaseSync,
  request: ContextRequest,
): ContextAllocation {
  assertC2ContractCompatible(db);
  return selectAndRender(db, {
    ...request,
    capabilityMode: "dark_apply",
    mode: "dark_apply",
  });
}
