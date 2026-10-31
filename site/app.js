/* Static preview only. Live search and API integration belong to later steps. */
(() => {
  "use strict";
  const topic = window.SAMPLE_TOPIC;
  const library = window.SAMPLE_LIBRARY;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const number = (value) => new Intl.NumberFormat("en-US").format(value);
  const percent = (value) => value === null ? "New" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  const badge = (value) => `<span class="badge">${escape(value)}</span>`;
  let selectedField = "All fields";
  let noticeTimer;

  function notify(message) {
    clearTimeout(noticeTimer);
    $("status").textContent = message;
    $("status").hidden = false;
    noticeTimer = setTimeout(() => { $("status").hidden = true; }, 8000);
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
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${mini ? "Sample growth trend" : "Sample papers per year; values also available through Export CSV"}" style="font-family:'IBM Plex Mono',monospace"><defs><pattern id="${patternId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f5eadd"/><line x1="0" y1="0" x2="0" y2="6" stroke="#C2410C" stroke-width="2"/></pattern></defs>${grid}${bars}</svg>`;
  }

  function renderTopic() {
    $("topic-input").value = topic.name;
    $("synonyms-input").value = topic.synonyms.join(", ");
    renderSynonyms();
    $("topic-name").textContent = topic.name;
    $("topic-meta").textContent = `${topic.field} · Updated ${topic.updated} · All values are fictional`;
    const fastest = topic.subtopics.filter((item) => item.growth !== null).sort((a, b) => b.growth - a.growth)[0];
    const lastCompleteYear = Math.max(...topic.years.map((item) => item.year).filter((year) => year < new Date().getFullYear()));
    const cards = [
      ["TOTAL PAPERS", number(topic.kpis.total), "2010–2026 · includes year to date"],
      ["YEARLY GROWTH", percent(topic.kpis.growth5y), badge(topic.kpis.momentum)],
      [`PAPERS IN ${lastCompleteYear}`, number(topic.kpis.lastYear), "Last complete year"],
      ["FASTEST-GROWING SUB-TOPIC", escape(fastest.name), `${percent(fastest.growth)} between periods`]
    ];
    $("kpis").innerHTML = cards.map(([label, value, note], i) => `<article class="kpi"><span class="small-label">${label}</span><p class="kpi-value ${i === 3 ? "topic-value" : ""}">${value}</p><p class="kpi-note">${note}</p></article>`).join("");
    $("headline").textContent = topic.headline;
    $("year-chart").innerHTML = chart(topic.years);
    $("current-year-label").textContent = new Date().getFullYear();
    $("experts").innerHTML = topic.experts.map((item) => `<li><span class="rank-name">${escape(item.name)}</span><span class="number">${number(item.count)}</span></li>`).join("");
    $("journals").innerHTML = topic.journals.map((item) => `<li><span class="rank-name">${escape(item.name)}</span><span class="number">${number(item.count)}</span></li>`).join("");
    $("subtopics").innerHTML = topic.subtopics.map((item) => `<div class="data-row"><div class="row-heading"><span>${escape(item.name)}</span><span class="row-value">${percent(item.growth)}</span></div><p class="row-note">${number(item.late)} papers in late period</p></div>`).join("");
    const maxCountry = Math.max(...topic.countries.map((item) => item.count));
    $("countries").innerHTML = topic.countries.map((item) => `<div class="data-row"><div class="row-heading"><span>${escape(item.name)} ${item.gcc ? '<abbr class="gcc" title="Gulf Cooperation Council">GCC</abbr>' : ""}</span><span class="number">${number(item.count)}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${item.count / maxCountry * 100}%"></div></div></div>`).join("");
    $("papers").innerHTML = topic.papers.map((item) => `<article class="paper"><div class="paper-meta"><span>${item.year}</span><span>${number(item.citations)} CITATIONS</span></div><h4>${escape(item.title)}</h4><p>${escape(item.authors)}</p><p>${escape(item.journal)}</p></article>`).join("");
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
    document.title = `${isLibrary ? "Library" : "Search"} · Topic Momentum Meter · Sample data`;
    if (isLibrary) renderLibrary();
  }

  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    renderSynonyms();
    notify("This is a static sample. Live searches are not connected; the fictional report is unchanged.");
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
      notify("Synonym added to the form. Live searches are not connected; the sample report is unchanged.");
    }
    if (button.dataset.explore !== undefined) notify(`“${button.dataset.explore}” is a fictional sample sub-topic. Its report will be available when live searches are connected.`);
    if (button.dataset.field !== undefined) { selectedField = button.dataset.field; renderLibrary(); }
  });
  $("copy-headline").addEventListener("click", async () => {
    const text = `Sample data: ${topic.headline}`;
    try {
      await navigator.clipboard.writeText(text);
      notify("Sample headline copied.");
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($("headline"));
      selection.removeAllRanges();
      selection.addRange(range);
      notify("Automatic copying is unavailable. The sample headline is selected; press Ctrl+C or copy it manually.");
    }
  });
  $("export-csv").addEventListener("click", () => {
    const csv = "sample_data,year,papers\r\n" + topic.years.map((item) => `true,${item.year},${item.count}`).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample-lunar-moss-computing.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("hashchange", route);
  renderTopic();
  route();
})();
