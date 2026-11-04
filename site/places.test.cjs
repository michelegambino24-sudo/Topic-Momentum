const {test}=require("node:test");
const assert=require("node:assert/strict");
require("./places.js");require("./search-presets.js");require("./query-parser.js");
const places=globalThis.TMM_PLACES;
const middleEast="AE BH EG IL IQ IR JO KW LB OM PS QA SA SY TR YE".split(" ");
const gcc="AE BH KW OM QA SA".split(" ");
test("editable region memberships match the owner choices",()=>{
 assert.deepEqual([...places.regions.middleEast.codes].sort(),middleEast);
 assert.deepEqual([...places.regions.gcc.codes].sort(),gcc);
 assert.deepEqual([...places.regions.mena.codes].sort(),[...middleEast,"DZ","LY","MA","TN"].sort());
 assert(!places.regions.mena.codes.includes("SD"));assert.equal(places.regions.eu.codes.length,27);
 for(const code of ["RU","TR","CY","AM","AZ","GE"])assert(places.regions.europe.codes.includes(code));
 assert.equal(places.regions.europe.codes.length,49);
 for(const region of Object.values(places.regions)){
  assert.equal(new Set(region.codes).size,region.codes.length);
  assert(region.codes.every(code=>places.countries[code]));
 }
});
for(const [question,id,count] of [
 ["Is research on autism growing in the Middle East?","middleEast",16],
 ["Is research on autism growing the middle east","middleEast",16],
 ["autism in MENA","mena",20],["autism in the GCC","gcc",6],
 ["autism in Europe","europe",49],["autism in Italy","country:IT",1],
 ["autism in the Nordic countries","nordic",5],
 ["Is children's mental health a growing field in the Middle East, and who's leading it?","middleEast",16]
])test("deterministic author-location default: "+question,()=>{
 const first=places.resolve(question),second=places.resolve(question);
 assert.deepEqual(first,second);assert.deepEqual(first.ids,[id]);assert.equal(first.mode,"authored");assert.equal(first.countryCount,count);
 const parsed=globalThis.TMM_QUERY_PARSER.parse(question,2026);
 assert.equal(parsed.resolvedPlace.mode,"authored");assert.equal(parsed.resolvedPlace.countryCount,count);
});
test("regions combine as a deduplicated union and global clears every country filter",()=>{
 const union=places.resolve("autism in Europe and the Middle East");
 assert.deepEqual(union.codes,[...new Set([...places.regions.europe.codes,...middleEast])].sort());assert.equal(union.countryCount,64);
 for(const question of ["autism worldwide","autism global","global autism in Europe"]){assert.deepEqual(places.resolve(question).codes,[]);assert.deepEqual(places.resolve(question).ids,["worldwide"]);}
 assert.deepEqual(places.resolve("autism without global comparisons in Europe").codes,[]);
});
test("all named regions and countries resolve independently of prepositions and casing",()=>{
 for(const region of Object.values(places.regions))for(const lead of ["","in the ","across ","of "]){
  assert.deepEqual(places.resolve("autism "+lead+region.label.toUpperCase()).codes,[...region.codes].sort());
 }
 for(const [name,code] of [["Italy","IT"],["Italian","IT"],["Italians","IT"],["French","FR"],["Chinese","CN"],["United States","US"],["British","GB"]])assert.deepEqual(places.resolve("autism in "+name).codes,[code]);
 assert.deepEqual(places.resolve("autism").codes,[]);
});
test("only clearly stated regional subject wording changes the default mode",()=>{
 for(const text of ["research about European policy","studies on Europe as a topic","research about Middle Eastern policy"]){assert.equal(places.resolve(text).mode,"mentions");}
 for(const text of ["autism in Europe","research about autism in Europe","research on European autism","research about European autism","autism in MENA","autism in the Middle East","autism in the Nordic countries"]){assert.equal(places.resolve(text).mode,"authored");}
 const author=places.resolve("autism in Europe"),mentions=places.resolve("autism in Europe","mentions");
 assert.equal(mentions.mode,"mentions");assert.deepEqual(mentions.ids,author.ids);assert.deepEqual(mentions.codes,author.codes);
});
test("excluded place names do not become positive filters; removal keeps the actual subject",()=>{
 const result=places.resolve("Gene editing in children, written in the GCC, excluding Middle East respiratory syndrome");
 assert.deepEqual(result.codes,gcc);assert(!result.ids.includes("middleEast"));assert(result.withoutPlaces.includes("Middle East respiratory syndrome"));
 assert.equal(places.resolve("autism in Europe and the Middle East").withoutPlaces,"autism");
 assert.equal(places.resolve("autism across the Middle East").withoutPlaces,"autism");
});
test("place parameter tokens reject unknown identifiers and versions",()=>{
 assert.deepEqual(places.normaliseIds(["europe@1","europe"]),["europe"]);
 for(const token of ["europe@0","europe@1@2","unknown","country:WJ"])assert.throws(()=>places.normaliseIds([token]));
});
