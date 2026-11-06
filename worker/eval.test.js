import { test } from "node:test";
import assert from "node:assert/strict";
import { openAlexUsage } from "./lib.js";
import { evaluateQuestions, formatEvaluation } from "../tools/eval-questions.mjs";

test("demo evaluation is sequential, prints plan/checks/top lists and flags unverified searches", async () => {
  const outputs=[],calls=[];
  const body={openalexUsage:openAlexUsage([]),papersKind:"checked",evidence:{version:3},aiUsage:{neurons:7,measured:true,calls:3,stages:{planning:{neurons:3,calls:1},selfCheck:{neurons:1,calls:1},judging:{neurons:3,calls:1}}},name:"social media",synonyms:[],includeTerms:["attention span"],from:2010,kpis:{total:10},
    understanding:{mode:"ai",check:{matched:14,total:20,early:{matched:7,total:10},late:{matched:7,total:10}}},
    papers:Array.from({length:10},(_,i)=>({title:"Checked title "+i,year:2025,citations:10-i,url:"https://openalex.org/W"+i})),
    experts:Array.from({length:4},(_,i)=>({name:"Researcher "+i,count:4-i}))};
  const success=await evaluateQuestions("https://fixture.example",["question A","question B"],async(url,options)=>{
    calls.push(JSON.parse(options.body).sentence); assert.equal(url.pathname,"/api/search");assert.equal(options.method,"POST");
    return Response.json(body);
  },result=>outputs.push(result));
  assert(success);assert.deepEqual(calls,["question A","question B"]);
  assert.equal(outputs[0].neurons,7);assert.equal(outputs[0].measured,true);assert.equal(outputs[0].papers.length,5);assert.equal(outputs[0].experts.length,3);assert.equal(outputs[0].checked.early.matched,7);
  assert.equal(outputs[0].plan.includeGroups[0][0],"attention span");
  assert.equal(await evaluateQuestions("https://fixture.example",["question"],async()=>Response.json({...body,understanding:{mode:"quick"}}),()=>{}),false);
  assert.equal(formatEvaluation("question",{message:"Daily limit reached"},429).status,429);
});

test("historical eight-question measurements remain valid records, predating source grounding and self-check",async()=>{
  const {AI_DAILY_CAP}=await import("./ai.js");
  // This file records the earlier Cloudflare-era measurements, so it keeps its own model names and 9000-neuron budget.
  const AI_MODEL="@cf/meta/llama-3.3-70b-instruct-fp8-fast",JUDGE_MODEL="@cf/qwen/qwen3-30b-a3b-fp8",AI_DAILY_NEURONS=9000;
  const {readFileSync}=await import("node:fs");
  const result=JSON.parse(readFileSync(new URL("../tools/evidence-measurements-final.json",import.meta.url),"utf8"));
  const canonical=JSON.parse(readFileSync(new URL("./fixtures/eval-questions.json",import.meta.url),"utf8"));
  assert.deepEqual(result.searches.map(row=>row.question),canonical.slice(0,8).map(row=>row.question));assert.equal(result.searches.length,8);
  for(const row of result.searches){assert.equal(row.mode,"ai");assert(row.measured&&row.neurons>0);assert.equal(row.aiNotUsedReason,null);assert(row.aiUsage.byModel[AI_MODEL]>0);assert(row.aiUsage.byModel[JUDGE_MODEL]>0);assert(row.aiUsage.sourceCalls<=30);assert(Math.abs(row.actualModelCalls.reduce((sum,call)=>sum+call.neurons,0)-row.neurons)<.0001);}
  assert(AI_DAILY_CAP>=40);assert(Math.max(...result.searches.map(row=>row.neurons))*AI_DAILY_CAP<AI_DAILY_NEURONS);
});


