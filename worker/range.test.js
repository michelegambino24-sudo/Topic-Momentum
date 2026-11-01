import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseQuery, validateRange, rangeDetails, buildQueries, shapeTopic, presentReport, updateLibrary, publicLibrary, momentum } from "./lib.js";
import { createWorker } from "./worker.js";
import { MemoryKV } from "./kv-fixture.js";

const date = new Date("2026-11-01T12:00:00Z");
const fixtures = () => Object.fromEntries(["years", "experts", "early", "late", "countries", "uae", "gcc", "journals", "papers", "keywords", "field"].map((name) => [name, JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"))]));
const query = (from = 2010, to = "", include = "", subtopic = "") => normaliseQuery("moss", "moon circuits", subtopic, include, from, to, 2026);

test("year validation accepts the boundaries and rejects missing, malformed, future and reversed years", () => {
  assert.deepEqual(validateRange(2000, 2026, 2026), { from: 2000, to: 2026 });
  assert.deepEqual(validateRange(2024, "", 2026), { from: 2024, to: null });
  assert.deepEqual(validateRange(2026, 2026, 2026), { from: 2026, to: 2026 });
  for (const from of ["", null, 1999, 2027, "2023x", "2023.5", "2e3"]) assert.throws(() => validateRange(from, "", 2026), /From year/);
  for (const to of [1999, 2027, "bad", "2023.5", "2e3"]) assert.throws(() => validateRange(2010, to, 2026), /To year/);
  assert.throws(() => validateRange(2024, 2023, 2026), /The From year must be/);
});

test("one yearly query retains 2010 onward, extends before 2010, and aggregate queries use both bounds", () => {
  for (const [from, to] of [[2000, 2005], [2015, 2020], [2023, ""], [2024, 2026], [2026, 2026]]) {
    const q = query(from, to, "child,children", "T123");
    const descriptors = buildQueries(q, 2026);
    const byId = Object.fromEntries(descriptors.map((item) => [item.id, item.params]));
    assert.equal(descriptors.length, 11);
    assert.equal(descriptors.filter((item) => item.params.group_by === "publication_year").length, 1);
    assert(byId.years.filter.endsWith(`publication_year:${Math.min(2010, from)}-2026`));
    for (const id of ["countries", "uae", "gcc", "journals", "papers", "experts"]) {
      assert(byId[id].filter.includes(`from_publication_date:${from}-01-01`), id);
      assert.equal(byId[id].filter.includes("to_publication_date:"), to !== "");
      if (to !== "") assert(byId[id].filter.includes(`to_publication_date:${to}-12-31`));
    }
    for (const { params } of descriptors) assert(params.filter.startsWith('title_and_abstract.search:(moss OR "moon circuits") AND (child OR children),primary_topic.id:T123,'));
  }
  for (const from of [2000, 2010, 2019]) {
    assert(buildQueries(query(from), 2026).find((item) => item.id === "experts").params.filter.includes("from_publication_date:2020-01-01"));
    assert(buildQueries(query(from, 2025), 2026).find((item) => item.id === "experts").params.filter.includes(`from_publication_date:${from}-01-01,to_publication_date:2025-12-31`));
  }
});

test("sub-topic halves use complete years only and put the odd extra year in the second half", () => {
  for (const [from, to, early, late] of [
    [2015, 2020, [2015, 2017], [2018, 2020]],
    [2021, 2025, [2021, 2022], [2023, 2025]],
    [2023, "", [2023, 2023], [2024, 2025]],
    [2024, 2026, [2024, 2024], [2025, 2025]]
  ]) {
    const byId = Object.fromEntries(buildQueries(query(from, to), 2026).map((item) => [item.id, item.params]));
    assert(byId.early.filter.endsWith(`from_publication_date:${early[0]}-01-01,to_publication_date:${early[1]}-12-31`));
    assert(byId.late.filter.endsWith(`from_publication_date:${late[0]}-01-01,to_publication_date:${late[1]}-12-31`));
  }
  for (const from of [2025, 2026]) {
    const q = query(from);
    const report = shapeTopic(q, fixtures(), date);
    assert.equal(report.subtopicWindow.countsOnly, true);
    assert(report.subtopics.every((item) => item.growth === null));
    assert([...buildQueries(q, 2026), ...buildQueries(q, 2026, false)].find((item) => item.id === "late").params.filter.endsWith(`from_publication_date:${from}-01-01`));
  }
});

test("range CAGR, fallback growth and totals use the right endpoints while preserving the full yearly series", () => {
  const data = fixtures();
  data.years = { group_by: [[2000, 20], [2005, 80], [2015, 10], [2020, 100], [2023, 100], [2024, 200], [2025, 400], [2026, 999]].map(([year, count]) => ({ key: String(year), key_display_name: String(year), count })) };
  for (const [from, to, expected, label, total] of [
    [2000, 2005, (80 / 20) ** (1 / 5) - 1, "Growth 2000–2005", 100],
    [2015, 2020, (100 / 10) ** (1 / 5) - 1, "Growth 2015–2020", 110],
    [2023, "", 1, "Growth 2023–2025", 1699],
    [2024, 2025, 4 ** .2 - 1, "5-year growth", 600],
    [2026, "", 4 ** .2 - 1, "5-year growth", 999]
  ]) {
    const report = shapeTopic(query(from, to, "child,children"), data, date);
    assert.equal(report.years[0].year, Math.min(2010, from));
    assert.equal(report.years.at(-1).year, 2026);
    assert.equal(report.kpis.growth, expected);
    assert.equal(report.kpis.growthLabel, label);
    assert.equal(report.kpis.momentum, momentum(expected));
    assert.equal(report.kpis.total, total);
    const end = to === "" ? 2025 : Math.min(to, 2025);
    const baseline = data.years.group_by.find((item) => Number(item.key) === end - 5)?.count ?? 0;
    const last = data.years.group_by.find((item) => Number(item.key) === end)?.count ?? 0;
    assert.equal(report.kpis.growth5y, baseline === 0 ? null : (last / baseline) ** .2 - 1);
    assert(report.name.endsWith(to === "" ? `since ${from}` : `${from}–${to}`));
    assert(report.headline.includes("is a new topic:") || report.headline.startsWith(to === "" ? `Since ${from}, ` : `From ${from} to ${to}, `));
    assert(report.headline.includes("child or children"));
    assert.deepEqual(presentReport(presentReport(report)), report);
    if (to !== "") assert(!report.headline.includes("published in 2025") || to === 2025);
  }
  const zeroBaseline = shapeTopic(query(2010, 2020), data, date);
  assert.equal(zeroBaseline.kpis.growth, null);
  assert.equal(zeroBaseline.kpis.momentum, "Not enough data");
});

test("range identities combine with include groups and children, and distinguish explicit current-year ends", () => {
  const ids = new Set();
  for (const [from, to] of [[2010, ""], [2010, 2026], [2024, ""], [2024, 2026], [2015, 2020]]) for (const include of ["", "child,children"]) {
    const parent = query(from, to, include);
    const child = query(from, to, include, "T123");
    assert.equal(child.id, parent.id + "|primary_topic:T123");
    ids.add(parent.id); ids.add(child.id);
  }
  assert.equal(ids.size, 20);
  assert.equal(query().id, "moss|moon circuits");
});

test("ranges cache separately, preserve child parents, remain cache-only, and are removed from public JSON", async () => {
  const kv = new MemoryKV();
  const env = { TMM: kv, OPENALEX_KEY: "fixture-only-not-a-credential" };
  let q;
  let calls = 0;
  const data = fixtures();
  const worker = createWorker(async (url) => {
    calls++;
    const descriptor = [...buildQueries(q, 2026), ...buildQueries(q, 2026, false)].find(({ params }) => Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value));
    assert(descriptor);
    return Response.json(data[descriptor.id]);
  }, () => date);
  const request = (params) => new Request("http://localhost/api/topic?" + new URLSearchParams({ q: "moss", syn: "moon circuits", ...params }));
  for (const [from, to] of [[2010, ""], [2010, 2026], [2015, 2020], [2024, ""]]) for (const include of ["", "child,children"]) {
    q = query(from, to, include);
    const params = { from, to, include };
    const response = await worker.fetch(request(params), env);
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.id, q.id);
    const writes = kv.writes.length;
    const sourceCalls = calls;
    assert.equal((await worker.fetch(request(params), env)).status, 200);
    assert.equal((await worker.fetch(request({ ...params, cache: "only" }), { TMM: kv })).status, 200);
    assert.equal(kv.writes.length, writes);
    assert.equal(calls, sourceCalls);
    q = query(from, to, include, "T123");
    const child = await worker.fetch(request({ ...params, subtopic: "T123", subtopicName: "Orbital logic", parent: report.id }), env);
    assert.equal(child.status, 200);
    const savedChild = await child.json();
    assert.equal(savedChild.parent, report.id);
    assert.equal(savedChild.from, from);
    assert.equal(savedChild.to, to === "" ? null : to);
    assert.equal((await worker.fetch(request({ ...params, subtopic: "T123", parent: "wrong" }), env)).status, 400);
  }
  const writes = kv.writes.length;
  const result = await (await worker.fetch(new Request("http://localhost/api/library"), { TMM: kv })).json();
  assert.deepEqual(result.map((item) => item.id), [query().id, query(2010, "", "", "T123").id]);
  assert.deepEqual(result[0].children, [result[1].id]);
  assert.equal(kv.writes.length, writes);
  assert.equal(calls, 16 * 13);
  for (const params of [{ from: "" }, { from: 1999 }, { to: 2027 }, { from: 2025, to: 2020 }]) {
    const response = await worker.fetch(request(params), env);
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /year|From must/);
  }
  assert.equal(calls, 16 * 13);
});

