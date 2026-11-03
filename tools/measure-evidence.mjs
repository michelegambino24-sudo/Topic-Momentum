// Live, isolated full-Worker benchmark. Existing credentials stay in memory.
// Production KV counters are never reset or changed by this script.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createWorker } from "../worker/worker.js";
import { AI_MODEL, JUDGE_MODEL } from "../worker/ai.js";
import { MemoryKV } from "../worker/kv-fixture.js";
import { questions, formatEvaluation } from "./eval-questions.mjs";
export async function measure({account,token,sourceKey,list=questions,baseline=0,emit=row=>console.log(JSON.stringify(row)),output}) {
  const kv=new MemoryKV(),day=new Date().toISOString().slice(0,10),rows=[],modelCalls=[];
  kv.values.set("ai:usage:"+day,JSON.stringify({used:baseline,reserved:0}));
  const AI={async run(model,params){
    const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+account+"/ai/run/"+model,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(params),signal:AbortSignal.timeout(25000)});
    const data=await response.json();if(!response.ok||!data.success)throw new Error("Workers AI failed: "+response.status+" "+JSON.stringify(data.errors||[]));
    modelCalls.push({model,neurons:data.result?.usage?.neurons??null});return data.result;
  }};
  const worker=createWorker(),env={TMM:kv,OPENALEX_KEY:sourceKey,AI,AI_MODEL,NEW_TOPICS_PER_DAY:"30",AI_SEARCHES_PER_DAY:"50",AI_TIMEOUT_MS:"12000"};
  for(const question of list){
    const before=modelCalls.length;
    const response=await worker.fetch(new Request("http://localhost/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sentence:question})}),env);
    const row={...formatEvaluation(question,await response.json(),response.status),actualModelCalls:modelCalls.slice(before)};
    rows.push(row);emit(row);
    if(output)writeFileSync(output,JSON.stringify({created:new Date().toISOString(),planningModel:AI_MODEL,judgingModel:JUDGE_MODEL,method:"Full final Worker with live AI and authenticated OpenAlex; isolated in-memory KV; normal per-search and free-neuron limits; no fixture judgments",baselineNeurons:baseline,totalMeasuredNeurons:modelCalls.reduce((sum,call)=>sum+(call.neurons||0),0),maxSearchNeurons:Math.max(...rows.map(row=>row.neurons||0)),ledger:JSON.parse(kv.values.get("ai:usage:"+day)),searches:rows},null,2)+"\n");
  }
  return rows.every(row=>row.mode==="ai"&&row.measured);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
  if(args.includes("--help"))console.log("node tools/measure-evidence.mjs --account <existing account ID> [--limit 1..8] [--baseline <neurons already used>] [--output measurements.json]\nRuns real free AI/OpenAlex requests using the existing Wrangler session and worker/.dev.vars. Credentials are never printed or stored. No login, deployment or production-counter reset.");
  else{
    const account=value("--account",process.env.CLOUDFLARE_ACCOUNT_ID),limit=Number(value("--limit","8")),start=Number(value("--start","0")),baseline=Number(value("--baseline","0"));
    if(!account||!Number.isInteger(limit)||limit<1||limit>8||!Number.isInteger(start)||start<0||start>7||!Number.isFinite(baseline)||baseline<0)throw new Error("Supply the existing account ID, valid limit/start and nonnegative used-neuron baseline.");
    const settings=readFileSync(join(process.env.APPDATA,"xdg.config",".wrangler","config","default.toml"),"utf8"),token=settings.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    const vars=readFileSync(new URL("../worker/.dev.vars",import.meta.url),"utf8"),matched=vars.match(/^OPENALEX_KEY\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\r\n#]+))/m),sourceKey=matched?.slice(1).find(Boolean)?.trim();
    if(!token||!sourceKey)throw new Error("Existing local credentials are unavailable. No login or setup was attempted.");
    const ok=await measure({account,token,sourceKey,baseline,list:questions.slice(start,start+limit),output:value("--output","tools/evidence-measurements-latest.json")});if(!ok)process.exitCode=1;
  }
}
