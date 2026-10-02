// Test-only rewinds restore predecessor state instead of retaining successor tables.
import type { DatabaseSync } from "node:sqlite";
import { restoreLegacyV55Objects } from "./legacy-v55.js";
export function prepareLegacyNuclearRewind(db:DatabaseSync):void {
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='relationship_contract_state'").get()) restoreLegacyV55Objects(db);
}
