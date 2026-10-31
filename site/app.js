/* Live searches and saved reports share report navigation. */
(() => {
  "use strict";
  let topic = window.SAMPLE_TOPIC;
  let isSample = true;
  let busy = false;
  const reports = new Map();
  let requestVersion = 0;
  let requestController;
  const storageKey = "topic-momentum:last-topic";
  let library = [];
  let libraryLoaded = false;
  let libraryLoading = false;
  let libraryDirty = false;
  let libraryRevision = 0;
  let libraryError = "";
  let cacheOnlyView = false;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const number = (value) => new Intl.NumberFormat("en-US").format(value);
  const papers = (count) => `${number(count)} ${count === 1 ? "paper" : "papers"}`;
  const percent = (value) => value === null ? "New" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  const badge = (value) => `<span class="badge">${escape(value)}</span>`;
  let selectedField = "All fields";
  let noticeTimer;

  function notify(message, persistent = false) {
    clearTimeout(noticeTimer);
    $("status").textContent = message;
    $("status").hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => { $("status").hidden = true; }, 8000);
  }

  function chart(years, mini = false) {
    const width = mini ? 650 : 1060;
    const height = mini ? 64 : 260;
    const left = mini ? 0 : 52;
    const bottom = mini ? 0 : 30;
    const top = mini ? 0 : 18;
    const plotHeight = height - bottom - top;
    const max = Math.max(...years.map((item) => item.count), 1);
    const ceiling = mini ? max : Math.ceil(max / 200) * 200;
    const step = (width - left - 12) / years.length;
    const currentYear = new Date().getFullYear();
    const patternId = mini ? "mini-hatch" : "year-hatch";
    const grid = mini ? "" : Array.from({ length: 5 }, (_, i) => {
      const value = ceiling * i / 4;
      const y = height - bottom - value / ceiling * plotHeight;
      return `<line x1="${left}" x2="${width}" y1="${y}" y2="${y}" stroke="#e8e8e0"/><text x="${left - 12}" y="${y + 4}" text-anchor="end" fill="#626963" font-size="11">${number(value)}</text>`;
    }).join("");
    const bars = years.map((item, i) => {
      const barHeight = item.count / ceiling * plotHeight;
      const x = left + i * step + step * .15;
      const y = height - bottom - barHeight;
      const fill = item.year === currentYear ? `url(#${patternId})` : "#C2410C";
      const label = !mini && (i % 2 === 0 || i === years.length - 1) ? `<text x="${x + step * .35}" y="${height - 6}" text-anchor="middle" fill="#626963" font-size="11">${item.year}</text>` : "";
      return `<rect x="${x}" y="${y}" width="${step * .7}" height="${barHeight}" rx="2" fill="${fill}"><title>${item.year}: ${papers(item.count)}${item.year === currentYear ? " (year to date)" : ""}</title></rect>${label}`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${mini ? "Growth trend" : "Papers per year; values also available through Export CSV"}" style="font-family:'IBM Plex Mono',monospace"><defs><pattern id="${patternId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f5eadd"/><line x1="0" y1="0" x2="0" y2="6" stroke="#C2410C" stroke-width="2"/></pattern></defs>${grid}${bars}</svg>`;
  }

  function renderTopic() {
    $("report-source").textContent = isSample ? "SAMPLE DATA" : "OPENALEX";
    $("data-notice").textContent = location.hash === "#library" ? "Saved research reports. Opening a report uses the cache without running a new search." : isSample ? "Sample data: fictional research and illustrative numbers. Search to load OpenAlex data." : "Data: OpenAlex. The last successful report is saved in this browser.";
    $("topic-input").value = topic.searchTerms?.name || topic.name;
    $("synonyms-input").value = (topic.searchTerms?.synonyms || topic.synonyms).join(", ");
    renderSynonyms();
    $("topic-name").textContent = topic.name;
    $("topic-meta").textContent = `${topic.field} · Updated ${topic.updated} ${isSample ? "· All values are fictional" : ""}`;
    const parentName = topic.searchTerms?.name || topic.parentName || topic.name;
    $("back-parent").hidden = !topic.subtopicId;
    $("back-parent").textContent = `← Back to ${parentName}`;
    $("back-parent").href = reportHash({ ...topic, name: parentName, subtopicId: null }, cacheOnlyView);
    $("subtopics-panel").hidden = Boolean(topic.subtopicId);
    if (topic.subtopicId) $("topic-meta").textContent += ` · Under ${parentName}`;
    if (topic.stale) $("topic-meta").textContent += " · Saved report, older than 7 days";
    const empty = topic.kpis.total === 0;
    $("no-results").hidden = !empty;
    $("report-content").hidden = empty;
    if (empty) return;
    const fastest = topic.subtopics.filter((item) => item.growth !== null).sort((a, b) => b.growth - a.growth)[0];
    const topCountry = topic.countries.slice().sort((a, b) => b.count - a.count)[0];
    const lastCompleteYear = Math.max(...topic.years.map((item) => item.year).filter((year) => year < new Date().getFullYear()));
    const cards = [
      ["TOTAL PAPERS", number(topic.kpis.total), `2010–${new Date().getFullYear()} · includes year to date`],
      ["YEARLY GROWTH", percent(topic.kpis.growth5y), badge(topic.kpis.momentum)],
      [`PAPERS IN ${lastCompleteYear}`, number(topic.kpis.lastYear), "Last complete year"],
      topic.subtopicId ? ["TOP COUNTRY", topCountry ? escape(topCountry.name) : "Not enough data", topCountry ? `${papers(topCountry.count)} since 2020` : "No country data"] : ["FASTEST-GROWING SUB-TOPIC", fastest ? escape(fastest.name) : "Not enough data", fastest ? `${percent(fastest.growth)} between periods` : "No comparable sub-topics"]
    ];
    $("kpis").innerHTML = cards.map(([label, value, note], i) => `<article class="kpi"><span class="small-label">${label}</span><p class="kpi-value ${i === 3 ? "topic-value" : ""}">${value}</p><p class="kpi-note">${note}</p></article>`).join("");
    $("headline").textContent = topic.headline;
    $("year-chart").innerHTML = chart(topic.years);
    $("current-year-label").textContent = new Date().getFullYear();
    $("experts").innerHTML = topic.experts.map((item) => `<li><span class="rank-name">${item.openalexUrl ? `<a href="${escape(item.openalexUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.name)}</a>` : escape(item.name)}</span><span class="number">${number(item.count)}</span></li>`).join("");
    $("journals").innerHTML = topic.journals.map((item) => `<li><span class="rank-name">${escape(item.name)}</span><span class="number">${number(item.count)}</span></li>`).join("");
    $("subtopics").innerHTML = topic.subtopics.map((item) => `<div class="data-row"><div class="row-heading">${item.id ? `<button type="button" class="chip" data-subtopic="${escape(item.id)}" data-title="${escape(item.name)}">${escape(item.name)} ↗</button>` : `<span>${escape(item.name)}</span>`}<span class="row-value">${percent(item.growth)}</span></div><p class="row-note">${papers(item.late)} in late period</p></div>`).join("");
    const maxCountry = Math.max(1, ...topic.countries.map((item) => item.count));
    $("countries").innerHTML = topic.countries.map((item) => `<div class="data-row"><div class="row-heading"><span>${escape(item.name)} ${item.gcc ? '<abbr class="gcc" title="Gulf Cooperation Council">GCC</abbr>' : ""}</span><span class="number">${number(item.count)}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${item.count / maxCountry * 100}%"></div></div></div>`).join("");
    $("regional-counts").textContent = topic.regionalCounts ? `Since 2020 · UAE: ${papers(topic.regionalCounts.uae)} · GCC: ${papers(topic.regionalCounts.gcc)} (each paper counted once)` : "UAE and GCC totals are unavailable in this sample.";
    $("papers").innerHTML = topic.papers.map((item) => `<article class="paper"><div class="paper-meta"><span>${item.year}</span><span>${number(item.citations)} ${item.citations === 1 ? "CITATION" : "CITATIONS"}</span></div><h4>${item.url ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>` : escape(item.title)}</h4><p>${escape(item.authors)}</p><p>${escape(item.journal)}</p></article>`).join("");
    $("suggested-synonyms").innerHTML = topic.suggestedSynonyms.map((term) => `<button class="chip" type="button" data-suggest="${escape(term)}">+ ${escape(term)}</button>`).join("");
    $("explore-next").innerHTML = topic.subtopicId ? topic.suggestedSynonyms.map((term) => `<button class="chip" type="button" data-next-term="${escape(term)}">${escape(term)} ↗</button>`).join("") : topic.exploreNext.map((item) => typeof item === "object" && item.id ? `<button class="chip" type="button" data-subtopic="${escape(item.id)}" data-title="${escape(item.name)}">${escape(item.name)} ↗</button>` : `<span class="chip">${escape(typeof item === "string" ? item : item.name)}</span>`).join("");
    $("explore-section").hidden = !$("explore-next").innerHTML;
  }

  function synonyms() {
    return [...new Set($("synonyms-input").value.split(",").map((term) => term.trim()).filter(Boolean))];
  }

  function renderSynonyms() {
    $("synonym-chips").innerHTML = synonyms().map((term) => `<button class="chip" type="button" data-remove="${escape(term)}" aria-label="Remove synonym ${escape(term)}">${escape(term)} ×</button>`).join("");
  }

  function sparkChart(entry) {
    if (!Array.isArray(entry.spark) || entry.spark.length !== 10 || !entry.spark.every((count) => Number.isSafeInteger(count) && count >= 0)) return "";
    const lastYear = Number(entry.updated.slice(0, 4)) - 1;
    const max = Math.max(1, ...entry.spark);
    const bars = entry.spark.map((count, i) => {
      const height = count / max * 64;
      return `<rect x="${i * 65 + 8}" y="${64 - height}" width="45" height="${height}" rx="2" fill="#C2410C"><title>${lastYear - 9 + i}: ${papers(count)}</title></rect>`;
    }).join("");
    return `<svg class="mini-chart" viewBox="0 0 650 64" role="img" aria-label="Papers per year, ${lastYear - 9} to ${lastYear}">${bars}</svg>`;
  }

  function libraryLink(entry) {
    const parent = library.find((item) => item.id === entry.parent);
    const subtopicId = entry.subtopicId || entry.id.match(/\|primary_topic:(T[0-9]+)$/)?.[1];
    const searchTerms = entry.searchTerms || (subtopicId && parent ? { name: parent.name, synonyms: parent.synonyms } : undefined);
    return reportHash({ ...entry, subtopicId, searchTerms }, true);
  }

  function renderLibrary() {
    $("library-page").toggleAttribute("aria-busy", libraryLoading);
    $("library-error").textContent = libraryError;
    $("library-error").hidden = !libraryError;
    $("library-retry").hidden = !libraryError;
    if (!libraryLoaded) {
      $("fields").innerHTML = "";
      $("library-cards").innerHTML = "";
      $("library-empty").hidden = true;
      $("library-count").textContent = libraryLoading ? "Loading library…" : "";
      return;
    }
    const roots = library.filter((item) => !item.parent);
    const childrenFor = (item) => item.children.map((id) => library.find((child) => child.id === id)).filter(Boolean);
    const query = $("library-search").value.trim().toLowerCase();
    const fields = ["All fields", ...new Set(roots.map((item) => item.field))];
    if (!fields.includes(selectedField)) selectedField = "All fields";
    $("fields").innerHTML = fields.map((field) => `<button type="button" class="field-button" data-field="${escape(field)}" aria-pressed="${field === selectedField}"><span>${escape(field)}</span><span class="number">${roots.filter((item) => field === "All fields" || item.field === field).length}</span></button>`).join("");
    const entries = roots.filter((item) => (selectedField === "All fields" || item.field === selectedField) &&
      [item.name, ...item.synonyms, ...childrenFor(item).flatMap((child) => [child.name, ...child.synonyms])].join(" ").toLowerCase().includes(query));
    const sort = $("library-sort").value;
    entries.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "updated" ? b.updated.localeCompare(a.updated) : (b.growth ?? -Infinity) - (a.growth ?? -Infinity) || a.name.localeCompare(b.name));
    const childCount = entries.reduce((sum, item) => sum + childrenFor(item).length, 0);
    $("library-count").textContent = libraryLoading ? "Loading library…" : `${entries.length} ${entries.length === 1 ? "TOPIC" : "TOPICS"} · ${childCount} ${childCount === 1 ? "SUB-TOPIC" : "SUB-TOPICS"} EXPLORED`;
    $("library-empty").textContent = roots.length ? "No topics match. Try a different search or choose All fields." : "The Library is empty. Search for a topic to save its report.";
    $("library-empty").hidden = entries.length !== 0;
    $("library-cards").innerHTML = entries.map((item) => {
      const children = childrenFor(item);
      return `<article class="library-card"><div class="card-meta"><span class="small-label">${escape(item.field)}</span>${badge(item.momentum)}</div><h2><a href="${escape(libraryLink(item))}">${escape(item.name)} ↗</a></h2><p class="muted">${item.growth === null ? "Not enough data for annual growth" : `${percent(item.growth)} annual growth`}</p>${sparkChart(item)}${children.length ? `<span class="small-label">SUB-TOPICS EXPLORED</span><div class="chips">${children.map((child) => `<a class="chip" href="${escape(libraryLink(child))}">${escape(child.name)} ↗</a>`).join("")}</div>` : ""}<p class="updated">Updated ${escape(item.updated)} · ${papers(item.total)}</p></article>`;
    }).join("");
  }

  async function loadLibrary(force = false) {
    if (libraryLoading) return;
    if (libraryLoaded && !libraryDirty && !force) { renderLibrary(); return; }
    libraryLoading = true;
    const revision = libraryRevision;
    libraryError = "";
    renderLibrary();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      let response;
      try { response = await fetch(window.WORKER_URL.replace(/\/$/, "") + "/api/library", { signal: controller.signal }); }
      catch { throw new Error("Can’t reach the data service. Start the Worker and try again."); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The data service returned an unreadable library. Try again later."); }
      if (!response.ok) throw new Error(typeof data.message === "string" && data.message.trim() ? data.message : "The Library could not be loaded. Try again later.");
      if (!Array.isArray(data) || !data.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.field === "string" && typeof item.updated === "string" && Array.isArray(item.synonyms) && Array.isArray(item.children))) throw new Error("The data service returned an unreadable library. Try again later.");
      library = data;
      libraryLoaded = true;
      libraryDirty = libraryRevision !== revision;
    } catch (error) { libraryError = error.message; }
    finally { clearTimeout(timeout); libraryLoading = false; renderLibrary(); }
  }

  function reportHash(report, cacheOnly = false) {
    const terms = report.searchTerms || { name: report.name, synonyms: report.synonyms };
    const params = new URLSearchParams({ topic: terms.name });
    if (terms.synonyms.length) params.set("syn", terms.synonyms.join(","));
    if (report.subtopicId) {
      params.set("sub", report.subtopicId);
      params.set("title", report.name);
    }
    if (cacheOnly) params.set("cache", "only");
    return "#" + params.toString();
  }

  function rememberReport() {
    reports.set(reportHash(topic, cacheOnlyView), topic);
    try { localStorage.setItem(storageKey, JSON.stringify({ ...topic, _cacheOnlyView: cacheOnlyView })); } catch { /* Storage may be unavailable. */ }
  }

  function setLoading(loading) {
    busy = loading;
    $("search-form").toggleAttribute("aria-busy", loading);
    document.querySelectorAll('#search-form input, #search-form button, #suggested-synonyms button, #explore-next button, #subtopics button').forEach((control) => { control.disabled = loading; });
  }

  function route(loadReport = true) {
    const isLibrary = location.hash === "#library";
    $("library-page").hidden = !isLibrary;
    $("topic-page").hidden = isLibrary;
    $("search-nav").toggleAttribute("aria-current", !isLibrary);
    $("library-nav").toggleAttribute("aria-current", isLibrary);
    $(isLibrary ? "library-nav" : "search-nav").setAttribute("aria-current", "page");
    document.title = `${isLibrary ? "Library" : "Search"} · Topic Momentum Meter`;
    $("data-notice").textContent = isLibrary ? "Saved research reports. Opening a report uses the cache without running a new search." : isSample ? "Sample data: fictional research and illustrative numbers. Search to load OpenAlex data." : "Data: OpenAlex. The last successful report is saved in this browser.";
    if (isLibrary) { if (loadReport) loadLibrary(); else renderLibrary(); }
    if (!loadReport) return;
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("topic")) {
      if (busy) { requestController?.abort(); requestVersion++; setLoading(false); $("status").hidden = true; }
      return;
    }
    if (!isSample && reportHash(topic, cacheOnlyView) === location.hash) {
      if (busy) { requestController?.abort(); requestVersion++; setLoading(false); renderTopic(); $("status").hidden = true; }
      return;
    }
    requestController?.abort();
    requestVersion++;
    setLoading(false);
    if (reports.has(location.hash)) {
      topic = reports.get(location.hash);
      cacheOnlyView = new URLSearchParams(location.hash.slice(1)).get("cache") === "only";
      isSample = false;
      renderTopic();
      rememberReport();
      clearTimeout(noticeTimer);
      $("status").hidden = true;
      return;
    }
    const name = params.get("topic");
    const terms = (params.get("syn") || "").split(",").filter(Boolean);
    const id = params.get("sub");
    if (id && !/^T[0-9]+$/.test(id)) { notify("The sub-topic ID is invalid. Run the parent search again.", true); return; }
    const parent = [name.toLowerCase().trim(), ...terms.map((term) => term.toLowerCase().trim()).sort()].join("|");
    search(name, terms, id ? { id, name: params.get("title") || id, parent, parentName: name } : null, true, params.get("cache") === "only");
  }

  async function search(name = $("topic-input").value, terms = synonyms(), selection = null, fromRoute = false, cacheOnly = false) {
    if (busy) return;
    if (!name.trim()) { notify("Enter a research topic and try again.", true); return; }
    setLoading(true);
    const version = ++requestVersion;
    notify("Loading research data…", true);
    const controller = new AbortController();
    requestController = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const url = new URL(window.WORKER_URL.replace(/\/$/, "") + "/api/topic");
      url.searchParams.set("q", name.trim());
      url.searchParams.set("syn", terms.join(","));
      if (cacheOnly) url.searchParams.set("cache", "only");
      if (selection) {
        url.searchParams.set("subtopic", selection.id);
        url.searchParams.set("subtopicName", selection.name);
        url.searchParams.set("parent", selection.parent);
        url.searchParams.set("parentName", selection.parentName);
      }
      let response;
      try { response = await fetch(url, { signal: controller.signal }); }
      catch { throw new Error("Can’t reach the data service. Start the Worker and try again."); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The data service returned an unreadable report. Try again later."); }
      if (!response.ok) {
        throw new Error(typeof data.message === "string" && data.message.trim() ? data.message : "The data service could not complete the search. Try again later.");
      }
      if (version !== requestVersion) return;
      topic = { ...data, searchTerms: { name: name.trim(), synonyms: terms } };
      isSample = false;
      cacheOnlyView = cacheOnly;
      if (!cacheOnly) { libraryDirty = true; libraryRevision++; }
      renderTopic();
      rememberReport();
      if (!fromRoute) location.hash = reportHash(topic, cacheOnlyView);
      route(false);
      if (topic.kpis.total === 0) { clearTimeout(noticeTimer); $("status").hidden = true; }
      else notify("Research data loaded.");
    } catch (error) { if (version === requestVersion) notify(error.message || "The data service returned an unreadable report. Try again later.", true); }
    finally {
      clearTimeout(timeout);
      if (version === requestVersion) setLoading(false);
    }
  }

  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    renderSynonyms();
    search();
  });
  $("topic-input").addEventListener("input", () => {
    $("synonyms-input").value = "";
    renderSynonyms();
  });
  $("synonyms-input").addEventListener("input", renderSynonyms);
  $("library-search").addEventListener("input", renderLibrary);
  $("library-sort").addEventListener("change", renderLibrary);
  $("library-retry").addEventListener("click", () => loadLibrary(true));
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.remove !== undefined) {
      $("synonyms-input").value = synonyms().filter((term) => term !== button.dataset.remove).join(", ");
      renderSynonyms();
      $("synonyms-input").focus();
    }
    if (button.dataset.suggest !== undefined) {
      $("synonyms-input").value = [...new Set([...synonyms(), button.dataset.suggest])].join(", ");
      renderSynonyms();
      search();
    }
    if (button.dataset.subtopic !== undefined) {
      const match = button.dataset.subtopic.match(/^(?:https:\/\/openalex\.org\/)?(T[0-9]+)$/);
      if (!match) { notify("The sub-topic ID is invalid. Run the parent search again.", true); return; }
      const terms = topic.searchTerms || { name: topic.name, synonyms: topic.synonyms };
      search(terms.name, terms.synonyms, { id: match[1], name: button.dataset.title, parent: topic.subtopicId ? topic.parent : topic.id, parentName: terms.name });
    }
    if (button.dataset.nextTerm !== undefined) {
      const terms = topic.searchTerms || { name: topic.name, synonyms: topic.synonyms };
      search(`${terms.name} ${button.dataset.nextTerm}`, [], null);
    }
    if (button.dataset.field !== undefined) { selectedField = button.dataset.field; renderLibrary(); }
  });
  $("copy-headline").addEventListener("click", async () => {
    const text = `${isSample ? "Sample data: " : ""}${topic.headline}`;
    try {
      await navigator.clipboard.writeText(text);
      notify("Headline copied.");
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($("headline"));
      selection.removeAllRanges();
      selection.addRange(range);
      notify("Automatic copying is unavailable. The headline is selected; press Ctrl+C or copy it manually.");
    }
  });
  $("export-csv").addEventListener("click", () => {
    const csv = "sample_data,year,papers\r\n" + topic.years.map((item) => `${isSample},${item.year},${item.count}`).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${isSample ? "sample-" : ""}${topic.name.replace(/[^a-z0-9]+/gi, "-")}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("hashchange", route);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.name === "string" && Array.isArray(saved.years) && saved.kpis) {
      const { _cacheOnlyView, ...savedTopic } = saved;
      topic = savedTopic;
      cacheOnlyView = _cacheOnlyView === true;
      isSample = false;
      renderTopic();
    }
  } catch { topic = window.SAMPLE_TOPIC; isSample = true; }
  renderTopic();
  if (!isSample) {
    rememberReport();
    if (!location.hash || location.hash === "#search") history.replaceState(null, "", reportHash(topic, cacheOnlyView));
  }
  route();
})();
