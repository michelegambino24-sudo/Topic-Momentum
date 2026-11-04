/* Shared place dictionary. Edit memberships/aliases here; bump version when they change.
 * Europe uses the owner's broader boundary: Russia, Turkey, Cyprus and the Caucasus.
 * MENA excludes Sudan. North Africa includes Sudan; Africa contains 54 sovereign-state codes.
 * Europe has 49 supported ISO codes; Kosovo (non-ISO XK) is outside the existing country-code catalogue.
 * South Asia uses the eight SAARC countries; Latin America uses 20 Latin-language countries.
 * North America includes Central America and the Caribbean. Memberships may overlap. */
(() => {
  "use strict";
  const version=1;
  const countryCodes="AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
  const definitions={
  "middleEast": [
    "Middle East",
    "middle east|middle eastern",
    "BH EG IR IQ IL JO KW LB OM PS QA SA SY TR AE YE"
  ],
  "mena": [
    "MENA",
    "mena|middle east and north africa|middle eastern and north african",
    "BH EG IR IQ IL JO KW LB OM PS QA SA SY TR AE YE DZ LY MA TN"
  ],
  "gcc": [
    "GCC",
    "gcc|gulf|gulf states|gulf countries|gulf cooperation council",
    "BH KW OM QA SA AE"
  ],
  "arabWorld": [
    "Arab world",
    "arab world|arab countries|arab states|arab nations",
    "DZ BH KM DJ EG IQ JO KW LB LY MR MA OM PS QA SA SO SD SY TN AE YE"
  ],
  "levant": [
    "Levant",
    "levant|levantine",
    "IL JO LB PS SY"
  ],
  "maghreb": [
    "Maghreb",
    "maghreb|maghreb countries|maghrebi",
    "DZ LY MR MA TN"
  ],
  "northAfrica": [
    "North Africa",
    "north africa|northern africa|north african",
    "DZ EG LY MA SD TN"
  ],
  "africa": [
    "Africa",
    "africa|african",
    "DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW"
  ],
  "europe": [
    "Europe",
    "europe|european",
    "AL AD AT BY BE BA BG HR CZ DK EE FI FR DE GR VA HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB TR CY AM AZ GE"
  ],
  "eu": [
    "European Union",
    "european union|eu|eu countries|eu member states",
    "AT BE BG HR CY CZ DE DK EE ES FI FR GR HU IE IT LT LU LV MT NL PL PT RO SE SI SK"
  ],
  "asia": [
    "Asia",
    "asia|asian",
    "AF AM AZ BH BD BT BN KH CN CY GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE RU"
  ],
  "southeastAsia": [
    "Southeast Asia",
    "southeast asia|south east asia|southeastern asia|southeast asian|south-east asia",
    "BN KH ID LA MY MM PH SG TH TL VN"
  ],
  "southAsia": [
    "South Asia",
    "south asia|southern asia|south asian",
    "AF BD BT IN MV NP PK LK"
  ],
  "eastAsia": [
    "East Asia",
    "east asia|eastern asia|east asian",
    "CN JP MN KP KR TW"
  ],
  "centralAsia": [
    "Central Asia",
    "central asia|central asian",
    "KZ KG TJ TM UZ"
  ],
  "latinAmerica": [
    "Latin America",
    "latin america|latin american",
    "AR BO BR CL CO CR CU DO EC SV GT HT HN MX NI PA PY PE UY VE"
  ],
  "northAmerica": [
    "North America",
    "north america|northern america|north american",
    "AG BS BB BZ CA CR CU DM DO SV GD GT HT HN JM MX NI PA KN LC VC TT US"
  ],
  "southAmerica": [
    "South America",
    "south america|south american",
    "AR BO BR CL CO EC GY PY PE SR UY VE"
  ],
  "oceania": [
    "Oceania",
    "oceania|oceanian",
    "AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU"
  ],
  "subSaharanAfrica": [
    "Sub-Saharan Africa",
    "sub-saharan africa|sub saharan africa|subsaharan africa|sub-saharan african|sub saharan african",
    "AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ GQ ER SZ ET GA GM GH GN GW KE LS LR MG MW ML MR MU MZ NA NE NG RW ST SN SC SL SO ZA SS TZ TG UG ZM ZW"
  ]
  };
  definitions.nordic=["Nordic countries","nordic countries|nordic country|nordic region|nordics|nordic|scandinavia|scandinavian","DK FI IS NO SE"];
  definitions.balkans=["Balkans","balkans|balkan countries|balkan states|balkan region|balkan","AL BA BG HR GR ME MK RO RS SI TR"];
  // Country names come from the local English locale data; these add common names/demonyms.
  const extraAliases={
    AE:"uae|u.a.e.|united arab emirates|emirati",SA:"saudi arabia|saudi|saudi arabian|ksa",TR:"turkey|türkiye|turkish",PS:"palestine|palestinian",GB:"united kingdom|uk|u.k.|britain|great britain|british|england|english|scotland|scottish|wales|welsh|northern ireland",
    US:"united states|united states of america|usa|u.s.|u.s.a.|american",IT:"italy|italian",FR:"france|french",DE:"germany|german",ES:"spain|spanish",PT:"portugal|portuguese",NL:"netherlands|dutch",BE:"belgium|belgian",LU:"luxembourg|luxembourgish",CH:"switzerland|swiss",AT:"austria|austrian",IE:"ireland|irish",IS:"iceland|icelandic",NO:"norway|norwegian",SE:"sweden|swedish",FI:"finland|finnish",DK:"denmark|danish",
    PL:"poland|polish",CZ:"czechia|czech republic|czech",SK:"slovakia|slovak",HU:"hungary|hungarian",RO:"romania|romanian",BG:"bulgaria|bulgarian",GR:"greece|greek",CY:"cyprus|cypriot",MT:"malta|maltese",EE:"estonia|estonian",LV:"latvia|latvian",LT:"lithuania|lithuanian",RU:"russia|russian",UA:"ukraine|ukrainian",BY:"belarus|belarusian",MD:"moldova|moldovan",AL:"albania|albanian",BA:"bosnia and herzegovina|bosnia|bosnian",HR:"croatia|croatian",ME:"montenegro|montenegrin",MK:"north macedonia|macedonian",RS:"serbia|serbian",SI:"slovenia|slovenian",AD:"andorra|andorran",LI:"liechtenstein|liechtensteiner",MC:"monaco|monégasque|monegasque",SM:"san marino|sammarinese",VA:"vatican city|holy see|vatican",AM:"armenia|armenian",AZ:"azerbaijan|azerbaijani",GE:"georgia|georgian",
    BH:"bahrain|bahraini",KW:"kuwait|kuwaiti",OM:"oman|omani",QA:"qatar|qatari",YE:"yemen|yemeni",EG:"egypt|egyptian",IR:"iran|iranian",IQ:"iraq|iraqi",IL:"israel|israeli",JO:"jordan|jordanian",LB:"lebanon|lebanese",SY:"syria|syrian",DZ:"algeria|algerian",LY:"libya|libyan",MA:"morocco|moroccan",TN:"tunisia|tunisian",SD:"sudan|sudanese",SS:"south sudan|south sudanese",MR:"mauritania|mauritanian",SO:"somalia|somali",DJ:"djibouti|djiboutian",KM:"comoros|comorian",
    AO:"angola|angolan",BJ:"benin|beninese",BW:"botswana|botswanan|batswana",BF:"burkina faso|burkinabé|burkinabe",BI:"burundi|burundian",CV:"cabo verde|cape verde|cape verdean",CM:"cameroon|cameroonian",CF:"central african republic|central african",TD:"chad|chadian",CD:"democratic republic of the congo|dr congo|drc|congo-kinshasa",CG:"republic of the congo|congo-brazzaville|congo|congolese",CI:"côte d’ivoire|côte d'ivoire|cote d'ivoire|ivory coast|ivorian",GQ:"equatorial guinea|equatoguinean",ER:"eritrea|eritrean",SZ:"eswatini|swaziland|swazi",ET:"ethiopia|ethiopian",GA:"gabon|gabonese",GM:"gambia|gambian",GH:"ghana|ghanaian",GN:"guinea|guinean",GW:"guinea-bissau|bissau-guinean",KE:"kenya|kenyan",LS:"lesotho|basotho",LR:"liberia|liberian",MG:"madagascar|malagasy",MW:"malawi|malawian",ML:"mali|malian",MU:"mauritius|mauritian",MZ:"mozambique|mozambican",NA:"namibia|namibian",NE:"niger|nigerien",NG:"nigeria|nigerian",RW:"rwanda|rwandan",ST:"são tomé and príncipe|sao tome and principe|são toméan|sao tomean",SN:"senegal|senegalese",SC:"seychelles|seychellois",SL:"sierra leone|sierra leonean",ZA:"south africa|south african",TZ:"tanzania|tanzanian",TG:"togo|togolese",UG:"uganda|ugandan",ZM:"zambia|zambian",ZW:"zimbabwe|zimbabwean",
    AF:"afghanistan|afghan",BD:"bangladesh|bangladeshi",BT:"bhutan|bhutanese",IN:"india|indian",MV:"maldives|maldivian",NP:"nepal|nepalese|nepali",PK:"pakistan|pakistani",LK:"sri lanka|sri lankan",KZ:"kazakhstan|kazakh|kazakhstani",KG:"kyrgyzstan|kyrgyz|kyrgyzstani",TJ:"tajikistan|tajik|tajikistani",TM:"turkmenistan|turkmen|turkmenistani",UZ:"uzbekistan|uzbek|uzbekistani",CN:"china|chinese",JP:"japan|japanese",MN:"mongolia|mongolian",KP:"north korea|north korean|dprk",KR:"south korea|south korean|republic of korea|korea|korean",TW:"taiwan|taiwanese",BN:"brunei|bruneian",KH:"cambodia|cambodian",ID:"indonesia|indonesian",LA:"laos|lao|laotian",MY:"malaysia|malaysian",MM:"myanmar|burma|burmese",PH:"philippines|philippine|filipino|filipina",SG:"singapore|singaporean",TH:"thailand|thai",TL:"timor-leste|east timor|timorese",VN:"vietnam|vietnamese",
    AR:"argentina|argentine|argentinian",BO:"bolivia|bolivian",BR:"brazil|brazilian",CL:"chile|chilean",CO:"colombia|colombian",CR:"costa rica|costa rican",CU:"cuba|cuban",DO:"dominican republic|dominican",EC:"ecuador|ecuadorian|ecuadorean",SV:"el salvador|salvadoran",GT:"guatemala|guatemalan",HT:"haiti|haitian",HN:"honduras|honduran",MX:"mexico|mexican",NI:"nicaragua|nicaraguan",PA:"panama|panamanian",PY:"paraguay|paraguayan",PE:"peru|peruvian",UY:"uruguay|uruguayan",VE:"venezuela|venezuelan",GY:"guyana|guyanese",SR:"suriname|surinamese",CA:"canada|canadian",BZ:"belize|belizean",AG:"antigua and barbuda|antiguan|barbudan",BS:"bahamas|bahamian",BB:"barbados|barbadian|bajan",DM:"dominica",GD:"grenada|grenadian",JM:"jamaica|jamaican",KN:"saint kitts and nevis|st kitts and nevis|kittitian|nevisian",LC:"saint lucia|st lucia|saint lucian",VC:"saint vincent and the grenadines|st vincent and the grenadines|vincentian",TT:"trinidad and tobago|trinidadian|tobagonian",
    AU:"australia|australian",NZ:"new zealand|new zealander|kiwi",FJ:"fiji|fijian",KI:"kiribati|i-kiribati",MH:"marshall islands|marshallese",FM:"micronesia|micronesian",NR:"nauru|nauruan",PW:"palau|palauan",PG:"papua new guinea|papua new guinean",WS:"samoa|samoan",SB:"solomon islands|solomon islander",TO:"tonga|tongan",TV:"tuvalu|tuvaluan",VU:"vanuatu|ni-vanuatu"
  };
  const names=new Intl.DisplayNames(["en"],{type:"region"});
  const countries=Object.fromEntries(countryCodes.map(code=>[code,{id:"country:"+code,label:code==="AE"?"UAE":code==="TR"?"Turkey":names.of(code),codes:[code],aliases:[...new Set([names.of(code),...(extraAliases[code] || "").split("|")].filter(Boolean))]}]));
  for(const [code,aliases] of Object.entries(extraAliases)){
    for(const alias of aliases.split("|").slice(1))if(/(?:ian|ean|an|i|er|en|bek|ak|akh)$/i.test(alias))countries[code].aliases.push(alias+"s");
  }
  const regions=Object.fromEntries(Object.entries(definitions).map(([id,[label,aliases,codes]])=>[id,{id,label,aliases:aliases.split("|"),codes:codes.split(" ")} ]));
  const worldwide={id:"worldwide",label:"Worldwide",aliases:["worldwide","world wide","global","globally","all countries","around the world","across the world"],codes:[]};
  const entries=[...Object.values(regions),...Object.values(countries),worldwide];
  const byId=Object.fromEntries(entries.map(entry=>[entry.id,entry]));
  function normaliseIds(input=[]) {
    if(!Array.isArray(input) || input.length>countryCodes.length+Object.keys(regions).length)throw new Error("The place filter is invalid. Remove it and try again.");
    return [...new Set(input.map(token=>{
      if(typeof token!=="string")throw new Error("The place filter is invalid. Remove it and try again.");
      const parts=token.split("@");if(parts.length>2)throw new Error("The place filter is invalid. Remove it and try again.");
      const [id,savedVersion]=parts;
      if(!Object.hasOwn(byId,id) || savedVersion && savedVersion!==String(version))throw new Error("This place definition has changed. Remove the filter and choose it again.");
      return id;
    }))].sort();
  }
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const aliases=entries.flatMap(entry=>entry.aliases.map(alias=>({entry,alias}))).sort((a,b)=>b.alias.length-a.alias.length);
  const aliasMap=new Map();for(const {entry,alias} of aliases)if(!aliasMap.has(alias.toLowerCase()))aliasMap.set(alias.toLowerCase(),entry);
  const matcher=new RegExp("(?<![\\p{L}\\p{N}])(?:"+aliases.map(({alias})=>escape(alias)).join("|")+")(?![\\p{L}\\p{N}])","giu");
  function describe(ids,mode="authored") {
    const selected=ids.map(id=>Object.hasOwn(byId,id)?byId[id]:null);
    if(selected.some(entry=>!entry))throw new Error("The place filter is invalid. Remove it and try again.");
    const global=selected.some(entry=>entry.id==="worldwide"),codes=global?[]:[...new Set(selected.flatMap(entry=>entry.codes))].sort();
    return {ids:global?["worldwide"]:[...new Set(ids)].sort(),codes,mode,label:global?"Worldwide":selected.map(entry=>entry.label).join(" + "),countryCount:codes.length,
      terms:global?[]:[...new Set(selected.flatMap(entry=>entry.aliases).map(term=>term.toLowerCase()))].sort()};
  }
  function resolve(value,mode=null) {
    const text=String(value),hits=[];
    const excluded=text.search(/\b(?:excluding|exclude|without|except)\b/i),scope=excluded<0?text:text.slice(0,excluded);
      for(const match of scope.matchAll(matcher)){
        const entry=aliasMap.get(match[0].toLowerCase());if(!entry)continue;
        const start=match.index,end=start+match[0].length,before=text[start-1] || "",after=text[end] || "";
        if(/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after) || hits.some(hit=>start<hit.end && end>hit.start))continue;
        hits.push({id:entry.id,label:entry.label,source:match[0],start,end,codes:entry.codes});
      }
    hits.sort((a,b)=>a.start-b.start);
    const subject=hits.some(hit=>{
      const before=text.slice(0,hit.start),after=text.slice(hit.end);
      const direct=/\b(?:research|studies|papers|study)\s+(?:about|on)\s+(?:the\s+)?$/i.test(before);
      return /^\s+as\s+(?:a\s+)?topic\b/i.test(after) || direct && (/^\s+(?:policy|policies|politics|history|culture|economy|economies|geography)\b/i.test(after) || /\babout\s+(?:the\s+)?$/i.test(before) && /^\s*[?.!]?\s*$/.test(after));
    });
    const ids=[...new Set(hits.map(hit=>hit.id))],description=describe(ids,mode || (subject?"mentions":"authored"));
    let mask=text;for(const hit of [...hits].sort((a,b)=>b.start-a.start))mask=mask.slice(0,hit.start)+" ".repeat(hit.end-hit.start)+mask.slice(hit.end);
    let without=text;
    for(const hit of [...hits].sort((a,b)=>b.start-a.start)){
      const prefix=without.slice(0,hit.start),lead=prefix.match(/\b(?:(?:in|across|of|within|from|throughout)\s+(?:the\s+)?|the\s+)$/i);
      const start=lead?hit.start-lead[0].length:hit.start;
      without=without.slice(0,start)+" "+without.slice(hit.end);
    }
    without=without.replace(/\s+/g," ").replace(/\s+(?:and|or)\s*([?.!]|$)/gi,"$1").replace(/\s+([?.!])/g,"$1").trim();
    return {...description,matches:hits,mask,withoutPlaces:without};
  }
  globalThis.TMM_PLACES=Object.freeze({version,countryCodes,regions,countries,worldwide,byId,describe,resolve,normaliseIds,tokens:ids=>normaliseIds(ids).map(id=>id+"@"+version)});
})();
