/* Local, deterministic sentence parsing. Existing serializers own search identities. */
(() => {
  "use strict";
  const presets = globalThis.TMM_SEARCH_PRESETS;
  const countries = globalThis.TMM_COUNTRY_GROUPS.map(item => ({ label: item.label, terms: [...item.terms], kind: "place" }));
  const people = [
    { label: "Children 0–9", terms: [...presets.children.terms], aliases: ["early childhood", "children", "kids", "child", "infants", "infant"] },
    { label: "Pregnancy", terms: [...presets.pregnancy.terms], aliases: ["pregnant women", "pregnant woman", "pregnant mothers", "expectant mothers", "during pregnancy", "pregnancy", "pregnant", "prenatal", "antenatal"] },
    { label: "Women", terms: [...presets.women.terms], aliases: ["women", "woman"] },
    { label: "Adolescents", terms: [...presets.adolescents.terms], aliases: ["adolescent", "adolescents", "teen", "teens", "teenager", "teenagers"] },
    { label: "Older adults", terms: [...presets.olderAdults.terms], aliases: ["older adult", "older adults", "elderly", "older people"] },
    { label: "Students", terms: [...presets.students.terms], aliases: ["student", "students"] }
  ].map(item => ({ ...item, kind: "people" }));
  const regions = [
    { ...presets.gcc, aliases: ["gulf cooperation council", "gulf countries", "gcc", "gulf"], kind: "place" },
    { ...presets.middleEast, aliases: ["middle east", "mena", "arab world"], kind: "place" }
  ];
  const clean = value => String(value).replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, "").replace(/\s+/g, " ").replace(/^["“](.*)["”]$/s, "$1").trim();
  const canonical = value => String(value).toLowerCase().replace(/[,|[\]{}()"'“”‘’:\\\x00-\x1f\x7f]/g, "").trim().replace(/\s+/g, " ");
  const term = value => canonical(clean(value));
  const key = terms => JSON.stringify([...new Set(terms.map(canonical).filter(Boolean))].sort());
  const escapeRE = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = source => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, "giu");
  const aliases = entries => entries.flatMap(item => (item.aliases || item.terms).map(alias => ({ alias, item }))).sort((a, b) => b.alias.length - a.alias.length);
  const locations = aliases([...regions, ...countries]).concat([{ alias: "turkey", item: countries.find(item => item.label === "Türkiye") }]).sort((a, b) => b.alias.length - a.alias.length);
  const humans = aliases(people);
  // Framing words carry no search meaning ("and what is its impact on…").
  // Whole framing segments are dropped; leading/trailing runs are dropped only when they contain a function word,
  // so real topics such as "impact investing" or "research and development" survive.
  const GENERIC = new Set("a an the and or of on in for to with as about regarding concerning related what which how why when where who does do did is are was were be been can could will would should may might its it their they them this that these those field fields topic topics area areas domain domains technology technologies impact impacts effect effects affect affects affecting role roles influence influences relationship relationships relation consequences implications outcome outcomes has have having know learn understand".split(" "));
  const FUNCTION = new Set("a an the and or of on in for to with about what which how why when where who does do did is are was were be its it their they this that these those".split(" "));
  const allGeneric = words => words.length > 0 && words.every(word => GENERIC.has(word.toLowerCase()));
  function stripGeneric(value) {
    const quoted = [];
    let text = clean(value).replace(/["“]([^"“”]+)["”]/g, (_, inner) => `\uE000${quoted.push(inner) - 1}\uE001`);
    // Drop "and <only framing words>" segments: "epigenetics and the impact of this field" → "epigenetics".
    const parts = text.split(/(\s*,\s*|\s+and\s+)/i);
    const kept = [];
    for (let index = 0; index < parts.length; index += 2) {
      const words = parts[index].split(/\s+/).filter(Boolean);
      if (index > 0 && allGeneric(words)) continue;
      if (kept.length) kept.push(parts[index - 1]);
      kept.push(parts[index]);
    }
    let words = kept.join("").split(/\s+/).filter(Boolean);
    const trimRun = list => {
      let end = 0;
      while (end < list.length && GENERIC.has(list[end].toLowerCase())) end++;
      return end < list.length && list.slice(0, end).some(word => FUNCTION.has(word.toLowerCase())) ? list.slice(end) : list;
    };
    words = trimRun(words);
    words = trimRun([...words].reverse()).reverse();
    return words.join(" ").replace(/\uE000(\d+)\uE001/g, (_, index) => `"${quoted[Number(index)]}"`).trim();
  }
  const notes = ignored => ignored.length ? `You can use up to three groups. Not added: ${ignored.join("; ")}. Remove a group to include them.` : "";

  // A small inflection comparison for repeated topic words, not general stemming.
  function topicWord(value) {
    const word = value.toLowerCase();
    if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (/(?:ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
    return word.length > 3 && /s$/.test(word) && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
  }
  function withoutTopicWords(value, topic) {
    if (!topic) return clean(value);
    const words = new Set((topic.match(/[\p{L}\p{N}]+/gu) || []).filter(word => !/^(?:and|or|the|a|an|of|in|on|for|to|with)$/i.test(word)).map(topicWord));
    const remaining = value.replace(/[\p{L}\p{N}]+/gu, word => words.has(topicWord(word)) ? " " : word);
    return clean(remaining).replace(/^(?:(?:and|or)\b[\s,;-]*|[-–—]\s*)+|(?:[\s,;-]*\b(?:and|or)|\s*[-–—])+$/gi, "").trim();
  }

  // Split only a focus/list span; an ordinary topic's "and" is never an operator.
  function focusTerms(text) {
    const quoted = [];
    const protectedText = text.replace(/["“]([^"“”]+)["”]/g, (_, value) => `\uE000${quoted.push(value) - 1}\uE001`);
    return [...new Set(protectedText.split(/\s*,\s*|\s+and\s+/i).map(value => term(value.replace(/\uE000(\d+)\uE001/g, (_, index) => quoted[Number(index)]))).filter(Boolean))];
  }
  function validateRange(from, to, year) {
    if (!Number.isInteger(from) || from < 2000 || from > year) return `Enter a From year between 2000 and ${year}.`;
    if (to !== null && (!Number.isInteger(to) || to < 2000 || to > year)) return `Enter a To year between 2000 and ${year}, or leave it empty to include papers up to today.`;
    if (to !== null && from > to) return "The From year must be the same as or earlier than the To year.";
    return "";
  }
  function parse(sentence, currentYear, { refinement = false, currentTopic = "" } = {}) {
    if (!Number.isInteger(currentYear)) throw new Error("Supply the current year.");
    if (!refinement) {
      const parts=questionParts(sentence,currentYear);
      if(parts.recognized)return parsedQuestion(parts,currentYear);
      if(parts.resolution?.matches.length)return {...parse(parts.resolution.withoutPlaces,currentYear),resolvedPlace:parts.resolution};
    }
    // "children's lungs" → "lungs in children", so the group word and the focus word are both kept.
    const original = String(sentence).replace(/[’‘]/g, "'")
      .replace(/\b(children|kids|infants|women|adolescents|teenagers|teens|students|mothers)'s?\s+([\p{L}-]+)/giu, "$2 in $1");
    let work = original, mask = original.replace(/["“][^"“”]*["”]/g, match => "\uE010".repeat(match.length));
    const spans = [], candidates = [], errors = [], clarifications = [];
    const remove = (start, end, kind) => {
      spans.push({ start, end, kind, text: original.slice(start, end) });
      work = work.slice(0, start) + " ".repeat(end - start) + work.slice(end);
      mask = mask.slice(0, start) + " ".repeat(end - start) + mask.slice(end);
    };
    const leadPattern = /^\s*(?:i'm looking for|i am looking for|i'm interested in|i am interested in|looking for|i want to know about|i want to know|i'd like to know about|i would like to know about|tell me about|what do we know about|what is known about|show me|find me|find|search for|research on|research about|research into|papers on|papers about|studies on|studies about|information on|information about|literature on)\b\s*/i;
    for (let lead = mask.match(leadPattern); lead && lead[0].trim(); lead = mask.match(leadPattern)) remove(mask.search(/\S/), lead[0].length, "lead");
    // Shield ages before date matching. Only a recognized child context consumes them.
    const childContext = boundary(people[0].aliases.map(escapeRE).join("|")).test(mask);
    const agePattern = /\b(?:aged?\s+\d{1,4}(?:\s*(?:to|[-–—])\s*\d{1,4})?(?:\s+years?(?:\s+old)?)?|(?:from\s+)?\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}(?:\s+years?\s+old)?|\d{1,3}\s+years?\s+old|under\s+\d{1,3})\b/gi;
    for (const match of [...mask.matchAll(agePattern)]) {
      if (childContext) remove(match.index, match.index + match[0].length, "age");
      else mask = mask.slice(0, match.index) + "\uE010".repeat(match[0].length) + mask.slice(match.index + match[0].length);
    }
    const yearClauses = [];
    const yearPattern = /\bbetween\s+(\d{4})\s+and\s+(\d{4})\b|\b(\d{4})\s+to\s+(\d{4})\b|\b(since|from|after)\s+(\d{4})\b|\blast\s+(-?\d+(?:\.\d+)?)\s+years?\b/gi;
    for (const match of [...mask.matchAll(yearPattern)]) {
      const from = match[1] ? Number(match[1]) : match[3] ? Number(match[3]) : match[5] ? Number(match[6]) + (match[5].toLowerCase() === "after" ? 1 : 0) : currentYear - Number(match[7]);
      const to = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : null;
      if (match[7] && (!Number.isInteger(Number(match[7])) || Number(match[7]) < 1)) errors.push("Use a positive whole number of years, then try again.");
      yearClauses.push({ from, to }); remove(match.index, match.index + match[0].length, "years");
    }
    if (yearClauses.length > 1) errors.push("Use one year range, then try again.");
    const range = yearClauses[0] || { from: 2010, to: null };
    const rangeError = validateRange(range.from, range.to, currentYear);
    if (rangeError) errors.push(rangeError);
    const at = (entries, index) => entries.find(({ alias }) => mask.slice(index).match(new RegExp(`^${escapeRE(alias)}(?![\\p{L}\\p{N}_])`, "iu")));
    const collect = (entries, start, matchStart = start) => {
      const items = []; let end = start;
      while (true) {
        const found = at(entries, end);
        if (!found) break;
        items.push(found.item); end += found.alias.length;
        const connector = mask.slice(end).match(/^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)/i);
        if (!connector || !at(entries, end + connector[0].length)) break;
        end += connector[0].length;
      }
      if (!items.length) return false;
      candidates.push({ position: matchStart, kind: items[0].kind, label: [...new Set(items.map(item => item.label))].join(" or "), terms: [...new Set(items.flatMap(item => item.terms))] });
      if (items.some(item => item.label === "Middle East") && /\b(?:mena|arab world)\b/i.test(original.slice(matchStart, end))) clarifications.push("MENA and Arab world use the Middle East keyword preset. It is not a complete country list for either region.");
      remove(matchStart, end, items[0].kind); return true;
    };
    const locationPrefix = /\b(?:(?:born|living)\s+in|all\s+the\s+countries\s+of|countries\s+in|in|from|within|mentions|mentioning|about)\s+(?:(?:all\s+the\s+countries\s+of|countries\s+in)\s+)*(?:the\s+)?/gi;
    for (const match of [...mask.matchAll(locationPrefix)]) collect(locations, match.index + match[0].length, match.index);
    for (const match of [...mask.matchAll(boundary(aliases(regions).map(item => escapeRE(item.alias)).join("|")))]) if (mask.slice(match.index).trimStart()) collect(aliases(regions), match.index);
    for (const match of [...mask.matchAll(/\b(?:UAE|KSA)\b/g)]) collect(locations, match.index);
    for (const match of [...mask.matchAll(boundary(humans.map(item => escapeRE(item.alias)).join("|")))]) {
      const found = at(humans, match.index);
      if (!found) continue;
      // "child custody", "child labour", "women entrepreneurs": a people word directly followed by another
      // content word is part of the topic, not a separate group.
      const after = mask.slice(match.index + found.alias.length);
      if (/^\s+\p{L}/u.test(after) && !/^\s+(?:in|into|for|on|of|and|or|with|from|since|after|before|between|during|across|among|the|aged?|under|who|whose|that|\d)\b/i.test(after)) continue;
      const prefix = mask.slice(0, match.index).match(/\b(?:in|for|among|regarding|concerning|about|related\s+to|on)\s+(?:the\s+)?$/i);
      collect(humans, match.index, prefix ? prefix.index : match.index);
    }
    let focus = null;
    const effects = mask.match(/^\s*effects?\s+of\s+([\s\S]+?)\s+on\s+/i);
    if (effects) {
      const opening = mask.match(/^\s*effects?\s+of\s+/i);
      remove(0, opening[0].length, "focus-syntax");
      const on = effects[0].match(/\bon\s+$/i).index;
      focus = { start: effects[0].length, syntaxStart: on };
    } else {
      const match = mask.match(/\band\s+(?:its|their)\s+impact\s+on\s+|\b(?:impact|effect)s?\s+on\s+|\b(?:affects?|affecting|influences?|influencing|shapes?|shaping)\s+|\b(?:(?:is|are|being)\s+)?(?:used|applied)\s+(?:to\s+(?:treat|prevent|diagnose|detect|study|improve)|for(?:\s+(?:treating|preventing|diagnosing|detecting))?|in|to)\s+|\b(?:to|for)\s+(?:treat|treating|prevent|preventing|diagnose|diagnosing)\s+|\b(?:in|for|regarding|concerning|about|related\s+to|on)\s+(?:the\s+)?/i);
      if (match) focus = { start: match.index + match[0].length, syntaxStart: match.index };
    }
    if (focus) {
      const terms = focusTerms(work.slice(focus.start)).map(value => stripGeneric(refinement ? withoutTopicWords(value, currentTopic) : value)).filter(value => value && !allGeneric(value.split(/\s+/)));
      if (terms.length) candidates.push({ position: focus.start, kind: "focus", label: terms.join(" or "), terms });
      remove(focus.syntaxStart, original.length, "focus");
    }
    // "gene editing or genome editing" → topic "gene editing", synonym "genome editing".
    const topicParts = stripGeneric(refinement ? withoutTopicWords(work, currentTopic) : clean(work)).replace(/["“”]/g, "").split(/\s+or\s+/i).map(part => stripGeneric(part)).filter(Boolean);
    const topic = (topicParts[0] || "").split(",").map(part => part.trim()).filter(Boolean).join(", ");
    const topicSynonyms = refinement ? [] : [...new Set(topicParts.slice(1).map(term))];
    const seen = new Set(), groups = [], ignored = [];
    for (const item of candidates.sort((a, b) => a.position - b.position)) {
      const identity = key(item.terms);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (groups.length === 3) ignored.push(item.label); else groups.push(item);
    }
    if (!topic && !refinement) errors.push("Add a research topic, then try again.");
    return { topic, synonyms: topicSynonyms, includeGroups: groups.map(item => [...item.terms]), groups, ...range, explicitRange: yearClauses.length > 0, spans, ignored, errors: [...new Set(errors)], note: [notes(ignored), ...new Set(clarifications)].filter(Boolean).join(" ") };
  }

  function merge(current, parsed, currentYear) {
    const groups = (current.includeGroups || []).map(terms => [...terms]);
    const seen = new Set(groups.map(key)), ignored = [...parsed.ignored], errors = [...parsed.errors];
    const additions = parsed.groups.map(item => ({ ...item, terms: item.kind === "focus" ? item.terms.map(value => withoutTopicWords(value, current.topic)).filter(Boolean) : [...item.terms] })).filter(item => item.terms.length);
    const remainder = withoutTopicWords(parsed.topic, current.topic);
    if (remainder) additions.unshift({ label: remainder, terms: remainder.includes(",") ? focusTerms(remainder) : [term(remainder)] });
    for (const item of additions) {
      const identity = key(item.terms);
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (groups.length === 3) ignored.push(item.label); else groups.push(item.terms);
    }
    const from = parsed.explicitRange ? Math.max(current.from, parsed.from) : current.from;
    const to = parsed.explicitRange ? current.to == null ? parsed.to : parsed.to == null ? current.to : Math.min(current.to, parsed.to) : current.to;
    if (to !== null && from > to) errors.push("Those years do not overlap this report. Choose years within its range.");
    else { const invalid = validateRange(from, to, currentYear); if (invalid) errors.push(invalid); }
    const noChange = from === current.from && to === current.to && JSON.stringify(groups.map(key)) === JSON.stringify((current.includeGroups || []).map(key));
    return { ...current, includeGroups: groups, from, to, ignored, errors: [...new Set(errors)], note: notes(ignored), noChange };
  }
  // ---- Tolerant word matching, shared by the browser preview and the Worker's coverage check ----
  // Typos, plurals, hyphen/space differences and acronyms must never become "missing requirements".
  const fold = value => String(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const wordsIn = value => fold(value).match(/[\p{L}\p{N}]+/gu) || [];
  // Optimal string alignment distance (insert, delete, substitute, swap neighbours), stopping early past max.
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let before = null, previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
        current.push(value);
        if (value < best) best = value;
      }
      if (best > max) return max + 1;
      before = previous; previous = current;
    }
    return previous[b.length];
  }
  function stemOf(word) {
    if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (/(?:ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
    if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
    if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
    return word.length > 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
  }
  // Same word despite plural, small typo or a swapped letter. Numbers and short words must match exactly.
  function sameWord(left, right) {
    const a = fold(left), b = fold(right);
    if (a === b) return true;
    const sa = stemOf(a), sb = stemOf(b);
    if (sa === sb) return true;
    if (/\d/.test(a + b) || Math.min(sa.length, sb.length) < 5 || sa[0] !== sb[0]) return false;
    const max = Math.min(sa.length, sb.length) >= 8 ? 2 : 1;
    return editDistance(sa, sb, max) <= max;
  }
  const INITIAL_SKIP = new Set(["of", "and", "the", "for", "in", "on", "with", "to"]);
  const initials = (parts, skip) => parts.filter(part => !(skip && INITIAL_SKIP.has(part))).map(part => part[0]).join("");
  // "ptsd" is the acronym of "post traumatic stress disorder" (either spelling of the hyphen).
  const isAcronymOf = (word, parts) => parts.length >= 2 && /^\p{L}{2,8}$/u.test(word) && (initials(parts, false) === word || initials(parts, true) === word);
  const COVERAGE_FILLER = new Set(("a an the and or of on in for to with as about regarding concerning how what which why when where who whose does do did is are was were be been being can could will would should may might its it their they them this that these those " +
    "research researcher researchers studies study links link growing grow grows grew growth developing develop developed development(s) evolving evolve changing change changes trend trends trending trended increasing increase increased decreasing decrease decreased rising rise rises rose risen booming boom expanding expand expanded emerging emerge emergence popular popularity momentum traction output volume amount progress advancing advance advances overview current currently latest recent recently lately new newest today nowadays now days past last decade decades year years month months since from until between during before after " +
    "field fields topic topics area areas region regions countries country nations nation zone zones part parts world global general generally overall main major key leading top important significant significantly really very quite rather just only also still even already yet ever never too than then if while whether because by at into onto over under among across along around above below per via vs versus like such well often usually mostly mainly largely " +
    "paper papers article articles publication publications literature relationship relationships relation affect affects affected effect effects impact impacts written authored " +
    "tell show shows give gives list please me us my our we you your i im ive there any some many much more most less few lot lots types all every each both across become becomes becoming became get gets getting got go goes going keep keeps keeping continue continues start starts started begin begins around within throughout among throughout worldwide globally rapidly slowly steadily fast quickly sharply").replace("development(s)", "").split(/\s+/).filter(Boolean));
  // Research-vocabulary words a typo of which is never a topic ("rearch", "reserach", "studdies", "countires").
  const TYPO_TARGETS = ["research", "researchers", "researcher", "studies", "publications", "literature", "countries", "region", "regions"];
  function isFiller(word) {
    const w = fold(word);
    if (!w) return true;
    if (COVERAGE_FILLER.has(w) || COVERAGE_FILLER.has(stemOf(w))) return true;
    if (/\d/.test(w) || w.length < 6) return false;
    return TYPO_TARGETS.some(target => {
      const d = editDistance(w, target, 2);
      return d === 1 || d === 2 && target.length >= 8 && w[0] === target[0];
    });
  }
  const GEOGRAPHY_NOUNS = new Set("region regions area areas countries country nations nation zone zones part parts all every any across".split(" "));

  // Shared question analysis for the deterministic parser, plan coverage and title judge.
  // Only question scaffolding is discarded; concepts survive even when a model omits them.
  const PRIMARY_SCHOOL = ["primary school", "elementary school", "primary pupils", "elementary students", "grade school"];
  const SCAFFOLD = new Set("a an the and or of on in for to with about regarding concerning related how what which why when where who whose does do did is are was were be been can could will would should may might its it their they them this that these those research researchers studies study links growing developing evolving changing trends increasing bigger before fast field fields topic topics area areas domain domains help helps learn learning leading lead know evidence relationship relationships affect affects effect effects impact impacts during used applied treat treating disease written authored".split(" "));
  // Safe extra framing words for concept extraction only (never topic words on their own).
  const EXTRA_SCAFFOLD = new Set("rising rise rose increased increase booming boom expanding emerging emergence trending trend popular lately recently currently current today nowadays overall general generally state".split(" "));
  function cleanTrendTerm(value, question) {
    const text=String(value).trim();
    const trendQuestion=/\b(?:is|how|research)\b[\s\S]*\b(?:growing|rising|booming|expanding|increasing)\b/i.test(question) || /\b(?:changing|growing|developing|evolving|trends|trending|rising|increasing)\s*(?:since\s+\d{4})?\s*[?.!]*$/i.test(question) || /\btrends\s+(?:in|on)\b/i.test(question);
    if(!trendQuestion)return text;
    const cleaned=text.replace(/^trends\s+(?:in|on|for)\s+/i, "").replace(/(?:\b(?:changing|growing|developing|evolving|trends|trending|rising|increasing|booming|expanding)\b[\s,;]*)+$/gi, "").trim();
    return !/\bgrowth\b/i.test(question)?cleaned.replace(/\s+growth$/i, ""):cleaned;
  }
  function questionParts(sentence, currentYear) {
    const text = String(sentence).replace(/[’‘]/g,"'").replace(/\bchildrens\b/gi,"children").replace(/\bwho's\b/gi,"who is").replace(/\b(children|kids|women|teens|teenagers|students)'s?\b/gi,"$1");
    const resolution=globalThis.TMM_PLACES?.resolve(text);
    let rest = (resolution?.mask || text).replace(/\b(?:excluding|exclude|except|without)\b[\s\S]*$/i, "");
    const population = [];
    const addPopulation = (label, terms, pattern, preset = null) => {
      const position=rest.search(pattern);
      if (position<0) return;
      rest = rest.replace(pattern, match=>" ".repeat(match.length));
      population.push({label,terms:[...terms],preset,position});
    };
    addPopulation("Primary school pupils",PRIMARY_SCHOOL,/\b(?:primary school(?: pupils| students| children)?|elementary(?: school)?(?: pupils| students| children)?|primary pupils|grade school)\b/gi);
    addPopulation("Children 0–9",presets.children.terms,/\b(?:young children|early childhood|children|kids|child|toddlers?|preschoolers?|preschool|infants?)\b/gi,"children");
    addPopulation("Adolescents",presets.adolescents.terms,/\b(?:teens?|teenagers?|adolescents?)\b/gi,"adolescents");
    addPopulation("Pregnancy",presets.pregnancy.terms,/\b(?:pregnant women|pregnant woman|during pregnancy|pregnancy|pregnant|prenatal|antenatal)\b/gi,"pregnancy");
    addPopulation("Older adults",presets.olderAdults.terms,/\b(?:older adults?|elderly|older people)\b/gi,"olderAdults");
    addPopulation("Women",presets.women.terms,/\b(?:women|woman)\b/gi,"women");
    if (!population.some(item=>item.preset==="children" || item.label==="Primary school pupils")) addPopulation("Students",presets.students.terms,/\b(?:(?:university|college) students|students)\b/gi,"students");
    const place = resolution?resolution.matches.map(hit=>({id:hit.id,preset:globalThis.TMM_PLACES.regions[hit.id]?hit.id:null,label:hit.label,terms:globalThis.TMM_PLACES.byId[hit.id].aliases,source:hit.source,codes:hit.codes})):[];
    for (const [preset, pattern] of [["middleEast",/\b(?:middle east|mena|arab world)\b/gi],["gcc",/\b(?:gulf cooperation council|gulf countries|gulf|gcc)\b/gi]]) {
      if (!resolution && pattern.test(rest)) { place.push({preset,label:presets[preset].label,terms:[...presets[preset].terms],source:rest.match(pattern)[0]});rest=rest.replace(pattern," "); }
    }
    for (const country of countries) {
      const pattern=new RegExp("\\b(?:in|from|within|written in|authored in)\\s+(?:the\\s+)?("+country.terms.map(escapeRE).join("|")+")\\b","gi");
      if(!resolution && pattern.test(rest)){place.push({label:country.label,terms:[...country.terms]});rest=rest.replace(pattern," ");}
    }
    let from=2010,to=null,explicitRange=false;
    const rangeSources={from:null,to:null};
    rest=rest.replace(/\bbetween\s+(\d{4})\s+and\s+(\d{4})\b|\b(\d{4})\s*(?:to|until|through|[-–—])\s*(\d{4})\b/gi,(match,a,b,c,d)=>{from=+(a||c);to=+(b||d);explicitRange=true;rangeSources.from=rangeSources.to=match;return " ";});
    rest=rest.replace(/\b(?:since|from|after)\s+(\d{4})\b/gi,(match,year)=>{from=+year+(/^after/i.test(match)?1:0);explicitRange=true;rangeSources.from=match;return " ";});
    rest=rest.replace(/\b(?:until|through|up\s+to|before)\s+(\d{4})\b/gi,(match,year)=>{to=+year-(/^before/i.test(match)?1:0);explicitRange=true;rangeSources.to=match;return " ";});
    rest=rest.replace(/\b(?:in\s+the\s+|over\s+the\s+|during\s+the\s+)?(?:last|past)\s+(\d{1,2})\s+years?\b/gi,(match,count)=>{from=currentYear-Number(count);explicitRange=true;rangeSources.from=match.trim();return " ";});
    rest=rest.replace(/\bin\s+(\d{4})\b/gi,(match,year)=>{if(explicitRange)return match;from=to=+year;explicitRange=true;rangeSources.from=rangeSources.to=match;return " ";});
    rest=rest.replace(/\b(?:excluding|exclude|except|without)\b[\s\S]*$/i,"");
    // Structural connectors create AND concepts, unlike alternatives inside a concept.
    const chunks=rest.split(/[,;?]|\b(?:for|to|during|help|helps|links|affect|affects|and)\b/gi);
    const placeNamed=Boolean(resolution?.matches.length);
    const scaffold=word=>{const plain=fold(word).replace(/[^\p{L}\p{N}]/gu,"");return SCAFFOLD.has(plain) || EXTRA_SCAFFOLD.has(plain) || placeNamed && GEOGRAPHY_NOUNS.has(plain) || plain.length>=6 && TYPO_TARGETS.some(target=>{const d=editDistance(plain,target,2);return d===1 || d===2 && target.length>=8 && plain[0]===target[0];});};
    const concepts=chunks.map(chunk=>clean(cleanTrendTerm(chunk, sentence)).split(/\s+/).filter(word=>!scaffold(word)).join(" ").replace(/[^\p{L}\p{N}\s-]/gu," ").trim()).filter(Boolean);
    const recognized=/^\s*(?:how\b|what\s+(?:research|studies|work|is\s+known|do\s+we\s+know)\b|which\s+researchers\b|does\b|(?:is|are|has|have|was|were)\b[\s\S]*\b(?:grow\w*|increas\w*|ris\w*|expand\w*|boom\w*|develop\w*|chang\w*|evolv\w*|trend\w*|popular\w*|emerg\w*)\b)/i.test(text) || /^\s*childrens\b/i.test(sentence);
    return {question:String(sentence),concepts:[...new Set(concepts)],population,place,from,to,explicitRange,rangeSources,recognized,...(resolution?{resolution}:{})};
  }
  function parsedQuestion(parts,year) {
    const groups=[];
    for(const item of parts.population)groups.push({kind:"people",label:item.label,terms:item.terms,position:item.position});
    for(const item of parts.resolution?[]:parts.place)groups.push({kind:"place",label:item.label,terms:item.terms,position:parts.question.toLowerCase().indexOf(item.label.toLowerCase())});
    for(const concept of parts.concepts.slice(1))groups.push({kind:"focus",label:concept,terms:[concept.toLowerCase()],position:parts.question.toLowerCase().indexOf(concept.toLowerCase())});
    groups.sort((a,b)=>a.position-b.position);
    const rangeError=validateRange(parts.from,parts.to,year);
    const overflow=groups.length>3;
    return {...(parts.resolution?{resolvedPlace:parts.resolution}:{}),topic:parts.concepts[0] || "",synonyms:[],includeGroups:groups.slice(0,3).map(item=>item.terms),groups:groups.slice(0,3),from:parts.from,to:parts.to,explicitRange:parts.explicitRange,spans:[],ignored:overflow?groups.slice(3).map(item=>item.label):[],errors:[...(!parts.concepts.length?["Add a research topic, then try again."]:[]),...(rangeError?[rangeError]:[])],note:overflow?"This question has more than three required groups. Narrow it before searching.":""};
  }

  globalThis.TMM_QUERY_PARSER = Object.freeze({ parse, merge, countries, people, focusTerms, key, questionParts, cleanTrendTerm, PRIMARY_SCHOOL, fold, wordsIn, editDistance, stemOf, sameWord, isAcronymOf, isFiller, GEOGRAPHY_NOUNS });
})();
