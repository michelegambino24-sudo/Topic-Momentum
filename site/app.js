/* Topic searches use the Worker; the Library remains a sample until step 5. */
(() => {
  "use strict";
  let topic = window.SAMPLE_TOPIC;
  let isSample = true;
  let busy = false;
  const storageKey = "topic-momentum:last-topic";
  const library = window.SAMPLE_LIBRARY;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const number = (value) => new Intl.NumberFormat("en-US").format(value);
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
      return `<rect x="${x}" y="${y}" width="${step * .7}" height="${barHeight}" rx="2" fill="${fill}"><title>${item.year}: ${number(item.count)} papers${item.year === currentYear ? " (year to date)" : ""}</title></rect>${label}`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${mini ? "Growth trend" : "Papers per year; values also available through Export CSV"}" style="font-family:'IBM Plex Mono',monospace"><defs><pattern id="${patternId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f5eadd"/><line x1="0" y1="0" x2="0" y2="6" stroke="#C2410C" stroke-width="2"/></pattern></defs>${grid}${bars}</svg>`;
  }

  function renderTopic() {
    $("report-source").textContent = isSample ? "SAMPLE DATA" : "OPENALEX";
    $("data-notice").textContent = location.hash === "#library" ? "Library sample: fictional topics and illustrative numbers." : isSample ? "Sample data: fictional research and illustrative numbers. Search to load OpenAlex data." : "Data: OpenAlex. The last successful report is saved in this browser.";
    $("topic-input").value = topic.name;
    $("synonyms-input").value = topic.synonyms.join(", ");
    renderSynonyms();
    $("topic-name").textContent = topic.name;
    $("topic-meta").textContent = `${topic.field} · Updated ${topic.updated} ${isSample ? "· All values are fictional" : ""}`;
    const fastest = topic.subtopics.filter((item) => item.growth !== null).sort((a, b) => b.growth - a.growth)[0];
    const lastCompleteYear = Math.max(...topic.years.map((item) => item.year).filter((year) => year < new Date().getFullYear()));
    const cards = [
      ["TOTAL PAPERS", number(topic.kpis.total), `2010–${new Date().getFullYear()} · includes year to date`],
      ["YEARLY GROWTH", percent(topic.kpis.growth5y), badge(topic.kpis.momentum)],
      [`PAPERS IN ${lastCompleteYear}`, number(topic.kpis.lastYear), "Last complete year"],
      ["FASTEST-GROWING SUB-TOPIC", fastest ? escape(fastest.name) : "Not enough data", fastest ? `${percent(fastest.growth)} between periods` : "No comparable sub-topics"]
    ];
    $("kpis").innerHTML = cards.map(([label, value, note], i) => `<article class="kpi"><span class="small-label">${label}</span><p class="kpi-value ${i === 3 ? "topic-value" : ""}">${value}</p><p class="kpi-note">${note}</p></article>`).join("");
    $("headline").textContent = topic.headline;
    $("year-chart").innerHTML = chart(topic.years);
    $("current-year-label").textContent = new Date().getFullYear();
    $("experts").innerHTML = topic.experts.map((item) => `<li><span class="rank-name">${item.openalexUrl ? `<a href="${escape(item.openalexUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.name)}</a>` : escape(item.name)}</span><span class="number">${number(item.count)}</span></li>`).join("");
    $("journals").innerHTML = topic.journals.map((item) => `<li><span class="rank-name">${escape(item.name)}</span><span class="number">${number(item.count)}</span></li>`).join("");
    $("subtopics").innerHTML = topic.subtopics.map((item) => `<div class="data-row"><div class="row-heading"><span>${escape(item.name)}</span><span class="row-value">${percent(item.growth)}</span></div><p class="row-note">${number(item.late)} papers in late period</p></div>`).join("");
    const maxCountry = Math.max(1, ...topic.countries.map((item) => item.count));
    $("countries").innerHTML = topic.countries.map((item) => `<div class="data-row"><div class="row-heading"><span>${escape(item.name)} ${item.gcc ? '<abbr class="gcc" title="Gulf Cooperation Council">GCC</abbr>' : ""}</span><span class="number">${number(item.count)}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${item.count / maxCountry * 100}%"></div></div></div>`).join("");
    $("regional-counts").textContent = topic.regionalCounts ? `Since 2020 · UAE: ${number(topic.regionalCounts.uae)} papers · GCC: ${number(topic.regionalCounts.gcc)} papers (each paper counted once)` : "UAE and GCC totals are unavailable in this sample.";
    $("papers").innerHTML = topic.papers.map((item) => `<article class="paper"><div class="paper-meta"><span>${item.year}</span><span>${number(item.citations)} CITATIONS</span></div><h4>${item.url ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>` : escape(item.title)}</h4><p>${escape(item.authors)}</p><p>${escape(item.journal)}</p></article>`).join("");
    $("suggested-synonyms").innerHTML = topic.suggestedSynonyms.map((term) => `<button class="chip" type="button" data-suggest="${escape(term)}">+ ${escape(term)}</button>`).join("");
    $("explore-next").innerHTML = topic.exploreNext.map((term) => `<button class="chip" type="button" data-explore="${escape(term)}">${escape(term)} ↗</button>`).join("");
  }

  function synonyms() {
    return [...new Set($("synonyms-input").value.split(",").map((term) => term.trim()).filter(Boolean))];
  }

  function renderSynonyms() {
    $("synonym-chips").innerHTML = synonyms().map((term) => `<button class="chip" type="button" data-remove="${escape(term)}" aria-label="Remove synonym ${escape(term)}">${escape(term)} ×</button>`).join("");
  }

  function renderLibrary() {
    const roots = library.filter((item) => !item.parent);
    const query = $("library-search").value.trim().toLowerCase();
    const fields = ["All fields", ...new Set(roots.map((item) => item.field))];
    $("fields").innerHTML = fields.map((field) => `<button type="button" class="field-button" data-field="${escape(field)}" aria-pressed="${field === selectedField}"><span>${escape(field)}</span><span class="number">${roots.filter((item) => field === "All fields" || item.field === field).length}</span></button>`).join("");
    const entries = roots.filter((item) => (selectedField === "All fields" || item.field === selectedField) && [item.name, ...item.synonyms].join(" ").toLowerCase().includes(query));
    const sort = $("library-sort").value;
    entries.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "updated" ? b.updated.localeCompare(a.updated) : (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
    $("library-count").textContent = `${entries.length} SAMPLE ${entries.length === 1 ? "TOPIC" : "TOPICS"} · ${library.filter((item) => item.parent).length} SUB-TOPICS EXPLORED`;
    $("library-empty").hidden = entries.length !== 0;
    $("library-cards").innerHTML = entries.map((item) => {
      const children = item.children.map((id) => library.find((child) => child.id === id)).filter(Boolean);
      return `<article class="library-card"><div class="card-meta"><span class="small-label">${escape(item.field)}</span>${badge(item.momentum)}</div><h2><a href="#search">${escape(item.name)} ↗</a></h2><p class="muted">${percent(item.growth)} annual growth · <span class="sample-label">Sample data</span></p>${item.id === topic.id ? chart(topic.years, true) : ""}<span class="small-label">SUB-TOPICS EXPLORED</span><div class="chips">${children.map((child) => `<button type="button" class="chip" data-explore="${escape(child.name)}">${escape(child.name)} ↗</button>`).join("")}</div><p class="updated">Updated ${escape(item.updated)} · ${number(item.total)} papers</p></article>`;
    }).join("");
  }

  function route() {
    const isLibrary = location.hash === "#library";
    $("library-page").hidden = !isLibrary;
    $("topic-page").hidden = isLibrary;
    $("search-nav").toggleAttribute("aria-current", !isLibrary);
    $("library-nav").toggleAttribute("aria-current", isLibrary);
    $(isLibrary ? "library-nav" : "search-nav").setAttribute("aria-current", "page");
    document.title = `${isLibrary ? "Library" : "Search"} · Topic Momentum Meter`;
    $("data-notice").textContent = isLibrary ? "Library sample: fictional topics and illustrative numbers." : isSample ? "Sample data: fictional research and illustrative numbers. Search to load OpenAlex data." : "Data: OpenAlex. The last successful report is saved in this browser.";
    if (isLibrary) renderLibrary();
  }

  async function search(name = $("topic-input").value, terms = synonyms(), parent) {
    if (busy) return;
    if (!name.trim()) { notify("Enter a research topic and try again.", true); return; }
    busy = true;
    $("search-form").setAttribute("aria-busy", "true");
    document.querySelectorAll('#search-form input, #search-form button, #suggested-synonyms button, #explore-next button').forEach((control) => { control.disabled = true; });
    notify("Loading research data…", true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const url = new URL(window.WORKER_URL.replace(/\/$/, "") + "/api/topic");
      url.searchParams.set("q", name.trim());
      url.searchParams.set("syn", terms.join(","));
      if (parent) url.searchParams.set("parent", parent);
      let response;
      try { response = await fetch(url, { signal: controller.signal }); }
      catch { throw new Error("Can’t reach the data service. Start the Worker and try again."); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The data service returned an unreadable report. Try again later."); }
      if (!response.ok) {
        const messages = {
          daily_limit: "Daily limit reached. Try again tomorrow or browse the Library.",
          source_unavailable: "The research data source is unavailable. Try again later.",
          missing_key: "The data service is missing its OpenAlex key. Set the Worker secret and try again.",
          invalid_query: "The search is invalid. Check the topic and synonyms and try again.",
          origin_not_allowed: "This site cannot access the data service. Check the Worker’s allowed origin and try again."
        };
        throw new Error(messages[data.error] || "The data service could not complete the search. Try again later.");
      }
      topic = data;
      isSample = false;
      renderTopic();
      location.hash = "#search";
      try { localStorage.setItem(storageKey, JSON.stringify(topic)); } catch { /* Storage may be unavailable. */ }
      notify("Research data loaded.");
    } catch (error) { notify(error.message || "The data service returned an unreadable report. Try again later.", true); }
    finally {
      clearTimeout(timeout);
      busy = false;
      $("search-form").removeAttribute("aria-busy");
      document.querySelectorAll('#search-form input, #search-form button, #suggested-synonyms button, #explore-next button').forEach((control) => { control.disabled = false; });
    }
  }

  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    renderSynonyms();
    search();
  });
  $("synonyms-input").addEventListener("input", renderSynonyms);
  $("library-search").addEventListener("input", renderLibrary);
  $("library-sort").addEventListener("change", renderLibrary);
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
    if (button.dataset.explore !== undefined) search(button.dataset.explore, [], topic.id);
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
      topic = saved;
      isSample = false;
      renderTopic();
    }
  } catch { topic = window.SAMPLE_TOPIC; isSample = true; }
  renderTopic();
  route();
})();
