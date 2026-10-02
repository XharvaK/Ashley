import {describe,expect,it} from "vitest";
import {openTestSidecar} from "../test-support.js";
async function status(db:ReturnType<typeof openTestSidecar>|null,owner="owner") {
 const module=await import("./status.js").catch(()=>null);
 return module?.thalamusStatus(db,owner,1000) ?? null;
}
describe("read-only thalamus diagnostics",()=>{
 it("reports unavailable evidence without inventing a zero count",async()=>{
  expect(await status(null)).toMatchObject({availability:"unavailable",watchCount:null,lastDecision:null});
 });
 it("scopes counts and mechanical receipts to the Owner without exposing private intent",async()=>{
  const db=openTestSidecar();try{
   for(const owner of ["owner","other"])db.prepare("INSERT INTO attention_watches(owner_id,watch_id,match_json,action,expires_json,note,created_at_ms) VALUES(?,?,?,?,?,?,?)")
    .run(owner,"watch",JSON.stringify({source:"external",kind:"item",predicate:"eq",object:1}),"wake",JSON.stringify({atMs:2000}),"private note",1);
   db.prepare("INSERT INTO thalamus_decisions(decision_id,owner_id,evaluated_at_ms,decision_code,reason_code,pass_type,candidates_json) VALUES(?,?,?,?,?,?,?)")
    .run("decision","owner",500,"fire","mandatory","afterglow",JSON.stringify({private:"private refs"}));
   const before=db.prepare("SELECT total_changes() AS n").get()!.n;
   const result=await status(db);
   expect(result).toMatchObject({availability:"available",watchCount:1,lastDecision:{atMs:500,code:"fire",reason:"mandatory",passType:"afterglow"}});
   expect(JSON.stringify(result)).not.toMatch(/private note|private refs|watch_id|candidates/);
   expect(db.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
  }finally{db.close();}
 });
});
