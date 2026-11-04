// Edit the shared fixture questions/expectations before a demo. Normal free caps apply.
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { combineOpenAlexUsage, openAlexBudgetSummary } from "../worker/lib.js";
export const evaluationCases = JSON.parse(readFileSync(new URL("../worker/fixtures/eval-questions.json", import.meta.url), "utf8"));
export const questions = evaluationCases.map(item=>item.question);
export function formatEvaluation(question, data, status = 200) {
  const openalex=data.openalexUsage || null;
  if (status !== 200) return { question, status, openalex, error: data.message || data.error || "The Worker could not complete this search.", neurons: data.aiUsage?.neurons ?? null, measured: data.aiUsage?.measured === true, aiNotUsedReason: data.aiReason || data.error || "request_failed", aiUsage:data.aiUsage || null, failingCheck:data.failingCheck || null,ambiguities:data.ambiguities || [],plan: data.understood ? {topic:data.understood.topic,includeGroups:data.understood.includeGroups,from:data.understood.from,to:data.understood.to} : null };
  if(data.planOnly)return {question,openalex,mode:"plan_only",plan:data.plan,note:data.message,neurons:data.aiUsage?.neurons??null,measured:data.aiUsage?.measured===true,aiUsage:data.aiUsage||null,aiNotUsedReason:data.aiReason};
  if(data.clarification)return {question,openalex,mode:"clarification",clarification:data.clarification,neurons:data.aiUsage?.neurons??null,measured:data.aiUsage?.measured===true,aiUsage:data.aiUsage||null,aiNotUsedReason:"clarification"};
  const ready=data.papersKind==="checked" && data.evidence?.version===3 && data.understanding?.mode==="ai" && data.understanding?.check;
  return { question, openalex, mode: data.understanding?.mode || "not_used", neurons: data.aiUsage?.neurons ?? null, measured: data.aiUsage?.measured === true, aiUsage: data.aiUsage || null, aiNotUsedReason: data.understanding?.mode === "ai" ? null : data.aiReason || data.understanding?.reason || "no_checked_evidence", cached: data.cached === true,
    plan: { topic: data.searchTerms?.name || data.name, synonyms: data.synonyms || [], includeGroups: data.includeGroups || (data.includeTerms?.length ? [data.includeTerms] : []),
      place: data.understanding?.place || null, authoredCodes: data.authoredCodes || [], exclusions: data.excludeTerms || [], from: data.from, to: data.to ?? null },
    checked: data.understanding?.check || null, notices: data.evidence?.notices || [],ambiguityNotice:data.understanding?.note || null,
    papers: (ready ? data.papers || [] : []).slice(0, 5).map(({ title, year, citations, url }) => ({title, year, citations, url})),
    experts: (ready ? data.experts || [] : []).slice(0, 3).map(({name, count, openalexUrl}) => ({name, count, url:openalexUrl})) };
}
export function checkExpectation(result, expected = {}, clarification = null) {
  const errors=[];
  if(expected.clarification && !(result.mode==="ai" && result.ambiguityNotice) && (!clarification || !new RegExp(expected.clarification.pattern,"i").test(clarification.question)))errors.push("Expected clarification: "+expected.clarification.pattern);
  if(clarification && (!Array.isArray(clarification.options) || clarification.options.length<2 || clarification.options.length>3))errors.push("Clarification needs 2–3 ready choices");
  for(const title of expected.forbiddenPapers || [])if((result.papers||[]).some(paper=>paper.title===title))errors.push("Rejected title shown: "+title);
  if(result.mode==="clarification"){
    if(!expected.clarification)errors.push("Unexpected clarification");
  } else {
    if(result.mode!=="ai" || !result.checked)errors.push("No checked report");
    const plan=result.plan || {},text=JSON.stringify([plan.topic,plan.synonyms,plan.includeGroups]).toLowerCase();
    if(expected.topic && !expected.topic.some(word=>(plan.topic||"").toLowerCase().includes(word.toLowerCase())))errors.push("Wrong topic");
    for(const word of expected.groups || [])if(!text.includes(word.toLowerCase()))errors.push("Missing concept: "+word);
    if(expected.from!==undefined && plan.from!==expected.from)errors.push("Wrong start year");
    for(const word of expected.exclusions || [])if(!(plan.exclusions||[]).some(term=>term.toLowerCase().includes(word)))errors.push("Missing exclusion: "+word);
    if(expected.region){const label=plan.place?.label||"";if(label!==(expected.region==="gcc"?"GCC":"Middle East"))errors.push("Wrong region");}
  }
  if(!result.openalex?.measuredCalls)errors.push("Missing OpenAlex call measurement; deploy the updated Worker");
  if(!result.measured)errors.push("Missing measured neuron usage");
  if(result.mode==="ai" && result.aiUsage?.calls>0 && !result.aiUsage.stages?.selfCheck?.calls)errors.push("Missing self-check usage; deploy the updated Worker");
  return {pass:errors.length===0,errors};
}
export function combineUsage(usages) {
  const total={neurons:0,calls:0,sourceCalls:0,measured:true,byModel:{},stages:{},errors:[],repairs:[],turns:[],checks:[],ambiguities:[],notes:[],totalMs:0};
  for(const usage of usages){
    if(!usage || !Number.isFinite(usage.neurons) || usage.neurons<0){total.measured=false;continue;}
    if(Number.isInteger(usage.sourceCalls)&&usage.sourceCalls>=0&&total.sourceCalls!==null)total.sourceCalls+=usage.sourceCalls;else total.sourceCalls=null;
    total.errors.push(...(usage.errors||[]));
    total.repairs.push(...(usage.repairs||[]));
    total.checks.push(...(usage.checks||[]));total.ambiguities.push(...(usage.ambiguities||[]));total.notes.push(...(usage.notes||[]));
    total.turns.push(...(usage.turns||[]));total.totalMs+=usage.totalMs||0;
    if(usage.terminalReason)total.terminalReason=usage.terminalReason;
    if(usage.advisoryReason)total.advisoryReason=usage.advisoryReason;
    total.neurons+=usage.neurons;total.calls+=usage.calls||0;total.measured&&=usage.measured===true;
    for(const [model,cost] of Object.entries(usage.byModel||{}))total.byModel[model]=(total.byModel[model]||0)+cost;
    for(const [stage,part] of Object.entries(usage.stages||{})){
      const target=total.stages[stage] ||= {calls:0,neurons:0};target.calls+=part.calls;target.neurons+=part.neurons;target.ms=(target.ms||0)+(part.ms||0);
    }
  }
  return total;
}
export async function evaluateQuestions(worker, list = evaluationCases, fetcher = fetch, emit = value => console.log(JSON.stringify(value, null, 2))) {
  let failed = false;
  for (const entry of list) {
    const {question,expected}=typeof entry==="string"?{question:entry,expected:{}}:entry;
    const request=async body=>{
      const response=await fetcher(new URL("/api/search",worker),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});
      return formatEvaluation(question,await response.json(),response.status);
    };
    const usages=[],sourceUsages=[];
    try {
      let result=await request({sentence:question});
      usages.push(result.aiUsage);sourceUsages.push(result.openalex);
      const clarification=result.clarification || null;
      let selectedOption=null;
      // Only answer explicitly configured fixture choices; never guess an unexpected ambiguity.
      if(clarification && Number.isInteger(expected?.clarification?.answer)){
        const index=expected.clarification.answer;
        if(clarification.key && clarification.options?.[index]){
          selectedOption=clarification.options[index].label;
          result=await request({sentence:question,clarification:{key:clarification.key,option:index}});usages.push(result.aiUsage);sourceUsages.push(result.openalex);
        }
      }
      const usage=combineUsage(usages);
      result={...result,openalex:combineOpenAlexUsage(sourceUsages),aiUsage:usage,neurons:usage.neurons,measured:usage.measured,...(clarification?{clarification,selectedOption}:{})};
      const verdict=checkExpectation(result,expected,clarification);
      emit({...result,expectation:expected,pass:verdict.pass,failures:verdict.errors});
      if(!verdict.pass)failed=true;
    } catch (error) { failed = true; const known=combineUsage(usages);emit({question,pass:false,error:String(error.message || error),aiNotUsedReason:"request_failed",openalex:{...combineOpenAlexUsage(sourceUsages),measuredCalls:false,costBasis:"incomplete"},neurons:usages.length?known.neurons:null,measured:false,aiUsage:{...known,measured:false}}); }
  }
  return !failed;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) console.log("Usage: node tools/eval-questions.mjs [--worker https://your-worker.workers.dev] [--limit N] [--output report.json]\nEdit worker/fixtures/eval-questions.json. Prints expected-result pass/fail and measured usage including all planning, re-plans, self-checks and judging. Configured clarification answers include both requests in the cost. Includes real OpenAlex call counts, explicitly reported USD when present, and clearly labelled estimates otherwise. Saves tools/eval-results-latest.json by default. Cached reports cost zero; live searches use normal daily limits.");
  else {
    const worker = args.includes("--worker") ? args[args.indexOf("--worker") + 1] : "https://topic-momentum-meter.michelegambino24.workers.dev";
    const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : evaluationCases.length;
    if (!Number.isInteger(limit) || limit < 1 || limit > evaluationCases.length) throw new Error("Choose a limit between 1 and " + evaluationCases.length + ".");
    const output=args.includes("--output")?args[args.indexOf("--output")+1]:"tools/eval-results-latest.json";
    if(!output || output.startsWith("--"))throw new Error("Choose an output file path.");
    const rows=[];
    const passed=await evaluateQuestions(worker,evaluationCases.slice(0,limit),fetch,row=>{rows.push(row);console.log(JSON.stringify(row,null,2));});
    const summary=openAlexBudgetSummary(rows);
    writeFileSync(output,JSON.stringify({created:new Date().toISOString(),worker,passed,questions:rows,openalexSummary:summary},null,2)+"\n");
    console.log(JSON.stringify({openalexSummary:summary,savedReport:output},null,2));
    if(!passed)process.exitCode=1;
  }
}
