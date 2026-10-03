// The canonical wrapper can start backup without compiling candidate code against stale dependency declarations.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
for(const forceFail of [false,true])test(forceFail?"backup refusal propagates without candidate compilation":"backup bootstrap succeeds while candidate dependency declarations are stale",{skip:process.platform!=="win32"},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),"ashley-backup-bootstrap-"));
 try{
  const mock=path.join(dir,"ssh.mjs"),capture=path.join(dir,"captured.txt");
  writeFileSync(mock,`import {readFileSync,writeFileSync} from "node:fs";import {spawnSync} from "node:child_process";
const source=readFileSync(0,"utf8");writeFileSync(process.env.BOOTSTRAP_CAPTURE,source);
if(source.includes("npx tsc -p tsconfig.json")){console.error("candidate_types_unavailable");process.exit(78);}
if(!source.includes("node --import tsx src/scripts/backup-daily.ts"))process.exit(79);
const result=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",'import {runDailyBackup} from "./src/scripts/backup-daily.ts"; if(typeof runDailyBackup!=="function")process.exit(80);'],{cwd:process.env.BOOTSTRAP_PACKAGE,encoding:"utf8"});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exit(result.status!==0?(result.status??81):(process.env.BOOTSTRAP_FORCE_FAIL==="true"?42:0));`);
  writeFileSync(path.join(dir,"ssh.cmd"),`@echo off
"${process.execPath}" "${mock}"
`);
  const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(ROOT,"scripts/mint/remote-update.ps1")],{
   cwd:ROOT,encoding:"utf8",windowsHide:true,env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,BOOTSTRAP_CAPTURE:capture,BOOTSTRAP_FORCE_FAIL:String(forceFail),BOOTSTRAP_PACKAGE:path.join(ROOT,"apps/agent-service")}});
  assert.equal(result.status,forceFail?42:0,result.stdout+result.stderr);
  const source=readFileSync(capture,"utf8");
  assert.ok(source.indexOf("node --import tsx src/scripts/backup-daily.ts")<source.indexOf("exec bash deploy/linux-mint/update.sh"));
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith("ashley-backup-bootstrap-"));rmSync(dir,{recursive:true,force:true});}
});
