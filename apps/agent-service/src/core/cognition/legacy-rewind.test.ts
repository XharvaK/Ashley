// Historical fixtures must remove successor contract storage before replaying old ladders.
import { DatabaseSync } from "node:sqlite";
import { describe,it,expect } from "vitest";
import { openNuclearDb,NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { getContinuityFor } from "../continuity/registry.js";
const support=await import("./__tests__/fixtures/"+"legacy-rewind.js").catch(()=>null);
describe("historical nuclear rewind",()=>{
 it.each([23,28])("replays migration from v%s without retaining a successor C5 table",version=>{
  const db=openNuclearDb(new DatabaseSync(":memory:"));try{
   support?.prepareLegacyNuclearRewind(db);
   db.exec("DROP TABLE candidate_changeset_events; DROP TABLE candidate_changesets");
   db.exec(`PRAGMA user_version=${version}`);getContinuityFor(db)!.prepare("UPDATE lineage_state SET nuclear_schema_version=? WHERE id=1").run(version);
   expect(()=>openNuclearDb(db)).not.toThrow();
   expect(db.prepare("PRAGMA user_version").get()).toEqual({user_version:NUCLEAR_SUPPORTED_VERSION});
   expect(db.prepare("SELECT state FROM relationship_contract_state WHERE wave='c5'").get()).toEqual({state:"observe"});
   expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{db.close();}
 });
});
