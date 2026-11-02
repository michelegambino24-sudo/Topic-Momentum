// Exact keyword sets shared by the plain-script website and Worker.
// These match title/abstract text, never author locations or affiliations.
// Changing terms requires a new version and a matching saved version fixture.
globalThis.TMM_SEARCH_PRESETS = Object.freeze({
  children: Object.freeze({ version: 1, label: "Children 0–9", subject: "children", phrase: "in children", terms: Object.freeze("children, child, childhood, infant, toddler, preschool, kindergarten, pediatric, early childhood".split(", ")) }),
  gcc: Object.freeze({ version: 1, label: "GCC", subject: "GCC terms", phrase: "in the GCC", terms: Object.freeze("gulf cooperation council, gulf states, bahrain, bahraini, kuwait, kuwaiti, oman, omani, qatar, qatari, saudi arabia, saudi, saudi arabian, ksa, united arab emirates, uae, emirati".split(", ")) }),
  middleEast: Object.freeze({ version: 1, label: "Middle East", subject: "Middle East terms", phrase: "in the Middle East", terms: Object.freeze("middle east, middle eastern, gulf states, bahrain, bahraini, egypt, egyptian, iran, iranian, iraq, iraqi, israel, israeli, jordanian, kuwait, kuwaiti, lebanon, lebanese, oman, omani, palestine, palestinian, qatar, qatari, saudi arabia, saudi, saudi arabian, ksa, syria, syrian, türkiye, turkish, united arab emirates, uae, emirati, yemen, yemeni".split(", ")) }),
  pregnancy: Object.freeze({ version: 1, label: "Pregnancy", subject: "pregnancy", phrase: "in pregnancy", terms: Object.freeze("pregnancy, pregnant, prenatal, antenatal, maternal, gestation, gestational, expectant mothers".split(", ")) }),
  women: Object.freeze({ version: 1, label: "Women", subject: "women", phrase: "in women", terms: Object.freeze(["women", "woman"]) }),
  adolescents: Object.freeze({ version: 1, label: "Adolescents", subject: "adolescents", phrase: "in adolescents", terms: Object.freeze(["adolescent", "adolescents", "teen", "teens", "teenager", "teenagers"]) }),
  olderAdults: Object.freeze({ version: 1, label: "Older adults", subject: "older adults", phrase: "in older adults", terms: Object.freeze(["older adult", "older adults", "elderly", "older people"]) }),
  students: Object.freeze({ version: 1, label: "Students", subject: "students", phrase: "among students", terms: Object.freeze(["student", "students"]) })
});

// Single-country groups recognised in sentences. Display only: they name the group in titles and headlines.
// Their terms stay full in search identities (they are short), so no versions are needed.
globalThis.TMM_COUNTRY_GROUPS = Object.freeze([
  ["UAE", "in the UAE", "united arab emirates,uae,emirati"], ["Saudi Arabia", "in Saudi Arabia", "saudi arabia,saudi,saudi arabian,ksa"],
  ["Qatar", "in Qatar", "qatar,qatari"], ["Kuwait", "in Kuwait", "kuwait,kuwaiti"], ["Oman", "in Oman", "oman,omani"],
  ["Bahrain", "in Bahrain", "bahrain,bahraini"], ["Egypt", "in Egypt", "egypt,egyptian"], ["Jordan", "in Jordan", "jordan,jordanian"],
  ["Iran", "in Iran", "iran,iranian"], ["Iraq", "in Iraq", "iraq,iraqi"], ["Israel", "in Israel", "israel,israeli"],
  ["Lebanon", "in Lebanon", "lebanon,lebanese"], ["Palestine", "in Palestine", "palestine,palestinian"],
  ["Syria", "in Syria", "syria,syrian"], ["Türkiye", "in Türkiye", "türkiye,turkish"], ["Yemen", "in Yemen", "yemen,yemeni"]
].map(([label, phrase, terms]) => Object.freeze({ label, phrase, subject: label, terms: Object.freeze(terms.split(",")) })));

// Shared by the Worker and browser; callers supply already-normalized groups.
globalThis.TMM_PRESET_IDENTITIES = Object.freeze({
  encode(groups, presets = globalThis.TMM_SEARCH_PRESETS) {
    if (!groups.length) return "";
    if (groups.length === 1) return "include:" + JSON.stringify(groups[0]);
    const encoded = groups.map(terms => {
      const identity = JSON.stringify([...terms].sort());
      const entry = Object.entries(presets).find(([, preset]) => JSON.stringify([...preset.terms].sort()) === identity);
      if (!entry) return terms;
      const [id, preset] = entry;
      if (!Number.isSafeInteger(preset.version) || preset.version < 1) throw new Error("Invalid preset version");
      return `preset:${id}@${preset.version}`;
    });
    // Canonicalize token-bearing identities only; old custom-only IDs keep their order.
    if (encoded.some(item => typeof item === "string")) encoded.sort((a, b) => {
      const left = JSON.stringify(a), right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return "includeGroups:" + JSON.stringify(encoded);
  },
  expand(groups, presets = globalThis.TMM_SEARCH_PRESETS) {
    if (!Array.isArray(groups)) throw new Error("Invalid include groups");
    return groups.map(group => {
      if (Array.isArray(group) && group.every(term => typeof term === "string")) return [...group];
      const match = typeof group === "string" && group.match(/^preset:([A-Za-z][A-Za-z0-9]*)@([1-9][0-9]*)$/);
      const preset = match && presets[match[1]];
      if (!preset || String(preset.version) !== match[2]) throw new Error("Unknown preset version");
      return [...preset.terms];
    });
  }
});
