import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateGroundedResponse,compileAIPlan,normaliseQuery,queryParams,buildQueries,shapeTopic,updateLibrary,publicLibrary,REPORT_CACHE_PREFIX} from "./lib.js";
import "../site/query-parser.js";
import {createWorker} from "./worker.js";
import {MemoryKV} from "./kv-fixture.js";
const places=globalThis.TMM_PLACES,date=new Date("2026-11-04T12:00:00Z");
const fixture=id=>JSON.parse(readFileSync(new URL("./fixtures/"+id+".json",import.meta.url),"utf8"));
function plan(sentence){return validateGroundedResponse({plan:{topic:"autism"},sources:[{path:"topic",source:"autism"}]},sentence,2026).plan;}
for(const sentence of ["autism in Europe","autism in Europe and the Middle East","autism in Africa and Asia"])test("dictionary filters round-trip through the real Worker and cache without inference: "+sentence,async()=>{
 const raw=plan(sentence),kv=new MemoryKV();
 const worker=createWorker(()=>assert.fail("No live source or inference"),()=>date);
 for(const mode of ["authored","mentions"]){
  const query=compileAIPlan(raw,2026,mode).query;
  assert(new TextEncoder().encode(REPORT_CACHE_PREFIX+query.id).length<=512);
  const descriptors=buildQueries(query,2026),topic=shapeTopic(query,Object.fromEntries(descriptors.map(({id})=>[id,fixture(id)])),date);
  kv.values.set(REPORT_CACHE_PREFIX+query.id,JSON.stringify({savedAt:date.getTime(),topic}));
  kv.values.set("library",JSON.stringify(updateLibrary([],topic)));
  const response=await worker.fetch(new Request("https://worker.invalid/api/topic?"+queryParams(query)+"&cache=only"),{TMM:kv});
  assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.id,query.id);assert.equal(saved.placeMode,mode);assert.deepEqual(saved.placeIds,raw.place.ids);
  if(mode==="authored")assert.deepEqual(saved.authoredCodes,raw.place.codes);else assert.equal(saved.authoredCodes,undefined);
  assert.deepEqual(publicLibrary(JSON.parse(kv.values.get("library"))),[]);
  for(const descriptor of descriptors)assert(new URL("https://api.openalex.org/works?"+new URLSearchParams(descriptor.params)).href.length<3800);
 }
});
test("default author queries retain existing country-code cache identities where they fit",()=>{
 const query=compileAIPlan(plan("autism in the GCC"),2026).query;
 const old=normaliseQuery("autism","","",[],2010,null,2026,"",undefined,{authoredCodes:["AE","BH","KW","OM","QA","SA"]});
 assert.equal(query.id,old.id);
});
test("unknown dictionary IDs, duplicate filters and invalid modes fail before source work",async()=>{
 const worker=createWorker(()=>assert.fail("No source calls"),()=>date),env={TMM:new MemoryKV()};
 for(const params of ["places=unknown","places=__proto__","places=constructor","places=europe@1@2","places=europe&places=mena","places=country:WJ","places=europe&placeMode=anything","places=europe&placeMode=authored&placeMode=mentions"]){
  const response=await worker.fetch(new Request("https://worker.invalid/api/topic?q=autism&"+params),env);assert.equal(response.status,400);
 }
});
test("all configured names/aliases carry only recognized country codes",()=>{
 for(const entry of Object.values(places.byId))for(const code of entry.codes)assert(places.countryCodes.includes(code));
 assert(!places.resolve("autism in MENA").codes.includes("SD"));
});