test("evaluation includes clarification, all re-plans and self-checks in one measured search total",async()=>{
 const outputs=[],requests=[],key="ai:clarify:v1:11111111-1111-4111-8111-111111111111";
 const result=await evaluateQuestions("https://fixture.example",[{question:"ASD in adolescents",expected:{topic:["autism"],clarification:{pattern:"ASD",answer:1}}}],async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  if(!body.clarification)return Response.json({openalexUsage:openAlexUsage([]),clarification:{key,question:"Which ASD?",options:[{label:"Atrial septal defect"},{label:"Autism"}]},aiUsage:{neurons:3,measured:true,calls:1,stages:{planning:{neurons:3,calls:1}}}});
  return Response.json({openalexUsage:openAlexUsage([]),papersKind:"checked",evidence:{version:3},searchTerms:{name:"autism"},understanding:{mode:"ai",check:{matched:20,total:20}},aiUsage:{neurons:17,measured:true,calls:4,stages:{planning:{neurons:4,calls:1},replan:{neurons:5,calls:1},selfCheck:{neurons:6,calls:1},judging:{neurons:2,calls:1}}}});
 },row=>outputs.push(row));
 assert(result);assert.equal(requests.length,2);assert.equal(requests[1].clarification.option,1);assert.equal(outputs[0].neurons,20);assert.equal(outputs[0].aiUsage.calls,5);assert.equal(outputs[0].aiUsage.stages.replan.neurons,5);assert.equal(outputs[0].aiUsage.stages.selfCheck.neurons,6);assert.equal(outputs[0].selectedOption,"Autism");assert(outputs[0].pass);
});
test("evaluation fails wrong essentials, forbidden papers, unexpected or malformed clarification",async()=>{
 const {checkExpectation}=await import("../tools/eval-questions.mjs");
 const plan={mode:"ai",checked:{},measured:true,plan:{topic:"wind energy",includeGroups:[["wildlife"]],from:2020},papers:[{title:"Unrelated paper"}]};
 assert(!checkExpectation(plan,{topic:["solar energy"]}).pass);assert(!checkExpectation(plan,{forbiddenPapers:["Unrelated paper"]}).pass);
 assert(!checkExpectation({mode:"clarification",measured:true},{}).pass);
 assert(!checkExpectation({mode:"clarification",measured:true},{clarification:{pattern:"Meaning"}},{question:"Meaning?",options:[]}).pass);
});


test("eval preserves all OpenAlex calls across a clarification and checked search",async()=>{
 const outputs=[],key="ai:clarify:v1:11111111-1111-4111-8111-111111111111";
 const source=openAlexUsage(Array.from({length:22},(_,i)=>({query:i<2?"checkearly":"papers",stage:i<2?"tighteningReliability":"report",attempt:1,status:200,reportedUsd:null})));
 const ok=await evaluateQuestions("https://fixture.example",[{question:"ASD",expected:{topic:["autism"],clarification:{pattern:"ASD",answer:0}}}],async(_url,options)=>{
  if(!JSON.parse(options.body).clarification)return Response.json({openalexUsage:openAlexUsage([]),clarification:{key,question:"Which ASD?",options:[{label:"Autism"},{label:"Atrial septal defect"}]},aiUsage:{neurons:3,measured:true,calls:1,sourceCalls:0}});
  return Response.json({openalexUsage:source,papersKind:"checked",evidence:{version:3},searchTerms:{name:"autism"},understanding:{mode:"ai",check:{matched:20,total:20}},aiUsage:{neurons:10,measured:true,calls:2,sourceCalls:22,stages:{selfCheck:{neurons:5,calls:1},judging:{neurons:5,calls:1}}}});
 },row=>outputs.push(row));
 assert(ok);assert.equal(outputs[0].openalex.calls,22);assert.equal(outputs[0].openalex.estimatedUsd,.022);assert.equal(outputs[0].openalex.reportedUsd,null);assert.equal(outputs[0].aiUsage.sourceCalls,22);assert.equal(outputs[0].neurons,13);
});
