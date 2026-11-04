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
  const myLibraryKey = "topic-momentum:my-library";
  let myLibrary = [];
  try {
    const saved = JSON.parse(localStorage.getItem(myLibraryKey));
    if (Array.isArray(saved)) myLibrary = saved.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.updated === "string");
  } catch { /* Storage may be unavailable or damaged. */ }
  let libraryTab = "my";
  let library = [];
  let libraryLoaded = false;
  let libraryLoading = false;
  let libraryDirty = false;
  let libraryRevision = 0;
  let libraryError = "";
  let cacheOnlyView = false;
  let previousRouteHash;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const number = (value) => new Intl.NumberFormat("en-US").format(value);
  const papers = (count) => `${number(count)} ${count === 1 ? "paper" : "papers"}`;
  const presentationEnabled = typeof document.querySelector === "function";
  const sceneHistory = new Map();
  let finishReportMotion = () => {};
  let pageTransition;
  let pageVersion = 0;
  let pointerNavigation = false;
  let loadingTimer;
  let placeholderTimer;
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
  const motionEase = "cubic-bezier(0.22, 1, 0.36, 1)";

  // Presentation reads existing results only; it never changes report values or requests.
  function animateReport() {
    if (!presentationEnabled) return;
    finishReportMotion();
    wireChart();
    wireMap();
    const key = JSON.stringify([topic.id, topic.updated, topic.kpis, topic.years]);
    if (!sceneHistory.has(key)) sceneHistory.set(key, new Set());
    const seen = sceneHistory.get(key);
    const animations = [];
    const finalizers = [];
    const play = (node, frames, duration, extra = {}) => {
      if (!node?.animate || reducedMotion()) return;
      animations.push(node.animate(frames, { duration, easing: motionEase, ...extra }));
    };
    const countKpis = () => {
      const values = [topic.kpis.total, primaryGrowth(topic), topic.kpis.lastYear];
      $("kpis").querySelectorAll(".kpi-value").forEach((node, index) => {
        if (node.classList.contains("unavailable") || !Number.isFinite(values[index])) return;
        const final = node.textContent;
        const display = document.createElement("span");
        display.className = "count-display";
        display.setAttribute("aria-hidden", "true");
        const exact = document.createElement("span");
        exact.className = "count-exact";
        exact.textContent = final;
        node.replaceChildren(exact, display);
        let frame, started;
        const finish = () => { cancelAnimationFrame(frame); node.replaceChildren(document.createTextNode(final)); };
        finalizers.push(finish);
        const tick = (time) => {
          started ??= time;
          const progress = Math.min(1, (time - started) / 450);
          const value = values[index] * (1 - (1 - progress) ** 3);
          display.textContent = index === 1 ? percent(value) : number(Math.round(value));
          if (progress < 1 && !reducedMotion()) frame = requestAnimationFrame(tick);
          else finish();
        };
        display.textContent = index === 1 ? percent(values[index] < 0 ? -0.00001 : 0) : "0";
        frame = requestAnimationFrame(tick);
      });
    };
    const revealHeadline = () => {
      const node = $("headline");
      const text = node.textContent;
      const words = text.split(/(\s+)/);
      let wordIndex = 0;
      const groups = Math.max(1, Math.ceil(words.filter(word => word.trim()).length / 3));
      const fragment = document.createDocumentFragment();
      for (const word of words) {
        const part = document.createElement("span");
        part.textContent = word;
        if (word.trim()) {
          part.className = "headline-word";
          part.setAttribute("aria-hidden", "true");
          play(part, [{opacity:0, filter:"blur(2px)"}, {opacity:1, filter:"blur(0)"}], 180, {delay:Math.floor(wordIndex++ / 3) * Math.min(40, 300 / groups),fill:"backwards"});
        } else part.setAttribute("aria-hidden", "true");
        fragment.append(part);
      }
      const exact = document.createElement("span");
      exact.className = "sr-only";
      exact.textContent = text;
      fragment.append(exact);
      node.replaceChildren(fragment);
      finalizers.push(() => { node.textContent = text; });
    };
    const run = (tile) => {
      const id = tile.id || tile.getAttribute("aria-labelledby");
      if (seen.has(id) || reducedMotion()) return;
      seen.add(id);
      if (tile.id === "hero-tile") {
        countKpis();
        const line = $("year-chart").querySelector(".chart-line:not(.partial-year)");
        const length = line?.getTotalLength?.() || 0;
        const duration = length > 0 ? 400 : 0;
        if (length) play(line, [{strokeDasharray:length+" "+length,strokeDashoffset:length}, {strokeDasharray:length+" "+length,strokeDashoffset:0}], duration);
        $("year-chart").querySelectorAll(".chart-area, .chart-point").forEach(node => play(node,[{opacity:0},{opacity:1}],150,{delay:duration,fill:"backwards"}));
      } else if (tile.classList.contains("momentum-panel")) {
        const needle = tile.querySelector(".gauge-needle");
        if (needle) play(needle,[{transform:"rotate(180deg)"},{transform:"rotate("+needle.dataset.angle+"deg)"}],450);
        revealHeadline();
      } else {
        tile.querySelectorAll(".map-marker, .bar-fill, .rank-bar-fill, .comparison-fill, .citations").forEach((node,index) => {
          const fade = node.classList.contains("map-marker") || node.classList.contains("citations");
          play(node,fade?[{opacity:0},{opacity:1}]:[{transform:"scaleX(0)"},{transform:"scaleX(1)"}],fade?150:280,{delay:Math.min(index,5)*30,fill:"backwards"});
        });
      }
    };
    const tiles = [...$("report-content").querySelectorAll(".tile")];
    let observer;
    if (!reducedMotion() && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting && !$("topic-page").hidden) { run(entry.target); observer.unobserve(entry.target); }
      }, { threshold:0.12 });
      tiles.forEach(tile => observer.observe(tile));
    } else if (!reducedMotion() && !$("topic-page").hidden) tiles.forEach(run);
    let finished = false;
    finishReportMotion = () => { if (finished) return; finished = true; observer?.disconnect(); animations.forEach(animation=>animation.cancel()); finalizers.forEach(finish=>finish()); };
  }

  function gauge() {
    const growth = primaryGrowth(topic);
    const unavailable = topic.kpis.momentum === "Not enough data" || !Number.isFinite(growth);
    const newTopic = isNewTopic(growthWindow(topic));
    const bounds = [-1,0,.08,.2,1];
    const labels = ["Cooling","Stable","Growing","Accelerating"];
    const polar = angle => [160+126*Math.cos(angle*Math.PI/180),150+126*Math.sin(angle*Math.PI/180)];
    const arcs = labels.map((label,index)=>{
      const a=polar(180+index*45+1.5),b=polar(180+(index+1)*45-1.5);
      return '<path class="gauge-arc'+(!unavailable && topic.kpis.momentum===label?' is-active':'')+'" d="M'+a.join(',')+' A126,126 0 0 1 '+b.join(',')+'"/>';
    }).join('');
    let angle=180;
    for(let i=0;i<4;i++) if(growth>=bounds[i]) angle=180+45*i+45*Math.min(1,Math.max(0,(growth-bounds[i])/(bounds[i+1]-bounds[i])));
    const label = unavailable?"Not enough data":newTopic?"New topic":percent(growth);
    const needle = unavailable||newTopic?"":'<path class="gauge-needle" data-angle="'+angle+'" style="transform:rotate('+angle+'deg)" d="M160,150 L265,150"/><circle class="gauge-hub" cx="160" cy="150" r="5"/>';
    const ticks=bounds.map((value,index)=>{const p=polar(180+index*45);return '<text class="gauge-tick" x="'+(160+(p[0]-160)*1.15)+'" y="'+(150+(p[1]-150)*1.15)+'" text-anchor="middle">'+Math.round(value*100)+'%</text>';}).join('');
    return '<svg viewBox="0 -10 320 184" role="img" aria-label="'+escape(label+'. Nonlinear growth scale with boundaries at minus 100, zero, 8, 20 and 100 percent. Values above 100 percent reach the end of the scale.')+'">'+arcs+ticks+needle+'<text class="gauge-value" x="160" y="112" text-anchor="middle">'+escape(label)+(growth>1&&!newTopic?' beyond scale':'')+'</text></svg>';
  }

  function countryMap() {
    const data=window.REPORT_MAP;
    if (!data) return "";
    const max=Math.max(1,...topic.countries.map(item=>item.count));
    const markers=topic.countries.filter(item=>data.centers[item.code]&&item.count>0).map(item=>{
      const [lat,lon]=data.centers[item.code],x=(lon+180)*2,y=(90-lat)*2,r=14*Math.sqrt(item.count/max);
      const label=item.name+': '+papers(item.count);
      return '<g class="map-marker" tabindex="0" role="img" aria-label="'+escape(label)+'"><title>'+escape(label)+'</title><circle class="map-halo" cx="'+x+'" cy="'+y+'" r="'+r+'"/><circle class="map-count" cx="'+x+'" cy="'+y+'" r="'+r+'"/></g>';
    }).join('');
    const land=data.landDots.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="1.3"/>').join('');
    return '<svg viewBox="0 0 720 360" role="group" aria-label="Country-level paper counts. Positions are approximate; counts may overlap."><g class="map-land" aria-hidden="true">'+land+'</g>'+markers+'</svg><p class="map-readout">Hover or focus a country for its exact count.</p>';
  }

  function wireMap() {
    window.TMM_BIND_MAP_FEEDBACK($("country-map"));
  }

  function wireChart() {
    if (!presentationEnabled) return;
    const host = $("year-chart");
    const svg = host.querySelector("svg");
    if (!svg) return;
    const points = [...svg.querySelectorAll(".chart-point")];
    const guide = svg.querySelector(".chart-crosshair");
    const tooltip = host.querySelector(".chart-readout");
    let focused;
    const show = (point) => {
      if (!point) return;
      const x = point.getAttribute("cx");
      guide.setAttribute("x1", x);
      guide.setAttribute("x2", x);
      guide.style.opacity = "1";
      tooltip.textContent = point.getAttribute("aria-label");
      tooltip.hidden = false;
      const fraction = Number(x) / svg.viewBox.baseVal.width;
      const offset = fraction * host.clientWidth;
      const hero = $("hero-tile");
      const heroBox = hero.getBoundingClientRect();
      const hostBox = host.getBoundingClientRect();
      hero.style.setProperty("--data-x", hostBox.left - heroBox.left + offset + "px");
      hero.style.setProperty("--data-y", hostBox.top - heroBox.top + Number(point.getAttribute("cy")) / svg.viewBox.baseVal.height * hostBox.height + "px");
      const half = tooltip.offsetWidth / 2;
      tooltip.style.left = `${Math.max(half + 8, Math.min(host.clientWidth - half - 8, offset))}px`;
      for (const dot of points) dot.classList.toggle("is-highlighted", dot === point);
    };
    const hide = () => {
      guide.style.opacity = "0";
      tooltip.hidden = true;
      points.forEach((dot) => dot.classList.remove("is-highlighted"));
    };
    host.onpointermove = (event) => {
      const box = svg.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width * svg.viewBox.baseVal.width;
      show(points.reduce((nearest, point) => !nearest || Math.abs(Number(point.getAttribute("cx")) - x) < Math.abs(Number(nearest.getAttribute("cx")) - x) ? point : nearest, null));
    };
    host.onpointerleave = () => focused ? show(focused) : hide();
    points.forEach((point, index) => {
      point.addEventListener("focus", () => { focused = point; show(point); });
      point.addEventListener("blur", () => { focused = null; hide(); });
      point.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { hide(); return; }
        const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : null;
        if (next !== null) { event.preventDefault(); points[Math.max(0, Math.min(points.length - 1, next))].focus(); }
      });
    });
    const last = points.at(-1);
    if (last) { show(last.classList.contains("partial-point") && points.length > 1 ? points.at(-2) : last); hide(); }
  }

  function showPresentationPage(isLibrary) {
    const version = ++pageVersion;
    pageTransition?.skipTransition();
    const update = () => {
      if (version !== pageVersion) return;
      $("library-page").hidden = !isLibrary;
      $("topic-page").hidden = isLibrary;
      if (presentationEnabled) {
        if (isLibrary) finishReportMotion();
        else animateReport();
        updateLibraryTabs(false);
      }
    };
    if (!presentationEnabled || reducedMotion() || !pointerNavigation || $("library-page").hidden === !isLibrary) { update(); return; }
    finishReportMotion();
    const page = $(isLibrary ? "library-page" : "topic-page");
    if (document.startViewTransition) {
      pageTransition = document.startViewTransition(update);
      pageTransition.finished.catch(() => {});
    } else {
      update();
      page.animate?.([{ opacity: 0, transform: `translateX(${isLibrary ? 8 : -8}px)` }, { opacity: 1, transform: "translateX(0)" }], { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
    pointerNavigation = false;
  }

  function setPresentationLoading(loading) {
    if (!presentationEnabled) return;
    const stage = $("report-stage");
    stage.classList.toggle("is-revealed", !loading);
    stage.querySelector(".t-skel-content").inert = loading;
    stage.setAttribute("aria-busy", String(loading));
    clearInterval(loadingTimer);
    const steps = [...$("loading-steps").children];
    steps.forEach((node, index) => node.classList.toggle("is-current", index === 0));
    if (loading) {
      finishReportMotion();
      let index = 0;
      if (!reducedMotion()) loadingTimer = setInterval(() => {
        index = (index + 1) % steps.length;
        steps.forEach((node, i) => node.classList.toggle("is-current", i === index));
      }, 1500);
    }
  }

  function updateLibraryTabs(animate = true) {
    if (!presentationEnabled) return;
    const tab = $(libraryTab === "my" ? "my-library-tab" : "all-topics-tab");
    const pill = document.querySelector(".t-tabs-pill");
    if (!pill || !tab.offsetWidth) return;
    pill.style.transition = animate && !reducedMotion() ? "" : "none";
    pill.style.width = tab.offsetWidth + "px";
    pill.style.transform = "translateX(" + tab.offsetLeft + "px)";
    if (!animate) { void pill.offsetWidth; pill.style.transition = ""; }
  }

  function setupPresentation() {
    const input = $("topic-input");
    const examples = ["epigenetics", "neurotechnology", "agentic AI", "early childhood development", "quantum sensing"];
    let exampleIndex = 0;
    input.placeholder = examples[0];
    const cycle = () => {
      clearInterval(placeholderTimer);
      if (reducedMotion()) return;
      placeholderTimer = setInterval(() => {
        if (input.value || document.activeElement === input || document.hidden) return;
        input.placeholder = examples[++exampleIndex % examples.length];
        input.animate?.([{ opacity: .6 }, { opacity: 1 }], { duration: 150, easing: motionEase });
      }, 3500);
    };
    cycle();
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
      cycle();
      if (reducedMotion()) {
        finishReportMotion();
        pageTransition?.skipTransition();
        clearInterval(loadingTimer);
        document.querySelectorAll(".tile").forEach(tile => tile.classList.remove("is-lit"));
        document.getAnimations().forEach(animation => animation.cancel());
      }
    });
    let lightFrame, lightTarget, litTile;
    document.addEventListener("pointermove", event => {
      if (reducedMotion() || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      lightTarget = { tile:event.target.closest(".tile"), x:event.clientX, y:event.clientY };
      if (lightFrame) return;
      lightFrame = requestAnimationFrame(() => {
        lightFrame = null;
        if (reducedMotion()) return;
        const {tile,x,y} = lightTarget;
        if (litTile !== tile) litTile?.classList.remove("is-lit");
        litTile = tile;
        if (!tile) return;
        const box = tile.getBoundingClientRect();
        tile.classList.add("is-lit");
        tile.style.setProperty("--light-x", (x - box.left) + "px");
        tile.style.setProperty("--light-y", (y - box.top) + "px");
      });
    }, { passive: true });
    document.addEventListener("pointerleave", () => { cancelAnimationFrame(lightFrame); lightFrame = null; litTile?.classList.remove("is-lit"); litTile = null; });
  }

  function vanishQuery() {
    if (!presentationEnabled || !pointerNavigation || reducedMotion()) return;
    const input = $("topic-input");
    const echo = document.createElement("span");
    echo.className = "query-echo";
    echo.setAttribute("aria-hidden", "true");
    echo.textContent = input.value;
    input.parentElement.append(echo);
    input.classList.add("is-vanishing");
    const animation = echo.animate([{opacity:1,filter:"blur(0)",transform:"translateX(0)"},{opacity:0,filter:"blur(2px)",transform:"translateX(8px)"}], {duration:180,easing:motionEase});
    animation.finished.catch(() => {}).finally(() => { echo.remove(); input.classList.remove("is-vanishing"); });
  }

  function rankBar(count, items) {
    const max = Math.max(1, ...items.map(item => item.count));
    return `<span class="rank-bar" aria-hidden="true"><i class="rank-bar-fill" style="width:${count / max * 100}%"></i></span>`;
  }
  const percent = (value) => value === null ? "New" : `${value < 0 ? "−" : "+"}${Math.abs(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 0 : 1)}%`;
  const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);
  const dateText = (value) => {
    const date = new Date(value + "T00:00:00Z");
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", {day:"numeric", month:"short", year:"numeric", timeZone:"UTC"}).format(date);
  };
  const connectionError = () => new URL(window.WORKER_URL).hostname === "127.0.0.1" ? "Can’t reach the data service. Start the Worker and try again." : "Can’t reach the data service. Check your connection and try again.";
  const displayText = (value) => String(value).replaceAll(" · ", ", ").replaceAll(" ↗", "");
  const growthClass = (value) => value === null ? "" : value < 0 ? "negative" : "positive";
  const help = (id, label, text) => `<span class="help"><button type="button" class="help-trigger" data-help="${id}" aria-label="About ${escape(label)}" aria-controls="${id}" aria-describedby="${id}" aria-expanded="false">?</button><span id="${id}" class="tooltip" role="tooltip" hidden>${escape(text)}</span></span>`;
  let expertsExpanded = false;
  let countriesExpanded = false;
  let journalsExpanded = false;
  let papersExpanded = false;
  let renderedReportId;
  let includeSlots = 1;
  const includeInputIds = ["include-input", "include-input-2", "include-input-3"];
  const cleanSearchTerm = value => String(value).toLowerCase().replace(/[,|[\]{}()"'“”‘’:\\\x00-\x1f\x7f]/g, "").trim().replace(/\s+/g, " ");
  function groupsOf(source) {
    if (Array.isArray(source)) return source.length ? Array.isArray(source[0]) ? source : [source] : [];
    const groups = source.includeGroups || source.searchTerms?.includeGroups;
    if (groups) return groups;
    const terms = source.includeTerms || source.searchTerms?.includeTerms || [];
    return terms.length ? [terms] : [];
  }
  const includeFields = groups => groups.length > 1 ? { includeGroups: groups } : groups.length ? { includeTerms: groups[0] } : {};
  function normaliseGroups(value) {
    const seen = new Set();
    return groupsOf(value).map(group => [...new Set(group.map(cleanSearchTerm).filter(Boolean))].sort()).filter(group => {
      const key = JSON.stringify(group);
      if (!group.length || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const readIncludeGroups = () => includeInputIds.slice(0, includeSlots).map(id => $(id).value.split(","));
  function groupPreset(terms) {
    const key = JSON.stringify([...terms].sort());
    return Object.values(window.TMM_SEARCH_PRESETS).find(preset => JSON.stringify([...preset.terms].sort()) === key);
  }
  function syncIncludeControls() {
    includeInputIds.forEach((id, index) => {
      if (index) $("include-group-" + (index + 1)).hidden = index >= includeSlots;
      $(id).disabled = busy || index >= includeSlots;
      $("remove-include-" + (index + 1)).disabled = busy;
    });
    $("add-include-group").disabled = busy || includeSlots === 3;
    $("include-limit").hidden = includeSlots < 3;
  }
  function setIncludeGroups(groups) {
    includeSlots = Math.max(1, groups.length);
    includeInputIds.forEach((id, index) => { $(id).value = (groups[index] || []).map(term => term.trim()).join(", "); });
    syncIncludeControls();
    clearIncludeError();
  }
  function clearIncludeError() {
    const previous = $("include-error").textContent;
    $("include-error").textContent = "";
    $("include-error").hidden = true;
    if (previous && $("status").textContent === previous) $("status").hidden = true;
  }
  function addIncludePreset(id) {
    const preset = window.TMM_SEARCH_PRESETS[id];
    const existing = includeInputIds.slice(0, includeSlots).find(input => groupPreset(normaliseGroups([$(input).value.split(",")])[0] || []) === preset);
    if (existing) { $(existing).focus(); return; }
    let index = includeInputIds.slice(0, includeSlots).findIndex(input => !$(input).value.trim());
    if (index < 0) {
      if (includeSlots === 3) { notify("You can use up to three include groups. Remove a group to add another.", true); return; }
      index = includeSlots++;
    }
    $(includeInputIds[index]).value = preset.terms.join(", ");
    syncIncludeControls();
    syncOptions();
    $(includeInputIds[index]).focus();
    checkIncludeLimits($("topic-input").value, synonyms(), readIncludeGroups(), $("from-input").value, $("to-input").value);
  }
  function checkIncludeLimits(name, terms, include, from, to, selection) {
    const raw = groupsOf(include);
    clearIncludeError();
    let message;
    if (raw.length > 3) message = "You can use up to three include groups. Remove a group to add another.";
    else if (raw.reduce((sum, group) => sum + group.join(",").length, 0) > 1200) message = "The additional terms are too long. Use fewer than 1,200 characters and try again.";
    else {
      const groups = normaliseGroups(include);
      const cleanedName = cleanSearchTerm(name);
      const cleanedTerms = [...new Set(terms.map(cleanSearchTerm).filter(term => term && term !== cleanedName))].sort();
      const includeId = groups.length > 1 ? ["includeGroups:" + JSON.stringify(groups)] : groups.length ? ["include:" + JSON.stringify(groups[0])] : [];
      const rangeId = to != null && to !== "" ? ["range:" + from + "-" + to] : Number(from) !== 2010 ? ["since:" + from] : [];
      const id = [cleanedName, ...cleanedTerms, ...includeId, ...rangeId, ...(selection ? ["primary_topic:" + selection.id] : [])].join("|");
      if (new TextEncoder().encode("v3:topic:" + id).length > 512) message = "This search has too many terms. Remove some synonyms or additional terms and try again.";
    }
    $("include-error").textContent = message || "";
    $("include-error").hidden = !message;
    if (message) { $("search-options").open = true; notify(message, true); return false; }
    return true;
  }
  function syncOptions(reset = false) {
    const active = $("synonyms-input").value.trim() || readIncludeGroups().some(group => group.join(",").trim()) || $("from-input").value !== "2010" || $("to-input").value;
    if (reset || active) $("search-options").open = Boolean(active);
  }
  function renderSaveState() {
    const saved = !isSample && myLibrary.some((entry) => entry.id === topic.id);
    $("save-report").textContent = saved ? "Saved" : "Save to My library";
    $("save-report").disabled = isSample || busy;
    $("save-report").setAttribute("aria-pressed", String(saved));
  }
  let selectedField = "All fields";
  let noticeTimer;
  const childrenPreset = window.TMM_SEARCH_PRESETS.children.terms.join(", ");
  function includeSuffix(terms) {
    return groupsOf(terms).map(group => " + " + (groupPreset(group)?.label || group.join(" / "))).join("");
  }
  const reportRange = (report) => ({ from: report.from ?? report.period ?? 2010, to: report.to ?? null });
  const rangeLabel = (range, capital = false) => range.to != null ? `${range.from}–${range.to}` : `${capital ? "Since" : "since"} ${range.from}`;
  const primaryGrowth = (report) => Object.hasOwn(report.kpis, "growth") ? report.kpis.growth : report.kpis.growth5y;
  function baseTitle(report) {
    const periodSuffix = report.from !== undefined || report.period ? ` · ${rangeLabel(reportRange(report))}` : "";
    if (periodSuffix && report.name.endsWith(periodSuffix)) report = { ...report, name: report.name.slice(0, -periodSuffix.length) };
    if (!report.subtopicId) return report.searchTerms?.name || report.name;
    const terms = groupsOf(report);
    const suffix = terms.length && [includeSuffix(terms), ` + (${(terms[0] || []).join(" OR ")})`].find((item) => report.name.endsWith(item));
    return suffix ? report.name.slice(0, -suffix.length) : report.name;
  }
  const periodPhrase = (range) => range.to == null ? `since ${range.from}` : `between ${range.from} and ${range.to}`;
  function growthStartCount(report) { return growthWindow(report).growthStartCount; }
  function growthWindow(report) {
    const range = Array.isArray(report.years) ? reportRange(report) : entryRange(report);
    const year = Number(report.updated.slice(0, 4));
    const end = Math.min(range.to ?? year - 1, year - 1);
    const label = report.kpis?.growthLabel ?? report.growthLabel;
    const useRange = label && label !== "5-year growth" && end - range.from + 1 >= 3;
    const growthStartYear = useRange ? range.from : end - 5;
    const growthEndYear = end;
    const countFor = (target) => {
      if (Array.isArray(report.years)) return report.years.find((item) => item.year === target)?.count;
      if ((target === growthStartYear && report.growthStartYear === target) || (report.growthStartYear == null && range.to == null && target === growthStartYear)) return report.growthStartCount ?? report.spark?.[target - (report.sparkStartYear ?? year - 10)];
      if (target === growthEndYear && report.growthEndYear === target) return report.growthEndCount;
      return report.spark?.[target - (report.sparkStartYear ?? year - 10)];
    };
    return {growthStartYear, growthEndYear, growthStartCount:countFor(growthStartYear), growthEndCount:countFor(growthEndYear)};
  }
  function repairBoundedGrowth(report) {
    if (report.to == null || !report.kpis || !Array.isArray(report.years)) return report;
    const range = reportRange(report), year = Number(report.updated.slice(0,4));
    const end = Math.min(range.to, year - 1);
    const first = report.years.find((item) => item.year === end - 5)?.count;
    const last = report.years.find((item) => item.year === end)?.count;
    const available = Number.isFinite(first) && Number.isFinite(last);
    const growth5y = available && first > 0 ? (last / first) ** .2 - 1 : null;
    const {growthNeedsRebuild, ...saved} = report;
    const fallback = end - range.from + 1 < 3;
    const momentum = growth5y === null ? "Not enough data" : growth5y >= .2 ? "Accelerating" : growth5y >= .08 ? "Growing" : growth5y >= 0 ? "Stable" : "Cooling";
    return {...saved, kpis:{...report.kpis,growth5y,...(fallback ? {growth:growth5y,growthLabel:"5-year growth",momentum} : {})}, ...(!available && fallback ? {growthNeedsRebuild:true} : {})};
  }
  function repairBoundedSummary(entry) {
    const range = entryRange(entry), end = Math.min(range.to ?? Infinity, Number(entry.updated.slice(0,4)) - 1);
    if (range.to == null || end - range.from + 1 >= 3) return entry;
    const window = growthWindow(entry);
    const available = Number.isFinite(window.growthStartCount) && Number.isFinite(window.growthEndCount);
    const growth = available && window.growthStartCount > 0 ? (window.growthEndCount / window.growthStartCount) ** .2 - 1 : null;
    const momentum = growth === null ? "Not enough data" : growth >= .2 ? "Accelerating" : growth >= .08 ? "Growing" : growth >= 0 ? "Stable" : "Cooling";
    return {...entry,...window,growth,momentum,growthLabel:"5-year growth"};
  }
  const isNewTopic = (window) => Number.isFinite(window.growthStartCount) && (window.growthStartCount < 20 || window.growthStartCount < .02 * window.growthEndCount);
  function normalJournalName(name) {
    if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
    const keep = new Set(["IEEE", "ACM", "DNA", "RNA", "AI", "BMJ", "JAMA", "PNAS", "PLOS", "ACS", "IET"]);
    const minor = new Set(["a", "an", "the", "and", "or", "but", "of", "in", "on", "for", "to", "at", "by", "with"]);
    const words = name.toLowerCase().split(/(\s+)/);
    return words.map((word, i) => keep.has(word.toUpperCase()) ? word.toUpperCase() : i > 0 && i < words.length - 1 && minor.has(word) ? word : word.replace(/(^|[-/])\p{L}/gu, (c) => c.toUpperCase())).join("");
  }
  function headlineTopicName(value) {
    const proper = new Map(["Alzheimer", "Parkinson", "Huntington", "Bayesian", "Fourier", "Gaussian", "Darwin", "Einstein", "Newton", "Japan", "China", "Europe", "European", "Africa", "African", "Asia", "Asian", "Arab", "Emirates", "Dubai", "Abu", "Dhabi"].map((word) => [word.toLowerCase(), word]));
    return String(value).replace(/[A-Za-z]+(?:[’'][A-Za-z]+)?/g, (word) => {
      const stem = word.replace(/[’']s$/i, "");
      if (proper.has(stem.toLowerCase())) return proper.get(stem.toLowerCase()) + word.slice(stem.length);
      return /^[A-Z]{2,6}$/.test(word) || /[a-z][A-Z]/.test(word) ? word : word.toLowerCase();
    });
  }
  function headlineSubject(report, terms) {
    const base = report.subtopicId ? baseTitle(report) : report.headlineName || report.searchTerms?.name || baseTitle(report);
    const groups = groupsOf(terms);
    if (groups.length > 1) return headlineTopicName(base) + " matching " + groups.map(group => groupPreset(group)?.subject || "one of " + group.map(headlineTopicName).join(" or ")).join(" and ");
    terms = groups[0] || [];
    const preset = JSON.stringify([...terms].sort()) === JSON.stringify(childrenPreset.split(", ").sort());
    return headlineTopicName(base) + (!terms.length ? "" : preset ? " in children" : " mentioning " + terms.map(headlineTopicName).join(" or "));
  }
  function queryOperatorCount(name, synonyms, include) {
    const clean = (value) => String(value).toLowerCase().replace(/[,|[\]{}()"'“”‘’:\\\x00-\x1f\x7f]/g, "").trim().replace(/\s+/g, " ");
    const topic = clean(name);
    return new Set(synonyms.map(clean).filter((term) => term && term !== topic)).size + normaliseGroups(include).reduce((sum, group) => sum + group.length, 0);
  }
  function presentReport(report) {
    report = repairBoundedGrowth(report);
    const terms = groupsOf(report);
    const name = terms.length || report.period || report.from !== undefined ? baseTitle(report) + includeSuffix(terms) + (report.period || report.from !== undefined ? ` · ${rangeLabel(reportRange(report))}` : "") : report.name;
    let sentence = report.headline?.replace(report.name, name);
    if (report.kpis && report.from !== undefined && Array.isArray(report.years)) {
      const range = reportRange(report), window = growthWindow(report);
      const topicName = headlineSubject(report, terms);
      const prefix = range.to == null ? `Since ${range.from}, ` : `From ${range.from} to ${range.to}, `;
      const lastYear = Math.max(range.from, Math.min(range.to ?? Number(report.updated.slice(0,4)) - 1, Number(report.updated.slice(0,4)) - 1));
      const published = `In ${lastYear}, ${papers(report.kpis.lastYear)} ${report.kpis.lastYear === 1 ? "was" : "were"} published.`;
      const regional = report.regionalCounts && report.kpis.total > 0 && report.regionalCounts.gcc / report.kpis.total < .05 ? ` Only ${papers(report.regionalCounts.gcc)} published ${periodPhrase(range)} ${range.to != null ? "came" : report.regionalCounts.gcc === 1 ? "comes" : "come"} from the GCC${report.regionalCounts.uae === 0 ? ", none from the UAE." : ` (${number(report.regionalCounts.uae)} from the UAE).`}` : "";
      const growth = primaryGrowth(report);
      if (isNewTopic(window) && Number.isFinite(window.growthEndCount)) sentence = `Research on ${topicName} is a new topic: from ${papers(window.growthStartCount)} in ${window.growthStartYear} to ${number(window.growthEndCount)} in ${window.growthEndYear}.${regional}`;
      else if (growth === null) sentence = `${prefix}there is not enough data to calculate annual growth for ${topicName}. ${published}${regional}`;
      else sentence = `${prefix}research on ${topicName} ${range.to == null ? "has been" : "was"} ${report.kpis.momentum.toLowerCase()} (${percent(growth)} a year${report.kpis.growthLabel === "5-year growth" ? " over " + window.growthStartYear + "–" + window.growthEndYear : ""}). ${published}${regional}`;
    } else if (sentence) {
      const subject = headlineSubject(report, terms);
      sentence = sentence.replace(/^Research on .+?(?= (?:is|has been|was) )/, "Research on " + subject)
        .replace(/^.+? is a new (?:research )?topic:/, "Research on " + subject + " is a new topic:");
      if (report.regionalCounts?.uae === 0) sentence = sentence.replace("from the GCC (0 from the UAE).", "from the GCC, none from the UAE.");
      sentence = sentence.replace(/([+−-]?)(\d+(?:\.\d+)?)%/g, (_, sign, value) => percent((sign === "-" || sign === "−" ? -1 : 1) * Number(value) / 100));
    }
    return { ...report, name, ...(sentence ? { headline: sentence } : {}), ...(report.journals ? { journals: report.journals.map((item) => ({...item, name: normalJournalName(item.name)})) } : {}), ...(report.papers ? { papers: report.papers.map((item) => ({...item, journal: normalJournalName(item.journal)})) } : {}) };
  }

  function notify(message, persistent = false) {
    clearTimeout(noticeTimer);
    $("status").textContent = message;
    $("status").hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => { $("status").hidden = true; }, 8000);
  }

  function chart(years) {
    if (!years.length) return "";
    const width = Math.min(1060, Math.max(280, (presentationEnabled && $("year-chart").clientWidth) || (window.innerWidth || 1156) - 96)), height = 260, left = 54, right = 18, top = 22, bottom = 34;
    const baseline = height - bottom;
    const max = Math.max(1, ...years.map((item) => item.count));
    const roughStep = max / 3;
    const unit = 10 ** Math.floor(Math.log10(roughStep));
    const fraction = roughStep / unit;
    const tickSize = Math.max(1, (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * unit);
    const ceiling = Math.ceil(max / tickSize) * tickSize;
    const ticks = Math.round(ceiling / tickSize);
    const x = (i) => years.length === 1 ? (width + left - right) / 2 : left + i * (width - left - right) / (years.length - 1);
    const y = (count) => baseline - count / ceiling * (baseline - top);
    const points = years.map((item, i) => ({ ...item, x: x(i), y: y(item.count) }));
    const partial = points.at(-1).year === new Date().getFullYear() ? points.at(-1) : null;
    const complete = partial ? points.slice(0, -1) : points;
    const path = (items) => items.map((point, i) => `${i ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const grid = Array.from({ length: ticks + 1 }, (_, i) => {
      const value = tickSize * i;
      const position = y(value);
      return `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${position}" y2="${position}"/><text class="chart-label" x="${left - 12}" y="${position + 4}" text-anchor="end">${number(Math.round(value))}</text>`;
    }).join("");
    const labels = [...new Set([0, Math.floor((years.length - 1) / 2), years.length - 1])].map((i) => `<text class="chart-label" x="${x(i)}" y="${height - 8}" text-anchor="middle">${years[i].year}</text>`).join("");
    const area = complete.length > 1 ? `<path class="chart-area" d="${path(complete)} L${complete.at(-1).x},${baseline} L${complete[0].x},${baseline} Z"/>` : "";
    const dashed = partial && complete.length ? `<path class="chart-line partial-year" d="${path([complete.at(-1), partial])}"/>` : "";
    const dots = points.map((point) => {
      const label = `${point.year}: ${papers(point.count)}${point === partial ? " (year to date)" : ""}`;
      return `<circle class="chart-point${point === partial ? " partial-point" : ""}" cx="${point.x}" cy="${point.y}" r="3" tabindex="0" aria-label="${escape(label)}"><title>${escape(label)}</title></circle>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Papers published each year. The current year isn’t over, so its line is dashed. Focus a point and use the arrow keys to compare years.">${grid}${area}<path class="chart-line" d="${path(complete)}"/>${dashed}<line class="chart-crosshair" x1="0" x2="0" y1="${top}" y2="${baseline}" aria-hidden="true"/>${dots}${labels}</svg><div class="chart-readout" aria-hidden="true" hidden></div>`;
  }

  function renderRankings() {
    $("experts").innerHTML = topic.experts.slice(0, expertsExpanded ? undefined : 5).map((item) => `<li><span class="rank-name">${item.openalexUrl ? `<a href="${escape(item.openalexUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.name)}</a>` : escape(item.name)}</span><span class="number">${number(item.count)}</span>${rankBar(item.count, topic.experts)}</li>`).join("");
    $("experts-toggle").hidden = topic.experts.length <= 5;
    $("experts-toggle").textContent = expertsExpanded ? "Show less" : "Show all";
    $("experts-toggle").setAttribute("aria-expanded", String(expertsExpanded));
    const maxCountry = Math.max(1, ...topic.countries.map((item) => item.count));
    $("countries").innerHTML = topic.countries.slice(0, countriesExpanded ? undefined : 5).map((item) => `<div class="country-row"><div class="row-heading"><span>${escape(item.name)}${item.gcc ? '<abbr class="gcc" title="Gulf Cooperation Council">GCC</abbr>' : ""}</span><span class="number">${number(item.count)}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${item.count / maxCountry * 100}%"></div></div></div>`).join("");
    $("countries-toggle").hidden = topic.countries.length <= 5;
    $("countries-toggle").textContent = countriesExpanded ? "Show less" : "Show all";
    $("countries-toggle").setAttribute("aria-expanded", String(countriesExpanded));
    $("journals").innerHTML = topic.journals.slice(0, journalsExpanded ? undefined : 5).map((item) => `<li><span class="rank-name">${escape(item.name)}</span><span class="number">${number(item.count)}</span>${rankBar(item.count, topic.journals)}</li>`).join("");
    $("papers").innerHTML = topic.papers.slice(0, papersExpanded ? undefined : 5).map((item) => `<article class="paper"><div class="paper-heading"><h3>${item.url ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>` : escape(item.title)}</h3><span class="number citations">${number(item.citations)} ${item.citations === 1 ? "citation" : "citations"}</span></div><p class="paper-meta">${escape(item.authors)}, ${escape(item.journal)}, ${item.year}</p></article>`).join("");
    for (const [id, items, expanded] of [["journals-toggle", topic.journals, journalsExpanded], ["papers-toggle", topic.papers, papersExpanded]]) {
      $(id).hidden = items.length <= 5;
      $(id).textContent = expanded ? "Show less" : "Show all";
      $(id).setAttribute("aria-expanded", String(expanded));
    }
  }

  function parentDisplayName() {
    const canonical = topic.searchTerms?.name || topic.parentName || topic.name;
    const supplied = topic.subtopicId ? topic.parentName : topic.headlineName;
    return supplied && supplied.trim().toLowerCase() === canonical.trim().toLowerCase() ? supplied : canonical;
  }

  function renderTopic() {
    if (presentationEnabled) finishReportMotion();
    closeHelp();
    $("report-source").textContent = isSample ? "Sample data" : "";
    $("data-notice").textContent = isSample ? "Fictional research and illustrative numbers." : "Data from OpenAlex. Searches are cached anonymously to keep the tool free.";
    $("report-freshness").textContent = isSample ? "" : `${topic.stale ? "Saved on " + dateText(topic.updated) + ", may be out of date." : "Updated " + dateText(topic.updated) + "."}${topic.subtopicId ? " Part of " + (topic.searchTerms?.name || topic.parentName || topic.name) + "." : ""}`;
    $("topic-input").value = topic.searchTerms?.name || topic.name;
    $("synonyms-input").value = isSample ? "" : (topic.searchTerms?.synonyms || topic.synonyms).join(", ");
    $("from-input").value = String(reportRange(topic).from);
    $("to-input").value = reportRange(topic).to === null ? "" : String(reportRange(topic).to);
    setIncludeGroups(groupsOf(topic));
    syncOptions(true);
    renderSynonyms();
    const include = groupsOf(topic);
    const titleSuffix = topic.from !== undefined || topic.period ? " · " + rangeLabel(reportRange(topic)) : "";
    $("topic-name").textContent = titleCase(titleSuffix && topic.name.endsWith(titleSuffix) ? topic.name.slice(0, -titleSuffix.length) : topic.name);
    const range = reportRange(topic);
    const rangeText = rangeLabel(range, true);
    $("topic-meta").textContent = `${topic.field}, ${rangeText.toLowerCase()}`;
    const parentName = parentDisplayName();
    $("back-parent").hidden = !topic.subtopicId && !include.length;
    $("back-parent").textContent = `Back to ${titleCase(parentName)}`;
    $("back-parent").href = reportHash({ ...topic, name: parentName, subtopicId: null,
      ...(!topic.subtopicId ? { includeTerms: [], includeGroups: undefined, searchTerms: { name: parentName, synonyms: topic.synonyms } } : {}) }, cacheOnlyView);
    if (renderedReportId !== topic.id) { expertsExpanded = false; countriesExpanded = false; journalsExpanded = false; papersExpanded = false; renderedReportId = topic.id; }
    renderSaveState();
    const period = periodPhrase(range);
    const expertsPeriod = range.from < 2020 && range.to === null ? "since 2020" : period;
    $("experts-heading").textContent = "Leading experts";
    $("experts-note").textContent = `Authors with the most papers on this topic ${expertsPeriod}. A starting point for speakers, not a ranking of quality.`;
    $("countries-note").textContent = "Where the authors work. A paper with authors in two countries counts for both.";
    for (const list of ["experts", "journals"]) {
      const all = topic.sourceQuality?.[list] !== "core";
      $(list + "-source-note").hidden = isSample || !all;
      $(list + "-source-note").textContent = "Includes non-core sources";
    }
    if (topic.sourceQuality?.experts === "core") $("experts-note").textContent += " Only papers in journals on the Leiden Ranking core list are counted.";
    $("journals-note").textContent = topic.sourceQuality?.journals === "core" ? "Journals that published the most papers on this topic. Only journals on the Leiden Ranking core list are counted." : "Journals that published the most papers on this topic. Preprint servers are excluded.";
    const citedPeriod = topic.from === undefined && !topic.period ? "since 2022" : period;
    $("papers-period").textContent = `The papers other researchers cite most, published ${citedPeriod}.`;
    const countsOnly = topic.subtopicWindow?.countsOnly ?? (topic.period === 2025);
    const subtopics = topic.subtopics.filter((item) => Number.isFinite(item.late) && (Number.isFinite(item.growth) || item.growth === null));
    // Older reports encode a zero earlier half as null growth.
    const earlierCount = (item) => item.early ?? (item.growth === null ? 0 : Number.isFinite(item.growth) && item.growth > -1 ? Math.round(item.late / (1 + item.growth)) : undefined);
    const showsCounts = (item) => !countsOnly && Number.isFinite(earlierCount(item)) && earlierCount(item) >= 0 && (earlierCount(item) < 20 || item.growth > 3);

    $("subtopics-heading").textContent = "Sub-topics";
    $("subtopics-metric").textContent = "Growth";
    $("subtopics-note").textContent = countsOnly ? "Research areas inside this topic, ranked by number of papers. Click a row to open it." : "Research areas inside this topic. Growth compares the second half of the period with the first. Click a row to open it.";
    if (subtopics.some(showsCounts)) $("subtopics-note").textContent += " Rows with an arrow had fewer than 20 papers in the earlier half or growth above 300%, so we show the earlier and later counts instead of a growth percentage.";
    const empty = topic.kpis.total === 0;
    if (presentationEnabled) {
      const heading = document.querySelector(".report-heading");
      if (empty) $("report-content").before(heading);
      else $("hero-tile").prepend(heading);
    }
    $("no-results").hidden = !empty;
    $("report-content").hidden = empty;
    $("export-csv").disabled = empty || busy;
    if (empty) return;
    const lastYear = Math.max(range.from, Math.min(range.to ?? Number(topic.updated.slice(0, 4)) - 1, Number(topic.updated.slice(0, 4)) - 1));
    const growth = primaryGrowth(topic);
    const window = growthWindow(topic);
    const newTopic = isNewTopic(window);
    const cards = [
      ["Papers", number(topic.kpis.total), `Papers on this topic ${period}.`, ""],
      ["Growth", newTopic ? "New topic" : growth === null ? "Not enough data" : percent(growth), `Average yearly increase in papers ${period}. With fewer than three full years, we use the last five complete years instead.`, newTopic ? "" : growthClass(growth)],
      [`Papers in ${lastYear}`, number(topic.kpis.lastYear), lastYear === Number(topic.updated.slice(0, 4)) ? "Papers published this year to date." : "Papers published in the last complete year.", ""]
    ];
    $("kpis").innerHTML = cards.map(([label, value, note, tone], i) => `<div class="kpi"><div class="kpi-label">${label}${help("kpi-help-" + i, label, note)}</div><p class="kpi-value ${tone}${i === 1 && (growth === null || newTopic) ? " unavailable" : ""}">${value}${i === 1 && newTopic ? help("new-topic-help", "New topic", "This topic started from very few papers, so a yearly percentage would be misleading. We show the real counts instead.") : ""}</p>${i === 1 && newTopic ? `<p class="growth-counts">${number(window.growthStartCount)} ${window.growthStartCount === 1 ? "paper" : "papers"} in ${window.growthStartYear} → ${number(window.growthEndCount)} in ${window.growthEndYear}</p>` : ""}</div>`).join("");
    $("year-chart").innerHTML = chart(topic.years.filter((item) => item.year >= range.from && (range.to === null || item.year <= range.to)));
    $("momentum-segments").innerHTML = ["Accelerating", "Growing", "Stable", "Cooling"].map((label) => `<span aria-current="${topic.kpis.momentum === label}">${label}<i class="momentum-fill" aria-hidden="true"></i></span>`).join("");
    $("momentum-unavailable").hidden = topic.kpis.momentum !== "Not enough data";
    $("momentum-gauge").innerHTML = gauge();
    $("country-map").innerHTML = countryMap();
    $("headline").textContent = displayText(topic.headline);
    renderRankings();
    $("regional-counts").textContent = topic.regionalCounts ? `UAE: ${papers(topic.regionalCounts.uae)}. GCC: ${papers(topic.regionalCounts.gcc)}.` : "UAE and GCC totals are unavailable in this sample.";
    const row = (item, action = "") => {
      const count = Number.isFinite(item.late) ? number(item.late) : "";
      const early = earlierCount(item);
      const rate = countsOnly ? "" : showsCounts(item) ? `${number(early)} → ${number(item.late)}` : Number.isFinite(item.growth) ? percent(item.growth) : "";
      const comparison = !countsOnly && Number.isFinite(item.early) && item.early >= 0 && Math.max(item.early, item.late) > 0 ? `<span class="comparison-bars" aria-hidden="true"><i class="comparison-fill earlier" style="width:${item.early / Math.max(item.early, item.late) * 100}%"></i><i class="comparison-fill later" style="width:${item.late / Math.max(item.early, item.late) * 100}%"></i></span>` : "";
      const content = `<span class="topic-name">${escape(item.name)}${comparison}</span><span class="number" aria-label="${count ? "Paper count: " + count : "Paper count unavailable"}">${count}</span><span class="number ${showsCounts(item) ? "count-change" : countsOnly ? "" : growthClass(item.growth ?? null)}" aria-label="${showsCounts(item) ? `Earlier half: ${papers(early)}. Later half: ${papers(item.late)}.` : rate ? "Growth: " + rate : "Growth unavailable"}">${rate}</span>`;
      return action ? `<button type="button" class="topic-row" ${action}>${content}</button>` : `<div class="topic-row">${content}</div>`;
    };
    $("subtopics-panel").hidden = Boolean(topic.subtopicId);
    $("subtopics").innerHTML = subtopics.map((item) => row(item, item.id ? `data-subtopic="${escape(item.id)}" data-title="${escape(item.name)}"` : `data-next-term="${escape(item.name)}"`)).join("");
    const normalise = (value) => value.toLowerCase().trim().replace(/\s+/g, " ");
    const excluded = [topic.searchTerms?.name || topic.name, ...topic.synonyms, ...include.flat()].map(normalise);
    const suggestions = topic.suggestedSynonyms.filter((term) => !excluded.some((value) => ` ${value} `.includes(` ${normalise(term)} `)));
    $("suggested-synonyms").innerHTML = suggestions.map((term) => `<button class="chip" type="button" data-suggest="${escape(term)}">${escape(term)}</button>`).join("");
    $("suggestions").hidden = !suggestions.length;
    $("topics-section").hidden = Boolean(topic.subtopicId) || !topic.subtopics.some((item) => Number.isFinite(item.late) && (Number.isFinite(item.growth) || item.growth === null));
    animateReport();
  }

  function synonyms() {
    return [...new Set($("synonyms-input").value.split(",").map((term) => term.trim()).filter(Boolean))];
  }

  function renderSynonyms() {
    $("synonym-chips").innerHTML = synonyms().map((term) => `<button class="chip" type="button" data-remove="${escape(term)}" aria-label="Remove synonym ${escape(term)}">${escape(term)} ×</button>`).join("");
  }

  function entryRange(entry) {
    const bounded = entry.id.match(/\|range:(\d{4})-(\d{4})/);
    return { from: entry.from ?? (bounded ? Number(bounded[1]) : Number(entry.id.match(/\|since:(\d{4})/)?.[1] || entry.period || 2010)), to: entry.to ?? (bounded ? Number(bounded[2]) : null) };
  }
  function sparkChart(entry) {
    if (!Array.isArray(entry.spark) || !entry.spark.every((count) => Number.isSafeInteger(count) && count >= 0)) return "";
    const range = entryRange(entry);
    const end = Math.min(range.to ?? Number(entry.updated.slice(0, 4)) - 1, Number(entry.updated.slice(0, 4)) - 1);
    const start = entry.sparkStartYear ?? Number(entry.updated.slice(0, 4)) - 10;
    const values = entry.spark.map((count, i) => ({ year: start + i, count })).filter((item) => item.year >= range.from && item.year <= end);
    if (!values.length) return "";
    const max = Math.max(1, ...values.map((item) => item.count));
    const points = values.map((item, i) => `${i ? "L" : "M"}${values.length === 1 ? 70 : 2 + i * 135 / (values.length - 1)},${34 - item.count / max * 30}`).join(" ");
    const dot = values.length === 1 ? `<circle class="chart-point" cx="70" cy="${34 - values[0].count / max * 30}" r="2"/>` : "";
    return `<svg class="mini-chart" viewBox="0 0 140 38" role="img" aria-label="Papers per year, ${values[0].year} to ${values.at(-1).year}"><title>${values.map((item) => `${item.year}: ${papers(item.count)}`).join("; ")}</title><path class="chart-line" d="${points}"/>${dot}</svg>`;
  }

  function libraryLink(entry) {
    // Rebuild the cache-only request from the normalised report identity.
    const [name, ...parts] = entry.id.split("|");
    const includePart = parts.find((part) => part.startsWith("include:"));
    const groupsPart = parts.find((part) => part.startsWith("includeGroups:"));
    const rangePart = parts.find((part) => part.startsWith("range:"))?.slice(6).split("-");
    const from = Number(rangePart?.[0] || parts.find((part) => part.startsWith("since:"))?.slice(6) || 2010);
    const to = rangePart ? Number(rangePart[1]) : null;
    const subtopicId = parts.find((part) => part.startsWith("primary_topic:"))?.slice(14);
    const synonyms = parts.filter((part) => !part.startsWith("include:") && !part.startsWith("includeGroups:") && !part.startsWith("primary_topic:") && !part.startsWith("since:") && !part.startsWith("range:"));
    let includeTerms = [];
    let includeGroups;
    try {
      if (includePart) includeTerms = JSON.parse(includePart.slice(8));
      if (groupsPart) includeGroups = JSON.parse(groupsPart.slice(14));
    } catch { if (groupsPart) return "#search"; }
    return reportHash({ ...entry, from, to, subtopicId, includeTerms, includeGroups, searchTerms: { name, synonyms, includeTerms, includeGroups } }, true);
  }

  function renderLibrary() {
    closeHelp();
    $("library-page").toggleAttribute("aria-busy", libraryLoading);
    $("library-error").textContent = libraryError;
    $("library-error").hidden = !libraryError;
    $("library-retry").hidden = !libraryError;
    $("my-library-tab").setAttribute("aria-selected", String(libraryTab === "my"));
    $("all-topics-tab").setAttribute("aria-selected", String(libraryTab === "all"));
    $("my-library-tab").tabIndex = libraryTab === "my" ? 0 : -1;
    $("all-topics-tab").tabIndex = libraryTab === "all" ? 0 : -1;
    $("library-results").setAttribute("aria-labelledby", libraryTab === "my" ? "my-library-tab" : "all-topics-tab");
    updateLibraryTabs(pointerNavigation);
    if (!libraryLoaded && libraryTab === "all") {
      $("fields").innerHTML = "";
      $("library-cards").innerHTML = "";
      $("library-table").hidden = true;
      $("library-empty").hidden = true;
      $("library-count").textContent = libraryLoading ? "Loading library…" : "";
      return;
    }
    const visible = library.filter((item) => !(item.from !== undefined && (item.from !== 2010 || item.to != null)) && !item.id.includes("|range:") && !(item.period && item.period !== 2010) && !item.id.includes("|since:") && !item.variant && !groupsOf(item).length && !item.id.includes("|include:") && !item.id.includes("|includeGroups:"));
    const source = [...new Map((libraryTab === "my" ? myLibrary : visible).map(repairBoundedSummary).map((item) => [item.id, item])).values()];
    const lookup = new Map([...library, ...source].map((item) => [item.id, item]));
    const baseId = (id) => id.split("|").filter((part) => !/^(include:|includeGroups:|since:|range:|primary_topic:)/.test(part)).join("|");
    const type = (item) => item.subtopicId || item.id.includes("|primary_topic:") ? "sub-topic" : item.variant || /\|(include:|includeGroups:|since:|range:)/.test(item.id) || item.from !== undefined && (item.from !== 2010 || item.to != null) ? "variant" : item.parent ? "sub-topic" : "topic";
    const groups = new Map();
    for (const item of source) {
      let parent = item;
      const seen = new Set([item.id]);
      while (parent?.parent && !seen.has(parent.parent)) { seen.add(parent.parent); parent = lookup.get(parent.parent) || { id: parent.parent }; }
      const id = baseId(parent.id);
      if (!groups.has(id)) groups.set(id, { id, name: lookup.get(id)?.searchTerms?.name || id.split("|")[0], entries: [] });
      groups.get(id).entries.push(item);
    }
    const allGroups = [...groups.values()];
    const fields = ["All fields", ...new Set(source.map((item) => item.field))];
    if (!fields.includes(selectedField)) selectedField = "All fields";
    const matchesField = (group, field) => field === "All fields" || group.entries.some((item) => item.field === field);
    $("fields").innerHTML = fields.map((field) => `<button type="button" class="field-button" data-field="${escape(field)}" aria-pressed="${field === selectedField}"><span>${escape(field)}</span><span class="number">${allGroups.filter((group) => matchesField(group, field)).reduce((sum, group) => sum + group.entries.length, 0)}</span></button>`).join("");
    const query = $("library-search").value.trim().toLowerCase();
    const entries = allGroups.filter((group) => matchesField(group, selectedField) && [group.name, ...group.entries.flatMap((item) => [item.name, item.id, ...(item.synonyms || [])])].join(" ").toLowerCase().includes(query));
    const sort = $("library-sort").value;
    const compare = (a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "updated" ? (b.updated || "").localeCompare(a.updated || "") : (b.growth ?? -Infinity) - (a.growth ?? -Infinity) || a.name.localeCompare(b.name);
    const sortItem = (group) => group.entries.find((item) => item.id === group.id) || group.entries.slice().sort(compare)[0];
    entries.sort((a, b) => compare(sortItem(a), sortItem(b)));
    const shown = entries.flatMap((group) => group.entries);
    const count = (kind) => shown.filter((item) => type(item) === kind).length;
    const plural = (value, noun) => `${value} ${noun}${value === 1 ? "" : "s"}`;
    $("library-count").textContent = libraryLoading ? "Loading library…" : [plural(count("topic"), "topic"), plural(count("sub-topic"), "sub-topic"), plural(count("variant"), "saved version")].join(", ");
    $("library-empty").textContent = source.length ? "No topics match. Try a different search or choose All fields." : libraryTab === "my" ? "Your library is empty. Search for a topic and it will appear here." : "No shared topics yet.";
    $("library-empty").hidden = entries.length !== 0;
    $("library-table").hidden = entries.length === 0;
    $("library-table").setAttribute("class", libraryTab === "my" ? "library-table personal" : "library-table");
    const row = (item, depth) => {
      const range = entryRange(item);
      const end = Math.min(range.to ?? Number(item.updated.slice(0, 4)) - 1, Number(item.updated.slice(0, 4)) - 1);
      const fallback = item.growthLabel === "5-year growth" || end - range.from + 1 < 3;
      const metadata = `${item.momentum}, ${papers(item.total)} ${periodPhrase(range)}. Updated ${dateText(item.updated)}.`;
      let name = displayText(item.name.replace(/ · (?:since \d{4}|\d{4}–\d{4})$/, ""));
      if (type(item) === "variant") {
        const base = baseId(item.id).split("|")[0];
        const extra = name.toLowerCase().startsWith(base.toLowerCase() + " + ") ? name.slice(base.length + 3) : "";
        name = extra ? `Must also include: ${extra}` : rangeLabel(range, true);
      }
      const newTopic = isNewTopic(growthWindow(item));
      const basis = fallback && !newTopic ? '<span class="growth-basis" title="Five-year growth" aria-label="5-year growth">5y</span>' : "";
      return `<div class="library-row" style="--depth:${depth}" data-report-id="${escape(item.id)}"><div class="library-entry"><a class="library-name" href="${escape(libraryLink(item))}" title="${escape(metadata)}">${escape(name)}</a><div class="library-field">${escape(item.field)}${type(item) === "variant" && extraRange(item, name) ? ", " + escape(rangeLabel(range, true).toLowerCase()) : ""}</div></div><div>${sparkChart(item)}</div><span class="library-growth ${newTopic ? "" : growthClass(item.growth)}${item.growth === null ? " unavailable" : ""}">${newTopic ? "New topic" : item.growth === null ? "Not enough data" : percent(item.growth)}${basis}</span>${libraryTab === "my" ? `<button type="button" class="remove-report" aria-label="Remove ${escape(item.name)} from my library" data-remove-report="${escape(item.id)}">Remove</button>` : ""}</div>`;
    };
    const extraRange = (item, name) => name.startsWith("Must also include:") && (entryRange(item).from !== 2010 || entryRange(item).to !== null);
    $("library-cards").innerHTML = entries.map((group) => {
      const actual = new Map(group.entries.map((item) => [item.id, item]));
      const parentFor = (item) => {
        const inferred = item.parent || (item.id.includes("|primary_topic:") ? item.id.replace(/\|primary_topic:T[0-9]+$/, "") : group.id);
        return inferred !== item.id && actual.has(inferred) ? inferred : item.id !== group.id && actual.has(group.id) ? group.id : null;
      };
      const rendered = new Set();
      const render = (item, depth) => {
        if (rendered.has(item.id)) return "";
        rendered.add(item.id);
        return row(item, Math.min(depth, 3)) + group.entries.filter((child) => parentFor(child) === item.id).sort(compare).map((child) => render(child, depth + 1)).join("");
      };
      const root = actual.get(group.id);
      let content = root ? render(root, 0) : `<div class="library-parent"><span>${escape(group.name)}</span><span class="unsaved-parent">Parent topic not saved</span></div>`;
      content += group.entries.filter((item) => !rendered.has(item.id) && !parentFor(item)).sort(compare).map((item) => render(item, 1)).join("");
      content += group.entries.filter((item) => !rendered.has(item.id)).sort(compare).map((item) => render(item, 1)).join("");
      return `<article class="library-card" data-group-id="${escape(group.id)}">${content}</article>`;
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
      catch { throw new Error(connectionError()); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The data service returned an unreadable library. Try again later."); }
      if (!response.ok) throw new Error(typeof data.message === "string" && data.message.trim() ? data.message : "The Library could not be loaded. Try again later.");
      if (!Array.isArray(data) || !data.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.field === "string" && typeof item.updated === "string" && Array.isArray(item.synonyms) && Array.isArray(item.children))) throw new Error("The data service returned an unreadable library. Try again later.");
      library = data.map(presentReport);
      libraryLoaded = true;
      libraryDirty = libraryRevision !== revision;
    } catch (error) { libraryError = error.message; }
    finally { clearTimeout(timeout); libraryLoading = false; renderLibrary(); }
  }

  function reportHash(report, cacheOnly = false) {
    const terms = report.searchTerms || { name: report.name, synonyms: report.synonyms };
    const params = new URLSearchParams({ topic: terms.name });
    if (report.from !== undefined) {
      if (report.from !== 2010 || report.to != null) params.set("from", String(report.from));
      if (report.to !== null) params.set("to", String(report.to));
    } else if (report.period && report.period !== 2010) params.set("period", String(report.period));
    if (terms.synonyms.length) params.set("syn", terms.synonyms.join(","));
    groupsOf(report).forEach((group, index) => params.set(index ? "include" + (index + 1) : "include", group.join(",")));
    if (report.subtopicId) {
      params.set("sub", report.subtopicId);
      params.set("title", baseTitle(report));
    }
    if (cacheOnly) params.set("cache", "only");
    return "#" + params.toString();
  }

  function persistMyLibrary() {
    try { localStorage.setItem(myLibraryKey, JSON.stringify(myLibrary)); return true; }
    catch { notify("Your library could not be saved in this browser. Allow browser storage and try again.", true); return false; }
  }

  function rememberReport(saveSummary = true) {
    let saved = true;
    if (saveSummary) {
      const range = reportRange(topic);
      const lastYear = Math.min(range.to ?? Number(topic.updated.slice(0, 4)) - 1, Number(topic.updated.slice(0, 4)) - 1);
      const sparkStartYear = Math.max(range.from, Math.min(...topic.years.map((item) => item.year)));
      const summary = { id: topic.id, name: topic.name, parent: topic.parent || null, field: topic.field,
        momentum: topic.kpis.momentum, growth: primaryGrowth(topic), total: topic.kpis.total,
        spark: Array.from({ length: Math.max(0, lastYear - sparkStartYear + 1) }, (_, i) => topic.years.find((year) => year.year === sparkStartYear + i)?.count || 0),
        updated: topic.updated, from: range.from, to: range.to, sparkStartYear, growthLabel: topic.kpis.growthLabel || "5-year growth", ...growthWindow(topic),
        ...(topic.includeGroups?.length ? { includeGroups: topic.includeGroups, searchTerms: topic.searchTerms } : {}) };
      const previous = myLibrary;
      myLibrary = myLibrary.filter((item) => item.id !== summary.id).concat(summary);
      saved = persistMyLibrary();
      if (!saved) myLibrary = previous;
    }
    reports.set(reportHash(topic, cacheOnlyView), topic);
    try { localStorage.setItem(storageKey, JSON.stringify({ ...topic, _cacheOnlyView: cacheOnlyView })); } catch { /* Storage may be unavailable. */ }
    renderSaveState();
    return saved;
  }

  function setLoading(loading) {
    busy = loading;
    setPresentationLoading(loading);
    renderSaveState();
    $("export-csv").disabled = loading || topic.kpis.total === 0;
    $("search-form").toggleAttribute("aria-busy", loading);
    document.querySelectorAll('#search-form input, #search-form select, #search-form button, #suggested-synonyms button, #subtopics button').forEach((control) => { control.disabled = loading; });
    syncIncludeControls();
  }

  function route(loadReport = true) {
    const reopeningFromLibrary = previousRouteHash === "#library";
    previousRouteHash = location.hash;
    const isLibrary = location.hash === "#library";
    $("report-source").textContent = isLibrary || !isSample ? "" : "Sample data";
    $("report-freshness").hidden = isLibrary;
    showPresentationPage(isLibrary);
    $("search-nav").toggleAttribute("aria-current", !isLibrary);
    $("library-nav").toggleAttribute("aria-current", isLibrary);
    $(isLibrary ? "library-nav" : "search-nav").setAttribute("aria-current", "page");
    document.title = `${isLibrary ? "Library" : "Search"} - Topic Momentum Meter`;
    $("data-notice").textContent = !isLibrary && isSample ? "Fictional research and illustrative numbers." : "Data from OpenAlex. Searches are cached anonymously to keep the tool free.";
    if (isLibrary) { if (loadReport) loadLibrary(); else renderLibrary(); }
    if (!loadReport) return;
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("topic")) {
      if (busy) { requestController?.abort(); requestVersion++; setLoading(false); $("status").hidden = true; }
      return;
    }
    if (!isSample && !topic.growthNeedsRebuild && reportHash(topic, cacheOnlyView) === location.hash) {
      if (reopeningFromLibrary) rememberReport();
      if (busy) { requestController?.abort(); requestVersion++; setLoading(false); renderTopic(); $("status").hidden = true; }
      return;
    }
    requestController?.abort();
    requestVersion++;
    setLoading(false);
    if (reports.has(location.hash) && !reports.get(location.hash).growthNeedsRebuild) {
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
    const includeKeys = ["include", "include2", "include3"];
    for (const key of params.keys()) if (/^include(?:\d*|Groups)$/.test(key) && (!includeKeys.includes(key) || params.getAll(key).length > 1)) { notify("Use up to three include groups, with each group supplied once.", true); return; }
    const include = includeKeys.map(key => (params.get(key) || "").split(","));
    search(name, terms, id ? { id, name: params.get("title") || id } : null, true, params.get("cache") === "only", include, params.get("from") ?? params.get("period") ?? "2010", params.get("to") ?? "");
  }

  async function search(name = $("topic-input").value, terms = synonyms(), selection = null, fromRoute = false, cacheOnly = false, include = readIncludeGroups(), from = $("from-input").value, to = $("to-input").value) {
    if (busy) return;
    if (!name.trim()) { notify("Enter a research topic and try again.", true); return; }
    const currentYear = new Date().getFullYear();
    if (!/^\d{4}$/.test(String(from)) || Number(from) < 2000 || Number(from) > currentYear) { $("search-options").open = true; notify(`Enter a From year between 2000 and ${currentYear}.`, true); return; }
    if (to != null && to !== "" && (!/^\d{4}$/.test(String(to)) || Number(to) < 2000 || Number(to) > currentYear)) { $("search-options").open = true; notify(`Enter a To year between 2000 and ${currentYear}, or leave it empty to include papers up to today.`, true); return; }
    if (to != null && to !== "" && Number(from) > Number(to)) { $("search-options").open = true; notify("The From year must be the same as or earlier than the To year.", true); return; }
    if (!checkIncludeLimits(name, terms, include, from, to, selection)) return;
    const normalizedInclude = normaliseGroups(include);
    // Keep the original single-group request serialization, including preset order.
    include = normalizedInclude.length === 1 ? [groupsOf(include).find(group => normaliseGroups([group]).length).map(term => term.trim()).filter(Boolean)] : normalizedInclude;
    setLoading(true);
    vanishQuery();
    const version = ++requestVersion;
    notify(queryOperatorCount(name, terms, include) > 5 ? "This search is more complex, so it takes a little longer…" : "Loading research data…", true);
    const controller = new AbortController();
    requestController = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const url = new URL(window.WORKER_URL.replace(/\/$/, "") + "/api/topic");
      url.searchParams.set("q", name.trim());
      url.searchParams.set("syn", terms.join(","));
      url.searchParams.set("from", String(from));
      if (to != null && to !== "") url.searchParams.set("to", String(to));
      include.forEach((group, index) => url.searchParams.set(index ? "include" + (index + 1) : "include", group.join(",")));
      if (cacheOnly) url.searchParams.set("cache", "only");
      if (selection) {
        url.searchParams.set("subtopic", selection.id);
        url.searchParams.set("subtopicName", selection.name);
        if (selection.parent) url.searchParams.set("parent", selection.parent);
        if (selection.parentName) url.searchParams.set("parentName", selection.parentName);
      }
      let response;
      try { response = await fetch(url, { signal: controller.signal }); }
      catch { throw new Error(connectionError()); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The data service returned an unreadable report. Try again later."); }
      if (!response.ok) {
        throw new Error(typeof data.message === "string" && data.message.trim() ? data.message : "The data service could not complete the search. Try again later.");
      }
      if (version !== requestVersion) return;
      if (include.length > 1 && JSON.stringify(normaliseGroups(groupsOf(data))) !== JSON.stringify(include)) throw new Error("The data service did not retain every include group. Update the Worker and try again.");
      topic = presentReport({ ...data, searchTerms: { name: name.trim(), synonyms: terms, ...includeFields(groupsOf(data)) } });
      isSample = false;
      cacheOnlyView = cacheOnly;
      if (!cacheOnly || data.cached === false) { libraryDirty = true; libraryRevision++; }
      renderTopic();
      const saved = rememberReport();
      if (!fromRoute) location.hash = reportHash(topic, cacheOnlyView);
      route(false);
      if (topic.kpis.total === 0) { clearTimeout(noticeTimer); $("status").hidden = true; }
      else if (saved) notify("Research data loaded.");
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
  $("synonyms-input").addEventListener("input", () => { renderSynonyms(); syncOptions(); });
  for (const id of [...includeInputIds, "from-input", "to-input"]) $(id).addEventListener("input", () => { syncOptions(); clearIncludeError(); });
  $("children-preset").addEventListener("click", () => {
    $("include-input").value = childrenPreset;
    syncOptions();
    $("include-input").focus();
  });
  $("add-include-group").addEventListener("click", () => {
    if (busy || includeSlots === 3) return;
    includeSlots++;
    syncIncludeControls();
    $(includeInputIds[includeSlots - 1]).focus();
  });
  includeInputIds.forEach((id, index) => $("remove-include-" + (index + 1)).addEventListener("click", () => {
    if (busy) return;
    const groups = readIncludeGroups();
    groups.splice(index, 1);
    setIncludeGroups(groups);
    syncOptions();
    $(includeInputIds[Math.min(index, includeSlots - 1)]).focus();
  }));
  $("gcc-preset").addEventListener("click", () => { if (!busy) addIncludePreset("gcc"); });
  $("middle-east-preset").addEventListener("click", () => { if (!busy) addIncludePreset("middleEast"); });
  for (const [id, tab] of [["my-library-tab", "my"], ["all-topics-tab", "all"]]) {
    $(id).addEventListener("click", () => { libraryTab = tab; selectedField = "All fields"; renderLibrary(); });
    $(id).addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === "Home" ? "my-library-tab" : event.key === "End" ? "all-topics-tab" : tab === "my" ? "all-topics-tab" : "my-library-tab";
      $(target).click();
      $(target).focus();
    });
  }
  $("library-search").addEventListener("input", renderLibrary);
  $("library-sort").addEventListener("change", renderLibrary);
  $("library-retry").addEventListener("click", () => loadLibrary(true));
  let activeHelp;
  function closeHelp() {
    if (!activeHelp) return;
    const tip = $(activeHelp.dataset.help);
    if (tip) tip.hidden = true;
    activeHelp.setAttribute("aria-expanded", "false");
    activeHelp = null;
  }
  function openHelp(button) {
    closeHelp();
    const tip = $(button.dataset.help);
    tip.style && (tip.style.top = "", tip.style.bottom = "");
    tip.hidden = false;
    button.setAttribute("aria-expanded", "true");
    activeHelp = button;
    if (tip.getBoundingClientRect) {
      tip.style.transform = "";
      const bounds = tip.getBoundingClientRect();
      const shift = bounds.right > window.innerWidth - 16 ? window.innerWidth - 16 - bounds.right : bounds.left < 16 ? 16 - bounds.left : 0;
      tip.style.transform = `translateX(${shift}px)`;
      if (bounds.bottom > window.innerHeight - 16 && button.getBoundingClientRect().top > bounds.height + 16) { tip.style.top = "auto"; tip.style.bottom = "calc(100% + 12px)"; }
    }
  }
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeHelp(); });
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    const button = event.target.closest?.("[data-help]");
    if (button && button !== activeHelp) openHelp(button);
  });
  document.addEventListener("pointerout", (event) => {
    const wrapper = event.target.closest?.(".help");
    if (wrapper && !wrapper.contains?.(event.relatedTarget) && !wrapper.contains?.(document.activeElement)) closeHelp();
  });
  document.addEventListener("focusin", (event) => { const button = event.target.closest?.("[data-help]"); if (button) openHelp(button); else closeHelp(); });
  $("experts-toggle").addEventListener("click", () => { expertsExpanded = !expertsExpanded; renderRankings(); });
  $("countries-toggle").addEventListener("click", () => { countriesExpanded = !countriesExpanded; renderRankings(); });
  $("journals-toggle").addEventListener("click", () => { journalsExpanded = !journalsExpanded; renderRankings(); });
  $("papers-toggle").addEventListener("click", () => { papersExpanded = !papersExpanded; renderRankings(); });
  $("save-report").addEventListener("click", () => { if (!isSample && !busy && rememberReport()) notify("Saved to My library."); });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) { closeHelp(); return; }
    if (button.dataset.help !== undefined) { openHelp(button); return; }
    closeHelp();
    if (button.dataset.rangePreset !== undefined) {
      $("from-input").value = button.dataset.rangePreset;
      $("to-input").value = "";
      syncOptions();
      $("from-input").focus();
    }
    if (button.dataset.removeReport !== undefined) {
      myLibrary = myLibrary.filter((item) => item.id !== button.dataset.removeReport);
      persistMyLibrary();
      renderSaveState();
      renderLibrary();
    }
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
      search(terms.name, terms.synonyms, { id: match[1], name: button.dataset.title, parent: topic.subtopicId ? topic.parent : topic.id, parentName: parentDisplayName() }, false, false, groupsOf(topic), reportRange(topic).from, reportRange(topic).to);
    }
    if (button.dataset.nextTerm !== undefined) {
      const terms = topic.searchTerms || { name: topic.name, synonyms: topic.synonyms };
      search(`${terms.name} ${button.dataset.nextTerm}`, [], null, false, false, groupsOf(topic), reportRange(topic).from, reportRange(topic).to);
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
      notify("Couldn’t copy automatically. The text is selected, so press Ctrl+C (Cmd+C on Mac).");
    }
  });
  $("export-csv").addEventListener("click", () => {
    const range = reportRange(topic);
    const groups = groupsOf(topic);
    const groupColumn = groups.length > 1 ? ',"' + JSON.stringify(groups).replaceAll('"', '""') + '"' : "";
    const csv = "sample_data,range,year,papers" + (groups.length > 1 ? ",include_groups" : "") + "\r\n" + topic.years.filter((item) => item.year >= range.from && (range.to === null || item.year <= range.to)).map((item) => `${isSample},${rangeLabel(range, true)},${item.year},${item.count}${groupColumn}`).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${isSample ? "sample-" : ""}${topic.name.replace(/[^a-z0-9]+/gi, "-")}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const id of ["from-input", "to-input"]) $(id).setAttribute("max", String(new Date().getFullYear()));
  window.addEventListener("resize", () => {
    closeHelp();
    const range = reportRange(topic);
    $("year-chart").innerHTML = chart(topic.years.filter((item) => item.year >= range.from && (range.to === null || item.year <= range.to)));
    wireChart();
    updateLibraryTabs(false);
  });
  if (presentationEnabled) {
    setupPresentation();
    document.addEventListener("pointerdown", () => { pointerNavigation = true; }, { capture: true });
    document.addEventListener("keydown", () => { pointerNavigation = false; }, { capture: true });
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => { if (event.matches) { finishReportMotion(); pageTransition?.skipTransition(); } });
    document.addEventListener("visibilitychange", () => { if (document.hidden) finishReportMotion(); else if (!busy) animateReport(); });
  }
  window.addEventListener("hashchange", route);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.name === "string" && Array.isArray(saved.years) && saved.kpis) {
      const { _cacheOnlyView, ...savedTopic } = saved;
      topic = presentReport(savedTopic);
      cacheOnlyView = _cacheOnlyView === true;
      isSample = false;
    }
  } catch { topic = window.SAMPLE_TOPIC; isSample = true; }
  renderTopic();
  if (!isSample) {
    rememberReport(myLibrary.some((entry) => entry.id === topic.id));
    if (!location.hash || location.hash === "#search") history.replaceState(null, "", reportHash(topic, cacheOnlyView));
  }
  route();
})();
