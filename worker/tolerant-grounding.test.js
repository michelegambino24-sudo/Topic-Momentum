import {test} from "node:test";
import assert from "node:assert/strict";
import {uncoveredWords,fuzzySpan,groundPlan,selfCheckRequirements,validateGroundedResponse,questionContentWords} from "./lib.js";
import "../site/query-parser.js";
const parser=globalThis.TMM_QUERY_PARSER,places=globalThis.TMM_PLACES;
const base=()=>({topic:"ptsd",synonyms:[],includeGroups:[],place:{codes:[],mode:"authored"},excludeTerms:[],years:{from:2010,to:null}});
const reply=(topic,source,extra={})=>({plan:{...base(),topic,...extra.plan},sources:[{path:"topic",source},...(extra.sources||[])],ambiguity:null});

test("typos, plurals and different wording of the same word are the same word",()=>{
 assert(parser.sameWord("studies","study"));assert(parser.sameWord("researches","research"));
 assert(parser.sameWord("toddlers","toddler"));assert(parser.sameWord("autisim","autism"));assert(!parser.sameWord("2020","2021"));assert(!parser.sameWord("cat","car"));
 assert(parser.isAcronymOf("ptsd",["post","traumatic","stress","disorder"]));assert(parser.isAcronymOf("adhd",["attention","deficit","hyperactivity","disorder"]));
 assert(parser.isFiller("rearch"));assert(parser.isFiller("reserach"));assert(parser.isFiller("area"));assert(parser.isFiller("rising"));assert(!parser.isFiller("autism"));assert(!parser.isFiller("ptsd"));
});
test("research-word typos and region nouns are never required concepts",()=>{
 assert.deepEqual(questionContentWords("is rearch on ptsd growing in the MENA area?"),["ptsd","mena"]);
 assert.deepEqual(questionContentWords("are studdies on autism booming across all countries"),["autism"]);
 assert.equal(places.resolve("is research on ptsd growing in the MENA area?").withoutPlaces.includes("area"),false);
 assert.equal(places.resolve("research on autism in the Europe region").withoutPlaces.includes("region"),false);
 assert.deepEqual(parser.questionParts("is rearch on ptsd growing in the MENA area?",2026).concepts,["ptsd"]);
});
const sentences=["Is research on PTSD growing in the MENA area?","is rearch on ptsd growing in the mena area","Is PTSD research rising across the Middle East?","How is PTSD research changing in MENA countries?","Are studies on PTSD becoming more popular in the Middle East region?","ptsd middle east trend"];
for(const sentence of sentences)test("PTSD plan is fully covered however it is phrased: "+sentence,()=>{
 const literal=sentence.match(/ptsd/i)[0];
 const grounded=groundPlan(validateGroundedResponse(reply("PTSD",literal),sentence,2026),sentence,2026);
 assert.deepEqual(grounded.missing,[]);assert.equal(grounded.plan.topic,"PTSD");
});
test("a model that spells the topic out, or hyphenates it, is still understood",()=>{
 const sentence="Is research on post traumatic stress disorder growing in the Middle East?";
 for(const topic of ["post-traumatic stress disorder","PTSD","post traumatic stress disorder research"]){
  const result=groundPlan(validateGroundedResponse(reply(topic,topic),sentence,2026),sentence,2026);
  assert.deepEqual(result.missing,[],topic);assert.notEqual(result.plan.topic,"",topic);
 }
 const acronym="Is research on PTSD growing?";
 const result=groundPlan(validateGroundedResponse(reply("post-traumatic stress disorder","PTSD"),acronym,2026),acronym,2026);
 assert.deepEqual(result.missing,[]);
});
test("a model quote with a plural or typo is repaired to the literal words of the question",()=>{
 assert.equal(fuzzySpan("toddler screen times","How does screen time affect toddlers?"),"screen time affect toddlers");
 assert.equal(fuzzySpan("screen-time","How does screen time affect toddlers?"),"screen time");
 assert.equal(fuzzySpan("toddler","How does screen time affect toddlers?"),"toddlers");
 assert.equal(fuzzySpan("PTSD","post-traumatic stress disorder trends"),"post-traumatic stress disorder");
 assert.equal(fuzzySpan("autism genetics","research on autism"),"");
});
test("a concept that is really dropped is still reported",()=>{
 const sentence="Is research on PTSD and sleep growing in the Middle East?";
 const grounded=groundPlan(validateGroundedResponse(reply("PTSD","PTSD"),sentence,2026),sentence,2026);
 assert.deepEqual(grounded.missing,["sleep"]);
 assert.deepEqual(uncoveredWords("ptsd and insomnia in teenagers",[{source:"ptsd"}],base()),["insomnia","teenagers"]);
});
test("a model objection to something the plan already holds, or filler, never blocks a search",()=>{
 const sentence="Is research on PTSD growing in the MENA area?";
 const result=selfCheckRequirements({ok:false,missing:["PTSD","growing","MENA area","area"]},sentence,base());
 assert.deepEqual(result.blocking,[]);
 const real=selfCheckRequirements({ok:false,missing:["insomnia"]},"PTSD and sleep",base());
 assert.deepEqual(real.ignored.map(item=>item.reason),["not_quoted_from_question"]);
 const quoted=selfCheckRequirements({ok:false,missing:["sleep"]},"PTSD and sleep in veterans",base());
 assert.deepEqual(quoted.blocking,["sleep"]);
});
test("year phrasings are recognised and quoted exactly",()=>{
 for(const [text,from,to] of [["autism research since 2018",2018,null],["autism research from 2015 to 2020",2015,2020],["autism research between 2015 and 2020",2015,2020],["autism research until 2019",2010,2019],["autism research in the last 5 years",2021,null],["autism research in 2019",2019,2019]]){
  const parts=parser.questionParts(text,2026);
  assert.equal(parts.from,from,text);assert.equal(parts.to,to,text);assert.equal(parts.explicitRange,true,text);
  const sources=Object.values(parts.rangeSources).filter(Boolean);assert(sources.length&&sources.every(source=>text.includes(source)),text);
 }
});
test("filler-only include groups left behind by place stripping are dropped",()=>{
 const sentence="Is research on PTSD growing in the MENA area?";
 const value=validateGroundedResponse({plan:{...base(),includeGroups:[{terms:["region"]},{terms:["area"]}]},sources:[{path:"topic",source:"PTSD"},{path:"includeGroups.0",source:"area"}],ambiguity:null},sentence,2026);
 assert.deepEqual(value.plan.includeGroups,[]);
});
test("framing words the person did not type as a phrase are not searched as a literal phrase",()=>{
 const sentence="is rearch on ptsd growing in the MENA area?";
 const value=validateGroundedResponse({plan:{...base(),topic:"ptsd research",synonyms:["post-traumatic stress disorder studies"]},sources:[{path:"topic",source:"ptsd"},{path:"synonyms.0",source:"ptsd"}],ambiguity:null},sentence,2026);
 assert.equal(value.plan.topic,"ptsd");assert.deepEqual(value.plan.synonyms,["post-traumatic stress disorder"]);
 const kept=validateGroundedResponse({plan:{...base(),topic:"operations research"},sources:[{path:"topic",source:"operations research"}],ambiguity:null},"Is operations research growing?",2026);
 assert.equal(kept.plan.topic,"operations research");
});
