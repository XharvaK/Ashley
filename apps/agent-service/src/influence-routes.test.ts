// Mode selection needs authenticated Owner authority; fixtures are isolated from live state.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { AgentManager } from "./agent.js";
import { createServer } from "./server.js";
import { openTestSidecar } from "./core/cognitive-v021/test-support.js";
vi.mock("./owner-auth.js",()=>({isAuthorizedOwnerId:(id:string)=>id==="owner-test"}));
async function fixture(run:(url:string,db:ReturnType<typeof openTestSidecar>)=>Promise<void>){
 const db=openTestSidecar(),nuclear=new DatabaseSync(":memory:");
 const manager={core:{getDatabase:()=>nuclear}} as unknown as AgentManager;
 const app=createServer(manager,{cognitiveSidecar:db,botServiceToken:"fixture-token",ownerId:"owner-test"});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
 const a=server.address();if(!a||typeof a==="string")throw new Error("fixture_address");
 try{await run(`http://127.0.0.1:${a.port}`,db);}finally{await new Promise<void>(r=>server.close(()=>r()));db.close();nuclear.close();}
}
function post(url:string,mode:string,actor="owner-test"){
 return fetch(url+"/growth/influences/mode",{method:"POST",headers:{"content-type":"application/json","X-Ashley-Bot-Service":"fixture-token","X-Ashley-Actor":actor},body:JSON.stringify({userId:"owner-test",mode})});
}
describe("Owner influence mode route",()=>{
 it("refuses a nonowner and records authenticated Owner mode/time",async()=>fixture(async(url,db)=>{
  expect((await post(url,"apply","external")).status).toBe(403);
  expect(db.prepare("SELECT state FROM influence_contract_state").get()!.state).toBe("observe");
  expect((await post(url,"dark_apply")).status).toBe(200);
  expect(db.prepare("SELECT state,mode_set_by,mode_set_at_ms FROM influence_contract_state").get()).toMatchObject({state:"dark_apply",mode_set_by:"owner-test",mode_set_at_ms:expect.any(Number)});
  expect((await post(url,"unknown")).status).toBe(400);
 }));
 it("allows Owner apply/observe rollback without forgetting prior authority or rewriting proposals",async()=>fixture(async(url,db)=>{
  expect((await post(url,"apply")).status).toBe(200);
  expect((await post(url,"observe")).status).toBe(200);
  expect(db.prepare("SELECT state,live_authority_existed FROM influence_contract_state").get()).toEqual({state:"observe",live_authority_existed:1});
  expect(db.prepare("SELECT * FROM learned_influences").all()).toEqual([]);
 }));
});

it("retires the nuclear influence diagnostic without reading removed tables",async()=>fixture(async(url)=>{
 const headers={"X-Ashley-Bot-Service":"fixture-token","X-Ashley-Actor":"owner-test"};
 expect((await fetch(url+"/nuclear/learned-autonomy?owner_id=owner-test",{headers})).status).toBe(410);
 expect((await fetch(url+"/nuclear/learned-autonomy?owner_id=external",{headers})).status).toBe(403);
}));