test("public projection strips range identities and their child references even without metadata", () => {
  let index = [];
  for (const [from, to] of [[2010, ""], [2015, 2020]]) index = updateLibrary(index, shapeTopic(query(from, to), fixtures(), date));
  index[0].children.push(index[1].id);
  delete index[1].from; delete index[1].to; delete index[1].variant;
  const result = publicLibrary(index);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].children, []);
});

test("bounded fallback windows use the historical endpoint and extend the one yearly query before 2010",async()=>{
 const {growthWindow}=await import('./lib.js');
 for(const [from,to,start,end]of [[2018,2019,2014,2019],[2012,2013,2008,2013],[2000,2001,1996,2001],[2026,2026,2020,2025]]){
  const q=query(from,to),data=fixtures();data.years={group_by:[{key:String(start),key_display_name:String(start),count:100},{key:String(end),key_display_name:String(end),count:200}]};
  const yearly=buildQueries(q,2026).find(q=>q.id==='years');assert(yearly.params.filter.endsWith(`publication_year:${Math.min(2010,from,start)}-2026`));
  const report=shapeTopic(q,data,date);assert.equal(report.kpis.growth,2**.2-1);assert.equal(report.kpis.growth5y,2**.2-1);assert.deepEqual(growthWindow(report),{growthStartYear:start,growthEndYear:end,growthStartCount:100,growthEndCount:200});assert(report.headline.includes(`over ${start}–${end}`));
 }
});

