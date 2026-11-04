import {test} from "node:test";
import assert from "node:assert/strict";
import {dailyKey,dailyReset,aiFailureMessage,aiAttemptDiagnostic,parseModelReply,validateAIPlan} from "./lib.js";
import {inspectCounters} from "../tools/daily-counters.mjs";
import "../site/query-parser.js";

test("UTC keys change at midnight in winter, summer and both DST transitions",()=>{
 for(const day of ["2026-11-04","2026-07-04","2026-03-29","2026-10-25"]){
  const midnight=new Date(day+"T00:00:00Z");assert.equal(dailyKey(midnight),day);
  assert.notEqual(dailyKey(new Date(midnight.getTime()-1)),day);
 }
 assert.equal(dailyReset(new Date("2026-11-04T06:54:00Z")).rome,"01:00");
 assert.equal(dailyReset(new Date("2026-07-04T06:54:00Z")).rome,"02:00");
 assert.equal(dailyReset(new Date("2026-03-29T01:00:00Z")).rome,"02:00");
 assert.equal(dailyReset(new Date("2026-10-25T02:00:00Z")).rome,"01:00");
});
test("only daily exhaustion says used up; summer notice follows Rome DST",()=>{
 const date=new Date("2026-07-04T12:00:00Z");
 assert(aiFailureMessage("daily_neuron_limit",date).includes("02:00"));
 for(const reason of ["search_neuron_limit","ai_timeout","ai_bad_json","ai_validation","ai_provider_error"])assert(!aiFailureMessage(reason,date).includes("used up"));
});
test("admin inspection reads only today's exact keys and reports missing counters",async()=>{
 const keys=[],result=await inspectCounters(async key=>{keys.push(key);return key.startsWith("ai:usage:")?{used:1300,reserved:0}:null;},new Date("2026-11-04T06:54:00Z"));
 assert.deepEqual(keys,["ai:usage:2026-11-04","ai:count:2026-11-04","count:2026-11-04"]);
 assert.equal(result.values[keys[1]],null);assert.equal(result.nextReset.rome,"01:00");
});
test("population removal leaves no empty comma parts in the parsed topic",()=>{
 assert.equal(globalThis.TMM_QUERY_PARSER.parse("social media, kids, attention",2026).topic,"social media, attention");
});
test("failure diagnostics redact secrets before truncating replies and errors",()=>{
 const secret="private-test-value",raw='{"api_key":"'+secret+'","authorization":"Bearer hidden-token","text":"sk-testToken"}';
 const result=aiAttemptDiagnostic({stage:"planning",attempt:1,call:1,category:"validation",error:new Error(secret),parseableJSON:true,rawReply:raw,secrets:[secret]});
 assert(!JSON.stringify(result).includes(secret));assert(!result.replyPreview.includes("hidden-token"));assert(!result.replyPreview.includes("sk-testToken"));
 assert.equal(result.errorName,"Error");assert.equal(result.parseableJSON,true);
});
test("reply framing accepts complete objects with braces in strings and rejects truncation/multiple answers",()=>{
 assert.deepEqual(parseModelReply('{"x":"a } { b"} trailing explanation'),{x:"a } { b"});
 assert.throws(()=>parseModelReply('{"x":1'),SyntaxError);
 assert.throws(()=>parseModelReply('{"x":1} {"x":2}'),SyntaxError);
});
test("model topics cannot retain empty comma parts",()=>{
 const plan={topic:"social media, , attention",synonyms:[],includeGroups:[],place:{codes:[],mode:"mentions"},excludeTerms:[],years:{from:2010,to:null}};
 assert.equal(validateAIPlan(plan,2026).topic,"social media, attention");
});
