import assert from "node:assert/strict";
import {test} from "node:test";
import {renderThoughtParseRates} from "./thought-parse-status.js";

test("shows malformed answers of all answers per model on one line",()=>{
 const rendered=renderThoughtParseRates([
  {modelId:"model-alpha",returned:3,malformed:1},
  {modelId:"model-beta",returned:2,malformed:0},
 ]);
 assert.equal(rendered,"Thought answers, 24h: model-alpha: 1 malformed of 4; model-beta: 0 malformed of 2");
});

test("omits the line when there are no answers in the window",()=>{
 assert.equal(renderThoughtParseRates(undefined),null);
 assert.equal(renderThoughtParseRates([]),null);
});