test("opening cached bounded reports repairs growth from saved counts without a source request",async()=>{
 const q=query(2018,2019),data=fixtures();data.years={group_by:[{key:'2014',key_display_name:'2014',count:100},{key:'2019',key_display_name:'2019',count:200}]};
 const correct=shapeTopic(q,data,date),old={...correct,kpis:{...correct.kpis,growth:9,growth5y:9,momentum:'Accelerating'}};
 const kv=new MemoryKV(),record=JSON.stringify({savedAt:date.getTime(),topic:old});kv.values.set('v3:topic:'+q.id,record);
 const worker=createWorker(()=>assert.fail('Repair must stay offline'),()=>date);
 const response=await worker.fetch(new Request('http://localhost/api/topic?'+new URLSearchParams({q:'moss',syn:'moon circuits',from:'2018',to:'2019',cache:'only'})),{TMM:kv});
 assert.equal(response.status,200);const repaired=await response.json();assert.equal(repaired.kpis.growth,2**.2-1);assert.equal(repaired.kpis.momentum,'Growing');assert(repaired.headline.includes('+15% a year over 2014–2019'));assert.equal(kv.values.get('v3:topic:'+q.id),record);assert.equal(kv.writes.length,0);
});

test("cached windows missing historical endpoints rebuild when admitted, and hide the wrong growth at the cap",async()=>{
 const q=query(2012,2013),data=fixtures();data.years={group_by:[{key:'2008',key_display_name:'2008',count:100},{key:'2013',key_display_name:'2013',count:200}]};
 const correct=shapeTopic(q,data,date),old={...correct,years:correct.years.filter(item=>item.year>=2010),kpis:{...correct.kpis,growth:9,growth5y:9,momentum:'Accelerating'}};
 for(const cap of ['0','90']){
  const kv=new MemoryKV(),record=JSON.stringify({savedAt:date.getTime(),topic:old});kv.values.set('v3:topic:'+q.id,record);let calls=0;
  const worker=createWorker(async url=>{calls++;const d=[...buildQueries(q,2026),...buildQueries(q,2026,false)].find(({params})=>Object.entries(params).every(([k,v])=>url.searchParams.get(k)===v));assert(d);return Response.json(data[d.id]);},()=>date);
  const response=await worker.fetch(new Request('http://localhost/api/topic?'+new URLSearchParams({q:'moss',syn:'moon circuits',from:'2012',to:'2013',cache:'only'})),{TMM:kv,NEW_TOPICS_PER_DAY:cap,OPENALEX_KEY:'fixture-only-not-a-credential'});
  assert.equal(response.status,200);const result=await response.json();
  if(cap==='0'){assert.equal(result.kpis.growth,null);assert.equal(result.kpis.momentum,'Not enough data');assert.equal(result.growthNeedsRebuild,true);assert(!result.headline.includes('+900%'));assert.equal(calls,0);assert.equal(kv.writes.length,0);assert.equal(kv.values.get('v3:topic:'+q.id),record);}
  else{assert.equal(result.kpis.growth,2**.2-1);assert.equal(result.cached,false);assert.equal(calls,13);assert(result.years.some(item=>item.year===2008));assert.equal(kv.values.get('count:2026-11-01'),'1');}
 }
});
