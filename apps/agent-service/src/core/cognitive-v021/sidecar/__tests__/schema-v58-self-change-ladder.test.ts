// Ladder migration preserves staged operator evidence without creating cognitive work.
import {it,expect} from "vitest";
import {openTestSidecar,setTestSidecarVersion} from "../../test-support.js";
import {openCognitiveSidecarDb} from "../db.js";
it("preserves v57 result bytes and starts the new ladder at L1 exactly once",()=>{
 const db=openTestSidecar();try{
  db.prepare("INSERT INTO self_change_result_receipts (changeset_id,conversation_id,result_digest,result_json,received_at_ms) VALUES ('cs_fixture','fixture',?,'{}',1)").run("a".repeat(64));
  const before=db.prepare("SELECT * FROM self_change_result_receipts").all();
  setTestSidecarVersion(db,57);openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
  expect(db.prepare("SELECT * FROM self_change_result_receipts").all()).toEqual(before);
  expect(db.prepare("SELECT * FROM self_change_ladder").get()).toEqual({id:1,level:1,revision:0});
  expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(63);
  db.exec("UPDATE self_change_ladder SET level=0");openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
  expect(db.prepare("SELECT level FROM self_change_ladder").get()!.level).toBe(0);
  expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({n:0});
 }finally{db.close();}
});
