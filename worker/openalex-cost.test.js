import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {openAlexUsage,combineOpenAlexUsage,openAlexBudgetSummary,explicitOpenAlexUsd} from "./lib.js";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/openalex-costs.json",import.meta.url),"utf8"));
const attempts=count=>Array.from({length:count},()=>({query:"papers",stage:"report",attempt:1,status:200,reportedUsd:null}));
test("synthetic provider USD charges sum once per attempt, including 429s",()=>{
 const usage=openAlexUsage(fixture.attempts);assert.equal(usage.calls,4);assert.equal(usage.reportedUsd,.00085);assert.equal(usage.estimatedUsd,.004);assert.equal(usage.costBasis,"provider_reported_usd");assert.equal(usage.byQuery.semanticPapers,2);
});
test("empty, negative, unknown, conflicting and nonnumeric costs never masquerade as measured dollars",()=>{
 for(const value of [null,undefined,"",-1,"-1","NaN","unknown units",Infinity])assert.equal(explicitOpenAlexUsd(value,null),null);
 assert.equal(explicitOpenAlexUsd(".01",null),null);assert.equal(explicitOpenAlexUsd("0.001",.002),null);assert.equal(explicitOpenAlexUsd("0.001",.001),.001);assert.equal(explicitOpenAlexUsd(null,0),0);
 const usage=openAlexUsage([{...fixture.attempts[0],reportedUsd:null}]);assert.equal(usage.reportedUsd,null);assert.equal(usage.costBasis,"estimate_from_spec");
});
test("partial responses retain known costs without pretending the entire dollar total is measured",()=>{
 const usage=combineOpenAlexUsage([openAlexUsage(fixture.attempts),openAlexUsage(attempts(2))]);assert.equal(usage.calls,6);assert.equal(usage.reportedCalls,4);assert.equal(usage.reportedUsd,null);assert.equal(usage.partialReportedUsd,.00085);assert.equal(usage.estimatedUsd,.006);
 const missing=combineOpenAlexUsage([usage,null]);assert.equal(missing.calls,6);assert.equal(missing.measuredCalls,false);assert.equal(missing.costBasis,"incomplete");
});
test("budget uses the most expensive complete fresh checked search, never a cached or clarification-only zero",()=>{
 const row=count=>({pass:true,mode:"ai",cached:false,openalex:openAlexUsage(attempts(count))});
 const summary=openAlexBudgetSummary([row(20),row(24),{...row(0),cached:true},{...row(0),mode:"clarification"}]);
 assert.equal(summary.maxCallsPerSearch,24);assert.equal(summary.maxUsdPerSearch,.024);assert.equal(summary.recommendedNewTopicsPerDay,37);assert(37*.024<=.9);assert(38*.024>.9);assert.equal(summary.costBasis,"estimate_from_spec");assert.equal(summary.readyToRaiseCap,false);
 assert.equal(openAlexBudgetSummary([row(30)]).recommendedNewTopicsPerDay,30);
});
test("failed searches are included in consumed eval costs, not treated as complete fresh-search prices",()=>{
 const good={pass:true,mode:"ai",openalex:openAlexUsage(attempts(20))},bad={pass:false,openalex:openAlexUsage(attempts(25))};
 const summary=openAlexBudgetSummary([good,bad]);assert.equal(summary.evalCalls,45);assert.equal(summary.evalEstimatedUsd,.045);assert.equal(summary.freshSearches,1);assert.equal(summary.maxCallsPerSearch,20);
 assert.equal(openAlexBudgetSummary([bad]).recommendedNewTopicsPerDay,null);
});
test("a provider-reported sample still cannot authorize a cap raise without protection against heavier searches",()=>{
 const usage=openAlexUsage(fixture.attempts),summary=openAlexBudgetSummary([{pass:true,mode:"ai",openalex:usage}]);assert.equal(summary.costBasis,"provider_reported_usd");assert.equal(summary.maxUsdPerSearch,.00085);assert.equal(summary.readyToRaiseCap,false);
 const allCached=openAlexBudgetSummary([{pass:true,mode:"ai",cached:true,openalex:openAlexUsage([])}]);assert.equal(allCached.recommendedNewTopicsPerDay,null);
});
