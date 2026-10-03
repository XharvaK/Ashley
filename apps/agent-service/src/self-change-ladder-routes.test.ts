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
function command(url:string,actor="owner-test"){
 return fetch(url+"/growth/self-change/ladder",{method:"POST",headers:{"content-type":"application/json","X-Ashley-Bot-Service":"fixture-token","X-Ashley-Actor":actor},body:JSON.stringify({userId:"owner-test",level:2,expectedRevision:0,commandId:"fixture-command"})});
}
it("requires authenticated Owner authority and records an explicit ladder command",async()=>fixture(async(url,db)=>{
 expect((await command(url,"external")).status).toBe(403);
 expect(db.prepare("SELECT level FROM self_change_ladder").get()!.level).toBe(1);
 const response=await command(url);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({level:2,revision:1,automaticMerge:false});
 expect((await command(url)).status).toBe(200);
 expect(db.prepare("SELECT count(*) AS n FROM self_change_ladder_history").get()).toEqual({n:1});
}));
