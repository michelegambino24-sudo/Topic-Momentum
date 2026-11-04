import {test} from "node:test";
import assert from "node:assert/strict";
import "./lib.js";
import "../site/query-parser.js";
const places=globalThis.TMM_PLACES;
const OPTIONS=["worldwide","country:US","europe","middleEast","mena","gcc","country:AE","country:SA","africa","asia"];
const contains={ // option -> countries that must be found when it is chosen
 "country:US":["US"],europe:["IT","DE","FR","GB","ES"],middleEast:["SA","AE","EG","TR","IL","QA"],mena:["SA","AE","MA","DZ","TN","EG"],gcc:["SA","AE","QA","KW","BH","OM"],
 "country:AE":["AE"],"country:SA":["SA"],africa:["NG","ZA","KE","EG","MA","GH"],asia:["IN","CN","JP","ID","SA"]
};
test("every Where option exists and keeps all of its countries",()=>{
 for(const id of OPTIONS)assert(places.byId[id],id);
 assert.deepEqual(places.describe(["worldwide"],"authored").codes,[]);
 for(const [id,codes] of Object.entries(contains)){
  const found=new Set(places.describe([id],"authored").codes);
  for(const code of codes)assert(found.has(code),id+" must include "+code);
 }
});
test("a paper from Saudi Arabia is found under MENA, Middle East, GCC and Saudi Arabia; Nigeria under Africa",()=>{
 for(const id of ["mena","middleEast","gcc","country:SA","asia"])assert(places.describe([id],"authored").codes.includes("SA"),id);
 assert(places.describe(["africa"],"authored").codes.includes("NG"));
 assert(!places.describe(["europe"],"authored").codes.includes("NG"));
});
test("the label sent with the question resolves back to the chosen option",()=>{
 for(const id of OPTIONS.filter(id=>id!=="worldwide")){
  const resolved=places.resolve("digital innovation in "+places.byId[id].label);
  assert.deepEqual(resolved.ids,[id],id);
 }
});
