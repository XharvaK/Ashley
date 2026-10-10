// Attention storage is separate from authority and preserves the previous receipt revision.
import {describe,expect,it} from "vitest";
import {openTestSidecar,setTestSidecarVersion} from "../../test-support.js";
import {openCognitiveSidecarDb} from "../db.js";
import {COGNITIVE_SIDECAR_SCHEMA_VERSION} from "../../types.js";
const names=["attention_watches","thalamus_state","thalamus_decisions"];
describe("T3 attention storage migration",()=>{
 it("creates bounded structured watches, versioned state and timing-only decisions",()=>{
  const db=openTestSidecar();try{
   expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(76);
   for(const name of names)expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toBeDefined();
   db.prepare("INSERT INTO attention_watches (owner_id,watch_id,cycle_id,match_json,action,expires_json,note,created_at_ms) VALUES ('owner','watch',NULL,'{}','wake','{}','note',1)").run();
   expect(()=>db.prepare("UPDATE attention_watches SET note=?").run("x".repeat(201))).toThrow();
   expect(()=>db.exec("UPDATE attention_watches SET action='grant_permission'")).toThrow();
   expect(()=>db.exec("UPDATE attention_watches SET match_json='invalid'")).toThrow();
   expect(db.prepare("PRAGMA table_info(thalamus_decisions)").all().map(row=>row.name)).not.toContain("note");
  }finally{db.close();}
 });
 it("upgrades v55 idempotently without changing influence authority or previous receipt definition",()=>{
  const db=openTestSidecar();try{
   const authority=db.prepare("SELECT * FROM influence_contract_state").all();
   const receipts=db.prepare("SELECT sql FROM sqlite_master WHERE name='learned_choice_receipts'").get();
   for(const name of names)db.exec(`DROP TABLE IF EXISTS ${name}`);
   setTestSidecarVersion(db,55);openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
   for(const name of names)expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toBeDefined();
   expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(76);
   expect(db.prepare("SELECT * FROM influence_contract_state").all()).toEqual(authority);
   expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='learned_choice_receipts'").get()).toEqual(receipts);
   db.exec("INSERT INTO thalamus_state (owner_id,contract_version,state_json,attention_json,updated_at_ms) VALUES ('owner',1,'{}','{}',1)");
   openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
   expect(db.prepare("SELECT count(*) AS n FROM thalamus_state").get()!.n).toBe(1);
   expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{db.close();}
 });
});
