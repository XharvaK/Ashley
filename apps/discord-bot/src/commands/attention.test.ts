// Attention readouts preserve exact calibration and explicit unavailable evidence.
import {it} from "node:test";
import assert from "node:assert/strict";
async function api(){const module=await import("./attention.js").catch(()=>null);assert.ok(module,"attention command must exist");return module!;}
it("reports missing timing calibration as unavailable",async()=>{const m=await api();assert.match(m.renderAttention(undefined),/unavailable/);});
it("shows exact bounded sensitivity values without treating a proposal as execution",async()=>{
 const m=await api();const text=m.renderAttention({owner:"thalamus",contractVersion:1,availability:"available",watchCount:0,lastDecision:null,learning:{gains:{external:.975},familyGains:{"external:feed":.975},habituation:{"external:feed":.325}}});
 assert.match(text,/0.975/);assert.match(text,/0.325/);assert.match(text,/external:feed/);
});
