// Operator-result staging preserves predecessor timing state and creates no cognitive work.
import {describe,it,expect} from "vitest";
import {openTestSidecar,setTestSidecarVersion} from "../../test-support.js";
import {openCognitiveSidecarDb} from "../db.js";
describe("result staging migration",()=>{
 it("upgrades the actual v56 predecessor without changing attention state",()=>{
  const db=openTestSidecar();try{
   db.exec("INSERT INTO thalamus_state VALUES('owner',1,'{}','{}',1)");
   const before=db.prepare("SELECT * FROM thalamus_state").all();
   setTestSidecarVersion(db,56);openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
   expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(66);
   expect(db.prepare("SELECT * FROM thalamus_state").all()).toEqual(before);
   expect(db.prepare("SELECT count(*) AS n FROM self_change_result_receipts").get()).toEqual({n:0});
   expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({n:0});
   openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
   expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{db.close();}
 });
});
