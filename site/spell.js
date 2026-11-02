/* "Did you mean…?" for research words. Local and deterministic: compares typed words with
   site/vocabulary.js (built from OpenAlex topics and keywords). No network, no AI. */
(() => {
  "use strict";
  const words = String(globalThis.TMM_VOCABULARY || "").split(" ").filter(Boolean);
  const rank = new Map(words.map((word, index) => [word, index]));
  // Preset and parser terms are always known words.
  for (const preset of Object.values(globalThis.TMM_SEARCH_PRESETS || {})) {
    for (const term of preset.terms) for (const word of term.split(/\s+/)) if (!rank.has(word)) rank.set(word, rank.size);
  }

  // Optimal string alignment distance (insert, delete, substitute, swap neighbours), stopping early past max.
  function distance(a, b, max) {
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

  // Plurals and simple endings of a known word count as known ("epigenetic", "neurotechnologies").
  const forms = word => [word, word + "s", word + "es", word.replace(/s$/, ""), word.replace(/es$/, ""), word.replace(/ies$/, "y"), word.replace(/y$/, "ies"), word.replace(/al$/, ""), word + "al"];
  const known = word => forms(word).some(form => rank.has(form));

  function suggestWord(raw) {
    const word = raw.toLowerCase();
    if (!words.length || word.length < 7 || !/^\p{L}+$/u.test(word) || known(word)) return null;
    const max = word.length >= 8 ? 2 : 1;
    let best = null, bestDistance = max + 1, bestRank = Infinity;
    for (const candidate of words) {
      if (Math.abs(candidate.length - word.length) > max || candidate[0] !== word[0] && max < 2) continue;
      const value = distance(word, candidate, max);
      const position = rank.get(candidate);
      if (value < bestDistance || value === bestDistance && position < bestRank) { best = candidate; bestDistance = value; bestRank = position; }
    }
    return bestDistance <= max ? best : null;
  }

  // Returns one replacement per misspelled word, e.g. [{ word: "epignetics", suggestion: "epigenetics" }].
  function suggest(text) {
    const quoted = String(text).replace(/["“][^"“”]*["”]/g, " ");
    const seen = new Set();
    return (quoted.match(/\p{L}+/gu) || []).flatMap(word => {
      const lower = word.toLowerCase();
      if (seen.has(lower)) return [];
      seen.add(lower);
      const suggestion = suggestWord(word);
      return suggestion ? [{ word, suggestion }] : [];
    });
  }
  // Replace whole words only, keeping a leading capital.
  function apply(text, word, suggestion) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    return String(text).replace(pattern, match => match[0] === match[0].toUpperCase() ? suggestion[0].toUpperCase() + suggestion.slice(1) : suggestion);
  }
  globalThis.TMM_SPELL = Object.freeze({ suggest, apply, ready: words.length > 0 });
})();
