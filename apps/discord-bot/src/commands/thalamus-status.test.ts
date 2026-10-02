import assert from "node:assert/strict";
import {test} from "node:test";
import {renderProactiveStatus} from "./proactive.js";
const base={statusAvailability:"unavailable",legacyProactiveEnabled:false,periodicScheduleState:"unavailable"} as any;
const scheduler={active:false,running:false,cadenceMinutes:240};
test("shows mechanical timing receipt without claiming execution",()=>{
 const rendered=renderProactiveStatus({...base,thalamus:{owner:"thalamus",contractVersion:1,availability:"available",watchCount:2,lastDecision:{atMs:1000,code:"fire",reason:"mandatory",passType:"night"}}},scheduler);
 assert.match(rendered,/Thalamus: thalamus; contract: 1; watches: 2/);
 assert.match(rendered,/Timing decision: fire \(mandatory\); pass: night; at: 1970-01-01T00:00:01.000Z/);
 assert.doesNotMatch(rendered,/executed|delivered/);
});
test("keeps missing diagnostic evidence unavailable",()=>{
 assert.match(renderProactiveStatus(base,scheduler),/Thalamus: unavailable/);
});
