import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createWorker} from "./worker.js";
import {MemoryKV} from "./kv-fixture.js";
import {REPORT_CACHE_PREFIX,expansionTerms,reliabilityCheck,growthBaseline} from "./lib.js";
const fixture=name=>JSON.parse(readFileSync(new URL("./fixtures/"+name+".json",import.meta.url),"utf8"));
const payload=params=>JSON.parse(params.messages?.[1]?.content || params.prompt.split("<|im_start|>user\n")[1].split("\n/no_think")[0]);
const date=new Date("2026-11-04T12:00:00Z");
function setup(options={}){
 const kv=new MemoryKV(),calls=[],models=[];let time=0;
 const env={TMM:kv,OPENALEX_KEY:"fixture-placeholder",NEW_TOPICS_PER_DAY:"70",AI_SEARCHES_PER_DAY:"70",AI_EXPAND_SMALL:options.expand?"on":"off",AI:{async run(model,params){
  const data=payload(params);models.push(data);
  if(options.model){const result=await options.model(data,params);if(result!==undefined)return result;}
  const response=data.task==="plan"?{plan:{topic:options.topic || "autism",synonyms:options.synonyms || [],includeGroups:[],excludeTerms:[],years:{from:2010,to:null}},sources:[{path:"topic",source:data.sentence}],ambiguity:null}:data.task==="synonyms"?{terms:["autism spectrum"]}:{pass:data.titles.map(item=>item.id)};
  return {response,usage:{neurons:20}};
 }}};
 const worker=createWorker(async url=>{
  const p=new URL(url).searchParams,filter=p.get("filter") || "";calls.push(p);
  if(options.source){const value=options.source(p);if(value)return value;}
  const groups={publication_year:"years","authorships.author.id":"experts","primary_topic.id":filter.includes("to_publication_date:2022")?"early":"late","authorships.countries":"countries","primary_location.source.id":"journals","keywords.id":"keywords","primary_topic.field.id":"field","primary_topic.subfield.id":"subfields"};
  if(p.get("group_by")==="publication_year" && options.small)return Response.json({group_by:[{key:"2025",key_display_name:"2025",count:40}]});
  if(groups[p.get("group_by")])return Response.json(fixture(groups[p.get("group_by")]));
  if(p.get("select")==="id,display_name")return Response.json({results:Array.from({length:10},(_,i)=>({id:"https://openalex.org/W"+(/to_publication_date:2017/.test(filter)?100+i:200+i),display_name:"Autism study "+i}))});
  if(p.has("search.semantic"))return Response.json({results:[]});
  if(p.get("select")==="id")return Response.json({meta:{count:10},results:[]});
  if(p.get("per_page")==="1")return Response.json({meta:{count:100},results:[]});
  return Response.json(fixture("papers"));
 },()=>date,{now:()=>time,sleep:async ms=>{time+=ms;}});
 const post=async(phase,input)=>{const response=await worker.fetch(new Request("https://worker.invalid/api/search?phase="+phase,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}),env);return {status:response.status,body:await response.json()};};
 return {kv,env,calls,models,post,prepare:(sentence="autism")=>post("prepare",{sentence}),check:report=>post("evidence",{key:report.evidenceKey,id:report.id})};
}
test("one planning call precedes counts; evidence reuses the same cached query without a report rebuild",async()=>{
 const app=setup(),first=await app.prepare();assert.equal(first.status,200);assert.equal(first.body.papersKind,"unavailable");
 assert.deepEqual(app.models.map(data=>data.task),["plan"]);assert(first.body.evidenceKey);
 const calls=app.calls.length,counts=structuredClone(first.body.kpis),years=structuredClone(first.body.years);
 const checked=await app.check(first.body);assert.equal(checked.status,200);assert.equal(checked.body.id,first.body.id);assert.equal(checked.body.papersKind,"checked");
 assert.deepEqual(checked.body.kpis,counts);assert.deepEqual(checked.body.years,years);
 assert(!app.calls.slice(calls).some(p=>p.has("group_by")));assert(app.calls.length<=30);
 assert(!app.models.some(data=>data.task==="self-check"));assert.equal(app.models.filter(data=>data.task==="plan").length,1);
 const before=app.calls.length,models=app.models.length;await app.check(first.body);assert.equal(app.calls.length,before);assert.equal(app.models.length,models);
 assert.equal(app.kv.values.get("count:2026-11-04"),"1");assert.equal(app.kv.values.get("ai:count:2026-11-04"),"1");
});
for(const problem of ["ai_call_timeout","ai_provider_error","ai_bad_json","daily_ai_limit"])test("planner fallback still returns counts: "+problem,async()=>{
 const app=setup({model(data){if(data.task==="plan")throw Object.assign(new Error(problem),{reason:problem});}});
 const result=await app.prepare("How is research on autism growing?");assert.equal(result.status,200);assert(result.body.kpis.total>0);assert.equal(result.body.planningReason,problem);
 assert.equal(app.models.length,1);assert.equal(result.body.searchTerms.name,"autism");
 const ledger=JSON.parse(app.kv.values.get("ai:usage:2026-11-04"));assert.equal(ledger.reserved,0);assert(ledger.used>0);
});
test("typos and question style use the cheap planner's corrected topic",async()=>{
 const app=setup({topic:"artificial intelligence",synonyms:["machine learning"]}),result=await app.prepare("How is rearch on artifical intelligence growing?");
 assert.equal(result.status,200);assert.equal(result.body.searchTerms.name,"artificial intelligence");assert.deepEqual(result.body.synonyms,[]);
});
test("daily AI limit never prevents numbers and reservations settle before report loading",async()=>{
 const app=setup();app.kv.values.set("ai:count:2026-11-04","70");
 const result=await app.prepare();assert.equal(result.status,200);assert.equal(app.models.length,0);
 const checked=await app.check(result.body);assert.equal(checked.body.aiReason,"daily_ai_limit");assert.equal(app.models.length,0);
 assert(app.kv.values.has(REPORT_CACHE_PREFIX+result.body.id));
});
test("evidence retries share one admission and each evidence request gets its own source allowance",async()=>{
 let fail=true;const app=setup({model(data){if(data.titles && fail)throw Object.assign(new Error("temporary model error"),{reason:"ai_provider_error"});}});
 const first=await app.prepare(),afterCounts=app.calls.length,bad=await app.check(first.body);assert.equal(bad.body.aiReason,"ai_provider_error");
 const afterFailure=app.calls.length;assert(afterFailure-afterCounts<=30);fail=false;const good=await app.check(first.body);assert.equal(good.status,200);assert(app.calls.length>afterFailure);
 const retryCalls=app.calls.length-afterFailure;assert(retryCalls<=30);assert(!app.calls.slice(afterCounts).some(params=>params.has("group_by")));
 assert.equal(app.kv.values.get("ai:count:2026-11-04"),"1");
 const record=JSON.parse(app.kv.values.get(first.body.evidenceKey));assert.equal(record.requests,retryCalls);assert.equal(good.body.aiUsage.sourceRequestsTotal,retryCalls);
 const ledger=JSON.parse(app.kv.values.get("ai:usage:2026-11-04"));assert.equal(ledger.reserved,0);
});
test("a spent previous-step allowance does not starve evidence or change saved counts",async()=>{
 const app=setup(),first=await app.prepare(),record=JSON.parse(app.kv.values.get(first.body.evidenceKey));record.requests=30;app.kv.values.set(first.body.evidenceKey,JSON.stringify(record));
 const before=app.calls.length,result=await app.check(first.body);assert.equal(result.status,200);assert.equal(result.body.papersKind,"checked");assert(app.calls.length>before);assert(app.calls.length-before<=30);
 assert.deepEqual(JSON.parse(app.kv.values.get(REPORT_CACHE_PREFIX+first.body.id)).topic.kpis,first.body.kpis);
});
test("missing/expired cached report and query-ID tampering never rebuild a report",async()=>{
 const app=setup(),first=await app.prepare(),before=app.calls.length;
 assert.equal((await app.post("evidence",{key:first.body.evidenceKey,id:"different query"})).status,400);
 app.kv.values.delete(REPORT_CACHE_PREFIX+first.body.id);assert.equal((await app.check(first.body)).status,400);assert.equal(app.calls.length,before);
});
test("title-only warning requires ten titles and a share below thirty percent",()=>{
 assert.equal(reliabilityCheck({matched:2,total:5},{matched:0,total:4}).lowPrecision,false);
 assert.equal(reliabilityCheck({matched:3,total:10},{matched:3,total:10}).lowPrecision,false);
 assert.equal(reliabilityCheck({matched:2,total:10},{matched:3,total:10}).lowPrecision,true);
});
test("recent positive complete years replace a zero growth baseline; no fabricated baseline",()=>{
 assert.equal(growthBaseline([{year:2010,count:0},{year:2020,count:100},{year:2025,count:476}],2010,2025),2020);
 assert.equal(growthBaseline([{year:2010,count:0},{year:2025,count:476}],2010,2025),2010);
});
test("AI expansion refuses broader AI wordings",()=>{
 assert.deepEqual(expansionTerms(["machine learning","deep learning","data science"],{topic:"artificial intelligence",synonyms:[],includeGroups:[]}),[]);
});
test("the seven-day plan cache avoids repeated planning and still respects a changed place mode",async()=>{
 const app=setup(),first=await app.post("prepare",{sentence:"autism in Europe",placeMode:"authored"});
 assert.equal(first.status,200);assert.equal(first.body.understanding.place.mode,"authored");
 const second=await app.post("prepare",{sentence:"autism in Europe",placeMode:"mentions"});
 assert.equal(second.status,200);assert.equal(second.body.understanding.place.mode,"mentions");assert.equal(app.models.length,1);
 assert.notEqual(first.body.id,second.body.id);assert.deepEqual(first.body.understanding.place.codes,second.body.understanding.place.codes);
 const repeated=await app.post("prepare",{sentence:"autism in Europe"});assert.equal(repeated.body.id,first.body.id);assert.equal(app.models.length,1);
 const checked=await app.check(second.body);assert.equal(checked.status,200);const cached=await app.check(second.body);assert.equal(cached.status,200);assert.equal(cached.body.understanding.place.mode,"mentions");assert.equal(cached.body.id,second.body.id);
});
test("unused reservations are released after each returned call, before source work",async()=>{
 let app;app=setup({source(){const ledger=JSON.parse(app.kv.values.get("ai:usage:2026-11-04"));assert.equal(ledger.reserved,0);}});
 const first=await app.prepare();assert.equal(first.status,200);const checked=await app.check(first.body);assert.equal(checked.status,200);
 const ledger=JSON.parse(app.kv.values.get("ai:usage:2026-11-04"));assert.equal(ledger.used,app.models.length*20);assert.equal(ledger.reserved,0);
});
test("missing usage remains conservatively charged rather than refunded",async()=>{
 const app=setup({model(data){if(data.task==="plan")return {response:{plan:{topic:"autism"},sources:[{path:"topic",source:"autism"}]}};}});
 const first=await app.prepare();assert.equal(first.status,200);assert.equal(first.body.aiUsage.measured,false);
 const ledger=JSON.parse(app.kv.values.get("ai:usage:2026-11-04"));assert.equal(ledger.used,first.body.aiUsage.neurons);assert(ledger.used>20);assert.equal(ledger.reserved,0);
});
for(const fail of [false,true])test("related wording suggestions never run a second report or invalidate checked evidence; fail="+fail,async()=>{
 const app=setup({expand:true,small:true,model(data){if(data.task==="synonyms" && fail)throw Object.assign(new Error("expansion timed out"),{reason:"ai_call_timeout"});}});
 const first=await app.prepare(),before=app.calls.length,checked=await app.check(first.body);
 assert.equal(checked.status,200);assert.equal(checked.body.id,first.body.id);assert.deepEqual(checked.body.kpis,first.body.kpis);assert.equal(checked.body.papersKind,"checked");assert(app.calls.length<=30);
 assert(!app.calls.slice(before).some(p=>p.has("group_by")));
 assert(app.models.some(data=>data.task==="synonyms"));
 if(!fail)assert(checked.body.evidence.notices.some(note=>note.startsWith("Related wordings to try:")));
});
test("the sixty-ninth source admission and seventieth AI admission are permitted, then new admissions stop",async()=>{
 const app=setup();app.kv.values.set("count:2026-11-04","69");app.kv.values.set("ai:count:2026-11-04","69");
 const first=await app.prepare();assert.equal(first.status,200);assert.equal(app.kv.values.get("count:2026-11-04"),"70");
 const checked=await app.check(first.body);assert.equal(checked.status,200);assert.equal(app.kv.values.get("ai:count:2026-11-04"),"70");
 const next=await app.prepare("research on a different topic");assert.equal(next.status,429);
});
test("the 9000-neuron guard falls back to counts without overspending",async()=>{
 const app=setup();app.kv.values.set("ai:usage:2026-11-04",JSON.stringify({used:8990,reserved:0}));
 const first=await app.prepare();assert.equal(first.status,200);assert.equal(first.body.planningReason,"daily_neuron_limit");assert.equal(app.models.length,0);
 const checked=await app.check(first.body);assert.equal(checked.body.aiReason,"daily_neuron_limit");assert.equal(app.models.length,0);
 assert.deepEqual(JSON.parse(app.kv.values.get("ai:usage:2026-11-04")),{used:8990,reserved:0});
});
test("planning cache expires at seven days, and a corrupt cache falls back safely",async()=>{
 const app=setup();await app.prepare();
 const key=[...app.kv.values.keys()].find(key=>key.endsWith(":plan")),record=JSON.parse(app.kv.values.get(key));record.savedAt-=7*86400000;app.kv.values.set(key,JSON.stringify(record));
 assert.equal((await app.prepare()).status,200);assert.equal(app.models.length,2);
 app.kv.values.set(key,JSON.stringify({...record,savedAt:date.getTime(),raw:{topic:null}}));assert.equal((await app.prepare()).status,200);assert.equal(app.models.length,3);
});
test("failure to store the optional evidence token cannot erase a successful count report",async()=>{
 const app=setup(),put=app.kv.put.bind(app.kv);app.kv.put=async(key,...args)=>{if(key.startsWith("ai:prepared:"))throw new Error("optional store failed");return put(key,...args);};
 const first=await app.prepare();assert.equal(first.status,200);assert(first.body.kpis.total>0);assert.equal(first.body.evidenceKey,null);assert.match(first.body.evidenceMessage,/Retry/);
});
