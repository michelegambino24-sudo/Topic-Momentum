/* Live searches and saved reports share report navigation. */
(() => {
  "use strict";
  let topic = window.SAMPLE_TOPIC;
  let isSample = true;
  let busy = false;
  const reports = new Map();
  let requestVersion = 0;
  let requestController;
  let pendingClarification = null;
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
  let activeSubfield = "";
  let activeExclusions = [], activeAuthored = [], activeUnderstandingKey = "", draftPlace = null, manualDraft = true;
  // A place chosen in the "Where" list always wins over a place written in the search bar. null = not chosen yet.
  let pickedPlace = null, pickedMode = "authored";
  // True only after Advanced edits (synonyms, include groups). Years, Where and the place meaning never switch the page to the unchecked search.
  let advancedDirty = false;
  const POPULAR_PLACES = ["worldwide", "country:US", "europe", "middleEast", "mena", "gcc", "country:AE", "country:SA", "africa", "asia"];
  function placeName(id) { return id === "country:US" ? "USA" : id === "worldwide" ? "Worldwide (no filter)" : globalThis.TMM_PLACES.byId[id].label; }
  function buildPlaceSelect() {
    const select = document.getElementById("place-select"), places = globalThis.TMM_PLACES;
    if (!select || !places || select.dataset.built) return;
    // Only these ten choices. Each region already contains every one of its countries, so a paper from Saudi Arabia
    // is found under MENA, Middle East, GCC and Saudi Arabia, and a paper from Nigeria under Africa.
    select.innerHTML = POPULAR_PLACES.filter(id => id === "worldwide" || places.byId[id]).map(id => `<option value="${id}">${escape(placeName(id))}</option>`).join("") + '<option value="custom" disabled hidden>Place from your text</option>';
    select.dataset.built = "1";
  }
  // The Where list and the year boxes are the source of truth for the AI search: they replace a place or years typed in the bar.
  function composeSentence(sentence, from, to) {
    let text = sentence;
    if (pickedPlace !== null) {
      // Dropping a typed place can leave a dangling word ("research about since 2020"): remove it.
      const without = globalThis.TMM_PLACES.resolve(text).withoutPlaces.replace(/\s+(?:about|regarding|concerning|around|across|within|in|of|from|for|on)\s*(?=(?:since|until|between|after|before|during)\b|[?.!]*$)/gi, " ").replace(/\s+/g, " ").trim();
      if (without) text = without + (pickedPlace === "worldwide" ? "" : " in " + globalThis.TMM_PLACES.byId[pickedPlace].label);
    }
    const year = new Date().getFullYear(), start = Number(from), end = to === "" || to == null ? null : Number(to);
    if (Number.isInteger(start) && start >= 2000 && start <= year && (end === null || (Number.isInteger(end) && end >= start && end <= year))) {
      const typed = parser.questionParts(text, year);
      const sameYears = typed.explicitRange ? (typed.from === start && (typed.to ?? null) === end) : false;
      if (sameYears || (!typed.explicitRange && start === 2010 && end === null)) return text;
      let stripped = text;
      for (const source of new Set(Object.values(typed.rangeSources || {}).filter(Boolean))) stripped = stripped.split(source).join(" ");
      stripped = stripped.replace(/\s+(?:since|from|until|between|after|before|during)\s*(?=$|[?.!])/gi, " ").replace(/\s+/g, " ").trim();
      if (stripped) text = stripped + (end !== null ? " from " + start + " to " + end : start !== 2010 ? " since " + start : "");
    }
    return text;
  }
  function applyPickedPlace() {
    if (pickedPlace === null) return;
    // The list starts on "researchers based there"; only the visible choice box changes it.
    const mode = pickedMode;
    draftPlace = globalThis.TMM_PLACES.describe([pickedPlace], mode);
    activeAuthored = mode === "authored" && pickedPlace !== "worldwide" ? draftPlace.codes : [];
  }
  function syncPlaceSelect() {
    try { drawPlaceSelect(); } catch { /* The list is a convenience on top of the sentence. */ }
  }
  function drawPlaceSelect() {
    const select = document.getElementById("place-select");
    if (!select || !select.options || typeof select.options[Symbol.iterator] !== "function") return;
    buildPlaceSelect();
    const ids = draftPlace?.ids || [];
    const value = pickedPlace !== null ? pickedPlace : ids.length === 1 ? ids[0] : ids.length > 1 ? "custom" : "worldwide";
    select.value = [...select.options].some(item => item.value === value) ? value : "worldwide";
  }
  let draftTopic = "", sentenceText = "", draftErrors = [], draftNote = "", draftLabels = [], showDraftFrom = false;
  let narrowDraft = null, narrowText = "";
  const parser = window.TMM_QUERY_PARSER;
  let refineChoices = [];
  const refinementHistory = new Map();
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
    const ticks=unavailable||newTopic?"":bounds.map((value,index)=>{const p=polar(180+index*45);return '<text class="gauge-tick" x="'+(160+(p[0]-160)*1.15)+'" y="'+(150+(p[1]-150)*1.15)+'" text-anchor="middle">'+Math.round(value*100)+'%</text>';}).join('');
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
    const examples = ["epigenetics in children since 2020", "inheritance law in the GCC", "AI and its impact on jobs, wages and productivity", "neurotechnology in the UAE, last 5 years", "screen time and sleep in teenagers"];
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
  const editingGroups = [false, false, false];
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
  // Long custom groups read as "pupils (and 4 similar terms)" instead of listing every word.
  const shortGroup = (terms, separator, format = (term) => term) => {
    const clean = terms.map((term) => String(term).trim()).filter(Boolean);
    if (clean.length <= 3) return clean.map(format).join(separator);
    const lead = [...clean].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    return `${format(lead)} (and ${clean.length - 1} similar terms)`;
  };
  function groupPreset(terms) {
    const key = JSON.stringify([...terms].sort());
    return Object.values(window.TMM_SEARCH_PRESETS).find(preset => JSON.stringify([...preset.terms].sort()) === key)
      || (window.TMM_COUNTRY_GROUPS || []).find(country => JSON.stringify([...country.terms].sort()) === key);
  }
  function syncIncludeControls() {
    includeInputIds.forEach((id, index) => {
      if (index) $("include-group-" + (index + 1)).hidden = index >= includeSlots;
      $(id).disabled = busy || index >= includeSlots;
      $("remove-include-" + (index + 1)).disabled = busy;
    });
    $("add-include-group").disabled = busy || includeSlots === 3;
    $("include-limit").hidden = includeSlots < 3;
    syncIncludePresets();
  }
  // Show a recognised preset group as one readable chip instead of its long term list.
  function syncIncludePresets() {
    includeInputIds.forEach((id, index) => {
      const n = index + 1, group = $("include-group-" + n);
      const terms = normaliseGroups([$(id).value.split(",")])[0] || [];
      const preset = terms.length ? groupPreset(terms) : null;
      const show = Boolean(preset) && !editingGroups[index];
      $("include-preset-" + n).hidden = !show;
      if (show) {
        $("include-preset-name-" + n).textContent = preset.label;
        $("include-preset-count-" + n).textContent = preset.terms.length + " terms";
        group.dataset.preset = "true";
      } else delete group.dataset.preset;
    });
    $("remove-include-1").hidden = includeSlots === 1 && !$("include-input").value.trim();
  }
  function setIncludeGroups(groups) {
    includeSlots = Math.max(1, groups.length);
    editingGroups.fill(false);
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
    manualDraft = true; advancedDirty = true;
    const preset = window.TMM_SEARCH_PRESETS[id];
    const existing = includeInputIds.slice(0, includeSlots).find(input => groupPreset(normaliseGroups([$(input).value.split(",")])[0] || []) === preset);
    if (existing) { $(existing).focus(); return; }
    let index = includeInputIds.slice(0, includeSlots).findIndex(input => !$(input).value.trim());
    if (index < 0) {
      if (includeSlots === 3) { notify("You can use up to three include groups. Remove a group to add another.", true); return; }
      index = includeSlots++;
    }
    $(includeInputIds[index]).value = preset.terms.join(", ");
    editingGroups[index] = false;
    syncIncludeControls();
    syncOptions();
    $(includeInputIds[index]).focus();
    checkIncludeLimits($("topic-input").value, synonyms(), readIncludeGroups(), $("from-input").value, $("to-input").value);
  }
  function checkIncludeLimits(name, terms, include, from, to, selection, subfield = activeSubfield, exclusions = activeExclusions, authored = activeAuthored, placeIds = draftPlace?.ids || [], placeMode = draftPlace?.mode || "authored") {
    const raw = groupsOf(include);
    clearIncludeError();
    let message;
    if (raw.length > 3) message = "You can use up to three include groups. Remove a group to add another.";
    else if (raw.reduce((sum, group) => sum + group.join(",").length, 0) > 1200) message = "The additional terms are too long. Use fewer than 1,200 characters and try again.";
    else {
      const groups = normaliseGroups(include);
      const cleanedName = cleanSearchTerm(name);
      const cleanedTerms = [...new Set(terms.map(cleanSearchTerm).filter(term => term && term !== cleanedName))].sort();
      const encodedGroups = window.TMM_PRESET_IDENTITIES.encode(groups);
      const includeId = encodedGroups ? [encodedGroups] : [];
      const rangeId = to != null && to !== "" ? ["range:" + from + "-" + to] : Number(from) !== 2010 ? ["since:" + from] : [];
      const extraId = [...(exclusions.length ? ["exclude:" + JSON.stringify([...new Set(exclusions.map(cleanSearchTerm))].sort())] : []), ...(placeIds.length && !placeIds.includes("worldwide") && (placeMode==="mentions" || authored.length>64) ? ["places:"+JSON.stringify(globalThis.TMM_PLACES.tokens(placeIds))+":"+placeMode] : authored.length ? ["authored:" + JSON.stringify([...new Set(authored)].sort())] : [])];
      const id = [cleanedName, ...cleanedTerms, ...includeId, ...rangeId, ...extraId, ...(subfield ? ["subfield:" + subfield] : []), ...(selection ? ["primary_topic:" + selection.id] : [])].join("|");
      if (new TextEncoder().encode("v3:topic:" + id).length > 512) message = "This search has too many terms. Remove some synonyms or additional terms and try again.";
    }
    $("include-error").textContent = message || "";
    $("include-error").hidden = !message;
    if (message) { $("search-options").open = true; notify(message, true); return false; }
    return true;
  }
  function syncOptions(reset = false) {
    if (reset && $("search-options").open === undefined) $("search-options").open = false;
    renderUnderstood();
  }

  function groupDescription(rawTerms) {
    const terms = rawTerms.map(term => term.trim().toLowerCase()).filter(Boolean);
    const identity = parser.key(terms);
    const parsed = draftLabels.find(item => parser.key(item.terms) === identity);
    if (parsed) return `${parsed.kind === "place" ? "Mentions" : "About"}: ${parsed.label}`;
    const preset = groupPreset(terms);
    const place = preset && (preset === window.TMM_SEARCH_PRESETS.gcc || preset === window.TMM_SEARCH_PRESETS.middleEast || (window.TMM_COUNTRY_GROUPS || []).includes(preset));
    if (preset) return `${place ? "Mentions" : "About"}: ${preset.label}`;
    const country = parser.countries.find(item => parser.key(item.terms) === identity);
    const person = parser.people.find(item => parser.key(item.terms) === identity);
    return country ? `Mentions: ${country.label}` : `About: ${person?.label || shortGroup(terms, " or ")}`;
  }
  function understoodButton(description, action, narrow = false) {
    return `<button class="chip understood-chip" type="button" ${narrow ? "data-narrow-remove" : "data-draft-remove"}="${escape(action)}" aria-label="Remove ${escape(description)}"${busy ? " disabled" : ""}><span>${escape(description)}</span><span aria-hidden="true">×</span></button>`;
  }
  function renderUnderstood() {
    const chips = draftTopic ? [understoodButton("Topic: " + draftTopic, "topic")] : [];
    readIncludeGroups().forEach((group, index) => {
      if (draftPlace?.mode === "mentions" && parser.key(group) === parser.key(draftPlace.terms)) return;
      if (group.some(term => term.trim())) chips.push(understoodButton(groupDescription(group), "group:" + index));
    });
    synonyms().forEach((term, index) => chips.push(understoodButton("Also searches: " + term, "synonym:" + index)));
    const from = $("from-input").value, to = $("to-input").value;
    if (to) chips.push(understoodButton("From " + from, "from"), understoodButton("Until " + to, "to"));
    else if (showDraftFrom || Number(from) !== 2010) chips.push(understoodButton("Since " + from, "from"));
    if (activeSubfield) chips.push(understoodButton("Only: " + (topic.selectedSubfield?.name || "Subfield " + activeSubfield), "subfield"));
    activeExclusions.forEach((term, index) => chips.push(understoodButton("Excluded: " + term, "exclude:" + index)));
    if(draftPlace?.ids?.includes("worldwide"))chips.push(understoodButton("Worldwide (no place filter)","place"));
    else if (draftPlace) {
      const other = draftPlace.mode === "authored" ? "Mentioned in title/abstract" : "Authors based in";
      const label = draftPlace.ids ? `${draftPlace.mode === "authored" ? "Authors based in:" : "Mentioned in title/abstract:"} ${draftPlace.label} (${draftPlace.countryCount || draftPlace.codes?.length || 0} ${(draftPlace.countryCount || draftPlace.codes?.length)===1?"country":"countries"})` : `${draftPlace.mode === "authored" ? "Written in" : "Mentions"} ${draftPlace.label}`;
      // Two visible options, one selected, so the choice is never hidden behind an unlabeled button.
      const otherText = draftPlace.mode === "authored" ? "Research about " + draftPlace.label : "Researchers based in " + draftPlace.label;
      chips.push(`<span class="place-choice" role="group" aria-label="${escape("What do you mean by " + draftPlace.label + "?")}"><span class="place-choice-question">Which do you mean by <strong>${escape(draftPlace.label)}</strong>?</span><span class="place-chip"><button type="button" class="chip place-option is-selected" aria-pressed="true" title="Authors based in uses member countries. Mentioned in title/abstract uses the selected place's aliases.">${escape(label)}</button><button type="button" class="chip place-option" data-place-toggle="true" aria-pressed="false" aria-label="${escape("Switch to " + otherText)}"${busy ? " disabled" : ""}>${escape(otherText)}</button><button type="button" class="chip place-remove" data-draft-remove="place" aria-label="Remove place restriction"${busy ? " disabled" : ""}>×</button></span></span>`);
    } else if (activeAuthored.length) chips.push(understoodButton("Written in: " + (topic.authoredLabel || activeAuthored.join(", ")), "place"));
    // "Did you mean…?" only checks the meaningful words (topic and focus terms), never the framing words.
    const checked = [draftTopic, ...draftLabels.filter(item => item.kind === "focus").flatMap(item => item.terms)].join(" ");
    const spelling = window.TMM_SPELL?.ready && checked.trim() ? window.TMM_SPELL.suggest(checked).slice(0, 2) : [];
    for (const { word, suggestion } of spelling) chips.push(`<button class="chip spell-chip" type="button" data-spell-word="${escape(word)}" data-spell-to="${escape(suggestion)}"${busy ? " disabled" : ""}>Did you mean <strong>${escape(suggestion)}</strong>?</button>`);
    $("understood-chips").innerHTML = chips.join("");
    syncPlaceSelect();
    $("query-note").textContent = [...draftErrors, draftNote].filter(Boolean).join(" ");
    $("query-note").hidden = !$("query-note").textContent;
  }
  function previewSentence(reset = false) {
    const parsed = parser.parse($("topic-input").value, new Date().getFullYear());
    sentenceText = $("topic-input").value;
    manualDraft = false; advancedDirty = false;
    draftTopic = parsed.topic; draftErrors = parsed.errors; draftNote = parsed.note; draftLabels = parsed.groups;
    if (reset) {
      activeExclusions = []; activeAuthored = []; activeUnderstandingKey = ""; draftPlace = null;
      activeSubfield = ""; $("synonyms-input").value = parsed.synonyms.join(", ");
      setIncludeGroups(parsed.includeGroups);
      $("from-input").value = String(parsed.from); $("to-input").value = parsed.to === null ? "" : String(parsed.to);
      showDraftFrom = parsed.explicitRange;
    } else {
      if (parsed.includeGroups.length) setIncludeGroups(parsed.includeGroups);
      if (parsed.synonyms.length) $("synonyms-input").value = parsed.synonyms.join(", ");
      if (parsed.explicitRange) { $("from-input").value = String(parsed.from); $("to-input").value = parsed.to === null ? "" : String(parsed.to); showDraftFrom = true; }
    }
    if(parsed.resolvedPlace){draftPlace=parsed.resolvedPlace.matches.length?parsed.resolvedPlace:null;activeAuthored=draftPlace?.mode==="authored"?draftPlace.codes:[];}
    applyPickedPlace();
    renderSynonyms(); renderUnderstood();
  }
  function currentNarrowSearch() {
    return { topic: topic.searchTerms?.name || topic.name, synonyms: topic.searchTerms?.synonyms || topic.synonyms,
      includeGroups: groupsOf(topic), ...reportRange(topic), subfieldId: topic.subfieldId, subtopicId: topic.subtopicId };
  }
  function previewNarrow(parseInput = true) {
    if (parseInput || !narrowDraft) {
      narrowText = $("narrow-input").value;
      narrowDraft = parser.parse(narrowText, new Date().getFullYear(), { refinement: true, currentTopic: topic.searchTerms?.name || topic.name });
    }
    const merged = parser.merge(currentNarrowSearch(), narrowDraft, new Date().getFullYear());
    const chips = narrowDraft.topic ? [understoodButton("About: " + narrowDraft.topic, "topic", true)] : [];
    narrowDraft.groups.forEach((item, index) => chips.push(understoodButton(`${item.kind === "place" ? "Mentions" : "About"}: ${item.label}`, "group:" + index, true)));
    if (narrowDraft.explicitRange) {
      chips.push(understoodButton(`${narrowDraft.to === null ? "Since" : "From"} ${narrowDraft.from}`, "years", true));
      if (narrowDraft.to !== null) chips.push(understoodButton("Until " + narrowDraft.to, "years", true));
    }
    $("narrow-understood").innerHTML = chips.join("");
    $("narrow-note").textContent = [...merged.errors, merged.note, narrowDraft.note && !narrowDraft.ignored.length ? narrowDraft.note : ""].filter(Boolean).join(" ");
    $("narrow-note").hidden = !$("narrow-note").textContent;
    return merged;
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
    return groupsOf(terms).map(group => " + " + (groupPreset(group)?.label || shortGroup(group, " / "))).join("");
  }
  const reportRange = (report) => ({ from: report.from ?? report.period ?? 2010, to: report.to ?? null });
  const rangeLabel = (range, capital = false) => range.to != null ? `${range.from}–${range.to}` : `${capital ? "Since" : "since"} ${range.from}`;
  const primaryGrowth = (report) => Object.hasOwn(report.kpis, "growth") ? report.kpis.growth : report.kpis.growth5y;
  function baseTitle(report) {
    const periodSuffix = report.from !== undefined || report.period ? ` · ${rangeLabel(reportRange(report))}` : "";
    if (periodSuffix && report.name.endsWith(periodSuffix)) report = { ...report, name: report.name.slice(0, -periodSuffix.length) };
    if (report.selectedSubfield) {
      const suffix = `, ${report.selectedSubfield.name} papers`;
      if (report.name.endsWith(suffix)) report = { ...report, name: report.name.slice(0, -suffix.length) };
    }
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
    if (groups.length > 1) {
      const named = groups.map(group => groupPreset(group));
      if (named.every(preset => preset?.phrase)) return headlineTopicName(base) + " " + named.map(preset => preset.phrase).sort((left, right) => left.startsWith("in the ") - right.startsWith("in the ")).join(" ");
      if (named.some(preset => preset?.phrase)) {
        const custom = groups.filter((_, index) => !named[index]?.phrase).map(group => shortGroup(group, " or ", headlineTopicName));
        const phrases = named.filter(preset => preset?.phrase).map(preset => preset.phrase).sort((left, right) => /^in (?:the )?[A-ZÀ-Ý]/.test(left) - /^in (?:the )?[A-ZÀ-Ý]/.test(right));
        return headlineTopicName(base) + " mentioning " + custom.join(" and ") + " " + phrases.join(" ");
      }
      return headlineTopicName(base) + " matching " + groups.map(group => groupPreset(group)?.subject || "one of " + shortGroup(group, " or ", headlineTopicName)).join(" and ");
    }
    terms = groups[0] || [];
    const preset = JSON.stringify([...terms].sort()) === JSON.stringify(childrenPreset.split(", ").sort());
    const named = !terms.length || preset ? null : groupPreset(terms);
    return headlineTopicName(base) + (!terms.length ? "" : preset ? " in children" : named ? " " + (named.phrase || "mentioning " + named.subject) : " mentioning " + shortGroup(terms, " or ", headlineTopicName));
  }
  function queryOperatorCount(name, synonyms, include) {
    const clean = (value) => String(value).toLowerCase().replace(/[,|[\]{}()"'“”‘’:\\\x00-\x1f\x7f]/g, "").trim().replace(/\s+/g, " ");
    const topic = clean(name);
    return new Set(synonyms.map(clean).filter((term) => term && term !== topic)).size + normaliseGroups(include).reduce((sum, group) => sum + group.length, 0);
  }
  function presentReport(report) {
    if (report.understanding?.check && (report.evidence?.version !== 3 || report.papersKind !== "checked")) report = { ...report, understanding: { ...report.understanding, mode: "unavailable", check: null } };
    report = repairBoundedGrowth(report);
    const terms = groupsOf(report);
    const name = terms.length || report.period || report.from !== undefined ? baseTitle(report) + includeSuffix(terms) + (report.selectedSubfield ? `, ${report.selectedSubfield.name} papers` : "") + (report.period || report.from !== undefined ? ` · ${rangeLabel(reportRange(report))}` : "") : report.name;
    let sentence = report.headline?.replace(report.name, name);
    if (report.kpis && report.from !== undefined && Array.isArray(report.years)) {
      const range = reportRange(report), window = growthWindow(report);
      const topicName = headlineSubject(report, terms) + (report.selectedSubfield ? ` within ${report.selectedSubfield.name}` : "") + (report.authoredCodes?.length ? ` with authors in ${report.authoredLabel || report.authoredCodes.join(", ")}` : "") + (report.excludeTerms?.length ? ` excluding ${report.excludeTerms.join(" or ")}` : "");
      const prefix = range.to == null ? `Since ${range.from}, ` : `From ${range.from} to ${range.to}, `;
      const lastYear = Math.max(range.from, Math.min(range.to ?? Number(report.updated.slice(0,4)) - 1, Number(report.updated.slice(0,4)) - 1));
      const published = `In ${lastYear}, ${papers(report.kpis.lastYear)} ${report.kpis.lastYear === 1 ? "was" : "were"} published.`;
      const regional = report.regionalCounts && report.kpis.total > 0 && report.regionalCounts.gcc === 0 ? ` None ${range.to != null ? "came" : "come"} from the GCC.` : report.regionalCounts && report.kpis.total > 0 && report.regionalCounts.gcc / report.kpis.total < .05 ? ` Only ${papers(report.regionalCounts.gcc)} published ${periodPhrase(range)} ${range.to != null ? "came" : report.regionalCounts.gcc === 1 ? "comes" : "come"} from the GCC${report.regionalCounts.uae === 0 ? ", none from the UAE." : ` (${number(report.regionalCounts.uae)} from the UAE).`}` : "";
      const growth = primaryGrowth(report);
      if (window.growthStartCount === 0 && window.growthEndCount === 0 && report.kpis.total > 0) sentence = `Research on ${topicName} is very rare: only ${papers(report.kpis.total)} found ${periodPhrase(range)}.${regional}`;
      else if (isNewTopic(window) && Number.isFinite(window.growthEndCount)) sentence = `Research on ${topicName} is a new topic: from ${papers(window.growthStartCount)} in ${window.growthStartYear} to ${number(window.growthEndCount)} in ${window.growthEndYear}.${regional}`;
      else if (growth === null) sentence = `${prefix}there is not enough data to calculate annual growth for ${topicName}. ${published}${regional}`;
      else sentence = `${prefix}research on ${topicName} ${range.to == null ? "has been" : "was"} ${report.kpis.momentum.toLowerCase()} (${percent(growth)} a year${report.kpis.growthLabel === "5-year growth" ? " over " + window.growthStartYear + "–" + window.growthEndYear : ""}). ${published}${regional}`;
    } else if (sentence) {
      const subject = headlineSubject(report, terms);
      sentence = sentence.replace(/^Research on .+?(?= (?:is|has been|was) )/, "Research on " + subject)
        .replace(/^.+? is a new (?:research )?topic:/, "Research on " + subject + " is a new topic:");
      if (report.regionalCounts?.uae === 0) sentence = sentence.replace("from the GCC (0 from the UAE).", "from the GCC, none from the UAE.");
      sentence = sentence.replace(/([+−-]?)(\d+(?:\.\d+)?)%/g, (_, sign, value) => percent((sign === "-" || sign === "−" ? -1 : 1) * Number(value) / 100));
    }
    if (report.understanding?.check?.lowPrecision) sentence = "These counts match the search terms, but many papers may be off-topic. Narrow the search before drawing conclusions.";
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
    const evidenceReady=topic.evidence?.version===3 && topic.papersKind==="checked" && topic.understanding?.mode==="ai" && topic.understanding?.check;
    const expertRows=evidenceReady?topic.experts:[],paperRows=evidenceReady?topic.papers:[];
    const named = (items) => (items || []).filter((item) => String(item?.name || "").trim());
    const experts = named(expertRows), journals = named(topic.journals);
    $("experts").innerHTML = !experts.length ? `<li class="rank-empty">${evidenceReady ? "No experts passed the question check." : "Run a question to check its experts."}</li>` : experts.slice(0, expertsExpanded ? undefined : 5).map((item) => `<li><span class="rank-name">${item.openalexUrl ? `<a href="${escape(item.openalexUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.name)}</a>` : escape(item.name)}</span><span class="number">${number(item.count)}</span>${rankBar(item.count, experts)}</li>`).join("");
    $("experts-toggle").hidden = expertRows.length <= 5;
    $("experts-toggle").textContent = expertsExpanded ? "Show less" : "Show all";
    $("experts-toggle").setAttribute("aria-expanded", String(expertsExpanded));
    const maxCountry = Math.max(1, ...topic.countries.map((item) => item.count));
    $("countries").innerHTML = topic.countries.slice(0, countriesExpanded ? undefined : 5).map((item) => `<div class="country-row"><div class="row-heading"><span>${escape(item.name)}${item.gcc ? '<abbr class="gcc" title="Gulf Cooperation Council">GCC</abbr>' : ""}</span><span class="number">${number(item.count)}</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${item.count / maxCountry * 100}%"></div></div></div>`).join("");
    $("countries-toggle").hidden = topic.countries.length <= 5;
    $("countries-toggle").textContent = countriesExpanded ? "Show less" : "Show all";
    $("countries-toggle").setAttribute("aria-expanded", String(countriesExpanded));
    $("journals").innerHTML = !journals.length ? `<li class="rank-empty">Too few papers to rank journals yet.</li>` : journals.slice(0, journalsExpanded ? undefined : 5).map((item) => `<li><span class="rank-name">${escape(item.name)}</span><span class="number">${number(item.count)}</span>${rankBar(item.count, journals)}</li>`).join("");
    $("papers").innerHTML = paperRows.slice(0, papersExpanded ? undefined : 5).map((item) => `<article class="paper"><div class="paper-heading"><h3>${item.url ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>` : escape(item.title)}</h3><span class="number citations">${number(item.citations)} ${item.citations === 1 ? "citation" : "citations"}</span></div><p class="paper-meta">${escape(item.authors)}, ${escape(item.journal)}, ${item.year}</p></article>`).join("");
    for (const [id, items, expanded] of [["journals-toggle", topic.journals, journalsExpanded], ["papers-toggle", paperRows, papersExpanded]]) {
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

  function renderRefinements() {
    refineChoices = isSample ? [] : (topic.refinements || []).slice(0, 7);
    $("refine-bar").hidden = isSample;
    $("refine-chips").hidden = !refineChoices.length;
    $("refine-chips").innerHTML = refineChoices.map((choice, index) => {
      const description = choice.kind === "subfield" ? `Search only within ${choice.name}.` : choice.kind === "region" ? `Add ${window.TMM_SEARCH_PRESETS[choice.preset].label} terms. These match words in titles and abstracts, not where the authors work.` : `Add ${choice.term} as an alternative to the topic.`;
      const full = choice.kind === "subfield" ? `Only ${choice.name}${choice.label.match(/ · \d+%$/)?.[0] || ""}. ${description}` : description;
      return `<button class="chip" type="button" data-refine="${index}" title="${escape(full)}" aria-label="${escape(full)}"${busy ? " disabled" : ""}>${escape(choice.label)}</button>`;
    }).join("");
  }

  function renderUnderstandingLine() {
    const context = topic.understanding;
    const show = !isSample && (context || activeExclusions.length || activeAuthored.length);
    $("understanding-line").hidden = !show;
    if (!show) { $("understanding-line").textContent = ""; return; }
    const terms = topic.searchTerms || { name: baseTitle(topic), synonyms: topic.synonyms };
    const displaySynonyms = context?.labels?.synonyms || terms.synonyms;
    const parts = ["Understood: " + (context?.labels?.topic || terms.name) + (displaySynonyms.length ? " (" + displaySynonyms.join(", ") + ")" : "")];
    groupsOf(topic).forEach(group => {
      if (context?.place?.mode === "mentions" && parser.key(group) === parser.key(context.place.terms)) return;
      parts.push("about " + (groupPreset(group)?.subject || shortGroup(group, " or ")));
    });
    if (context?.place) parts.push(`${context.place.mode === "authored" ? "written in" : "mentioning"} ${context.place.label}`);
    else if (activeAuthored.length) parts.push("written in " + (topic.authoredLabel || activeAuthored.join(", ")));
    if (activeExclusions.length) parts.push("excluded " + (context?.labels?.exclusions || activeExclusions).join(", "));
    if (context?.mode === "unavailable" || context?.mode === "quick") parts.push("AI checks unavailable.");
    else if (context?.check) {
      const { matched, total } = context.check;
      parts.push(total ? `Checked: ${matched} of ${total} sample papers on-topic${matched / total < .7 ? " (low match)" : ""}.` : "No sample titles available to check.");
    } else parts.push("Search changed; not checked.");
    if (context?.check?.early && context?.check?.late) {
      const share = period => period.total ? Math.round(period.matched / period.total * 100) + "%" : "unavailable";
      parts.push("Earlier: " + share(context.check.early) + "; later: " + share(context.check.late));
    }
    $("understanding-line").textContent = parts.join(" · ");
  }

  function renderTopic() {
    $("report-stage").hidden = false;
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
    activeSubfield = topic.subfieldId || "";
    activeExclusions = topic.excludeTerms || []; activeAuthored = topic.authoredCodes || [];
    activeUnderstandingKey = topic.understanding?.key || topic.understandingKey || "";
    pickedPlace = null; advancedDirty = false;
    draftPlace = topic.understanding?.place || (topic.placeIds?.length?globalThis.TMM_PLACES.describe(topic.placeIds,topic.placeMode):null); manualDraft = !isSample;
    sentenceText = $("topic-input").value; draftTopic = sentenceText; draftErrors = []; draftNote = topic.understanding?.note || ""; draftLabels = []; showDraftFrom = reportRange(topic).from !== 2010;
    $("narrow-input").value = ""; narrowText = ""; narrowDraft = null;
    $("narrow-understood").innerHTML = ""; $("narrow-note").textContent = ""; $("narrow-note").hidden = true;
    syncOptions(true);
    renderSynonyms();
    const include = groupsOf(topic);
    const titleSuffix = topic.from !== undefined || topic.period ? " · " + rangeLabel(reportRange(topic)) : "";
    $("topic-name").textContent = titleCase(titleSuffix && topic.name.endsWith(titleSuffix) ? topic.name.slice(0, -titleSuffix.length) : topic.name);
    const range = reportRange(topic);
    const rangeText = rangeLabel(range, true);
    $("topic-meta").textContent = `${topic.field}, ${rangeText.toLowerCase()}`;
    renderUnderstandingLine();
    const parentName = parentDisplayName();
    $("back-parent").hidden = !topic.subtopicId && !include.length && !topic.subfieldId && !activeExclusions.length && !activeAuthored.length;
    $("back-parent").textContent = `Back to ${titleCase(parentName)}`;
    $("back-parent").href = reportHash({ ...topic, name: parentName, subtopicId: null,
      ...(!topic.subtopicId ? { includeTerms: [], includeGroups: undefined, excludeTerms: [], authoredCodes: [], understanding: null, understandingKey: null, searchTerms: { name: parentName, synonyms: topic.synonyms } } : {}) }, cacheOnlyView);
    if (topic.subfieldId && !topic.subtopicId) {
      $("back-parent").textContent = `Back to ${titleCase(baseTitle(topic) + includeSuffix(include))}`;
      $("back-parent").href = reportHash({ ...topic, subfieldId: undefined, selectedSubfield: undefined }, cacheOnlyView);
    }
    const predecessor = topic.refinementBack || refinementHistory.get(topic.id);
    if (predecessor) {
      $("back-parent").hidden = false;
      $("back-parent").textContent = `Back to ${predecessor.title}`;
      $("back-parent").href = predecessor.hash;
    }
    renderRefinements();
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
    const checked = !isSample && topic.evidence?.version === 3 && topic.papersKind === "checked" && topic.understanding?.mode === "ai" && topic.understanding?.check;
    $("papers-heading").textContent = "Key papers";
    $("papers-source-note").hidden = false;
    $("papers-source-note").textContent = checked ? "Checked by AI for this question · sorted by citations" : "Run a question to check its papers.";
    $("papers-period").textContent = checked ? "AI checked candidate titles against your question. Only direct matches are shown, sorted by citations. This is not a full-text review or an exhaustive ranking of all research." : `The papers other researchers cite most, published ${citedPeriod}.`;
    if (!isSample) {
      $("experts-check-note").hidden = false;
      $("experts-check-note").textContent = checked ? "Most active in this field · checked by AI" : "Run a question to check its experts.";
      if (checked) { $("experts-source-note").hidden = true; $("experts-note").textContent = "Authors ranked by their real OpenAlex paper counts for this field. Each shown author has at least one matching paper whose title passed the question check."; }
    }
    $("experts-check-note").hidden = isSample;
    const notices = checked ? (topic.evidence?.notices || []) : [];
    $("evidence-notice").hidden = !notices.length;
    $("evidence-notice").textContent = notices.join(" ") + (checked && (topic.evidence?.accepted < 3 || topic.experts.length < 3) ? " Try a more specific research phrase, population or year range." : "");
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
    $("no-results").hidden = !empty;
    $("report-content").hidden = empty;
    $("export-csv").disabled = empty || busy;
    if (empty) {
      // Never leave the previous report's suggestions behind on an empty result.
      $("suggested-synonyms").innerHTML = "";
      $("suggestions").hidden = true;
      return;
    }
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
    $("suggested-synonyms").innerHTML = suggestions.slice(0, 4).map((term) => `<button class="chip" type="button" data-suggest="${escape(term)}">${escape(term)}</button>`).join("");
    $("suggestions").hidden = !suggestions.length;
    $("topics-section").hidden = Boolean(topic.subtopicId) || !topic.subtopics.some((item) => Number.isFinite(item.late) && (Number.isFinite(item.growth) || item.growth === null));
    animateReport();
  }

  function synonyms() {
    return [...new Set($("synonyms-input").value.split(",").map((term) => term.trim()).filter(Boolean))];
  }

  function renderSynonyms() {
    $("synonym-chips").innerHTML = synonyms().map((term) => `<button class="chip" type="button" data-remove="${escape(term)}" aria-label="Remove synonym ${escape(term)}">${escape(term)} ×</button>`).join("");
    renderUnderstood();
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
    const subfieldId = entry.subfieldId || parts.find(part => part.startsWith("subfield:"))?.slice(9);
    const synonyms = parts.filter((part) => !part.startsWith("places:") && !part.startsWith("exclude:") && !part.startsWith("authored:") && !part.startsWith("subfield:") && !part.startsWith("include:") && !part.startsWith("includeGroups:") && !part.startsWith("primary_topic:") && !part.startsWith("since:") && !part.startsWith("range:"));
    let includeTerms = [];
    let includeGroups, excludeTerms = [], authoredCodes = [],placeIds=entry.placeIds || [],placeMode=entry.placeMode || "authored";
    try {
      const savedPlace=parts.find(part=>part.startsWith("places:"))?.match(/^places:(\[.*\]):(authored|mentions)$/);
      if(savedPlace && !placeIds.length){placeIds=globalThis.TMM_PLACES.normaliseIds(JSON.parse(savedPlace[1]));placeMode=savedPlace[2];}
      excludeTerms = entry.excludeTerms || JSON.parse(parts.find(part => part.startsWith("exclude:"))?.slice(8) || "[]");
      authoredCodes = entry.authoredCodes || JSON.parse(parts.find(part => part.startsWith("authored:"))?.slice(9) || "[]");
      if (includePart) includeTerms = JSON.parse(includePart.slice(8));
      if (groupsPart) {
        const savedGroups = entry.includeGroups || entry.searchTerms?.includeGroups;
        includeGroups = window.TMM_PRESET_IDENTITIES.expand(savedGroups || JSON.parse(groupsPart.slice(14)));
      }
    } catch { if (groupsPart) return "#search"; }
    return reportHash({ ...entry, from, to, subtopicId, subfieldId, includeTerms, includeGroups, excludeTerms, authoredCodes,placeIds,placeMode,searchTerms: { name, synonyms, includeTerms, includeGroups } }, true);
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
    const visible = library.filter((item) => !(item.from !== undefined && (item.from !== 2010 || item.to != null)) && !item.id.includes("|range:") && !(item.period && item.period !== 2010) && !item.id.includes("|since:") && !item.variant && !item.excludeTerms?.length && !item.authoredCodes?.length && !/\|(exclude:|authored:|places:)/.test(item.id) && !item.subfieldId && !item.id.includes("|subfield:") && !groupsOf(item).length && !item.id.includes("|include:") && !item.id.includes("|includeGroups:"));
    const source = [...new Map((libraryTab === "my" ? myLibrary : visible).map(repairBoundedSummary).map((item) => [item.id, item])).values()];
    const lookup = new Map([...library, ...source].map((item) => [item.id, item]));
    const baseId = (id) => id.split("|").filter((part) => !/^(include:|includeGroups:|exclude:|authored:|subfield:|since:|range:|primary_topic:)/.test(part)).join("|");
    const type = (item) => item.subtopicId || item.id.includes("|primary_topic:") ? "sub-topic" : item.variant || /\|(include:|includeGroups:|exclude:|authored:|subfield:|since:|range:)/.test(item.id) || item.from !== undefined && (item.from !== 2010 || item.to != null) ? "variant" : item.parent ? "sub-topic" : "topic";
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
    if (report.subfieldId) params.set("subfield", report.subfieldId);
    groupsOf(report).forEach((group, index) => params.set(index ? "include" + (index + 1) : "include", group.join(",")));
    if (report.subtopicId) {
      params.set("sub", report.subtopicId);
      params.set("title", baseTitle(report));
    }
    if (report.excludeTerms?.length) params.set("exclude", JSON.stringify(report.excludeTerms));
    if(report.placeIds?.length){params.set("places",globalThis.TMM_PLACES.tokens(report.placeIds).join(","));params.set("placeMode",report.placeMode);}
    else if (report.authoredCodes?.length) params.set("authored", report.authoredCodes.join(","));
    if (report.understanding?.key || report.understandingKey) params.set("understanding", report.understanding?.key || report.understandingKey);
    if (cacheOnly) params.set("cache", "only");
    return "#" + params.toString();
  }

  function persistMyLibrary() {
    try { localStorage.setItem(myLibraryKey, JSON.stringify(myLibrary)); return true; }
    catch { notify("Your library could not be saved in this browser. Allow browser storage and try again.", true); return false; }
  }

  function rememberReport(saveSummary = true) {
    let saved = true;
    // A report with no papers is not worth keeping in My library.
    if (saveSummary && topic.kpis.total > 0) {
      const range = reportRange(topic);
      const lastYear = Math.min(range.to ?? Number(topic.updated.slice(0, 4)) - 1, Number(topic.updated.slice(0, 4)) - 1);
      const sparkStartYear = Math.max(range.from, Math.min(...topic.years.map((item) => item.year)));
      const summary = { id: topic.id, name: topic.name, parent: topic.parent || null, field: topic.field,
        ...(topic.placeIds?.length?{placeIds:topic.placeIds,placeMode:topic.placeMode}:{}),...(topic.excludeTerms?.length ? {excludeTerms:topic.excludeTerms} : {}), ...(topic.authoredCodes?.length ? {authoredCodes:topic.authoredCodes} : {}), ...(topic.understanding?.key ? {understandingKey:topic.understanding.key} : {}),
        ...(topic.subfieldId ? { subfieldId: topic.subfieldId, selectedSubfield: topic.selectedSubfield, searchTerms: topic.searchTerms } : {}),
        ...(topic.refinementBack ? { refinementBack: topic.refinementBack } : {}),
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

  // Estimated progress: the work has no exact steps, so the bar eases toward 92% and jumps to 100% when the report arrives.
  let progressTimer = null, progressStart = 0, progressSlow = true;
  function showProgress(loading) {
    try { drawProgress(loading); } catch { /* The bar is cosmetic and must never block a search. */ }
  }
  function drawProgress(loading) {
    const box = document.getElementById("search-progress");
    if (!box || typeof box.querySelector !== "function") return;
    const fill = box.querySelector(".search-progress-fill"), label = box.querySelector(".search-progress-label");
    clearInterval(progressTimer); progressTimer = null;
    const paint = percent => {
      const value = Math.max(0, Math.min(100, Math.round(percent)));
      fill.style.width = value + "%"; box.setAttribute("aria-valuenow", String(value));
      const left = Math.max(3, Math.round((progressSlow ? 40 : 12) * (1 - value / 100)));
      label.textContent = value >= 100 ? "Done" : value + "% · " + (value < 25 ? "Understanding your question" : value < 65 ? "Collecting papers" : "Checking relevance") + " · about " + left + " s left (estimate)";
    };
    if (loading) {
      progressStart = Date.now(); progressSlow = true;
      box.hidden = false; paint(2);
      progressTimer = setInterval(() => paint(92 * (1 - Math.exp(-(Date.now() - progressStart) / 15000))), 300);
      if (progressTimer && progressTimer.unref) progressTimer.unref();
    } else if (!box.hidden) {
      paint(100);
      setTimeout(() => { if (!progressTimer) box.hidden = true; }, 600);
    }
  }
  function setLoading(loading) {
    showProgress(loading);
    if (loading) $("report-stage").hidden = false;
    busy = loading;
    setPresentationLoading(loading);
    renderSaveState();
    $("export-csv").disabled = loading || topic.kpis.total === 0;
    $("search-form").toggleAttribute("aria-busy", loading);
    $("narrow-form").toggleAttribute("aria-busy", loading);
    document.querySelectorAll('#search-form input, #search-form select, #search-form button, #suggested-synonyms button, #subtopics button, #refine-chips button, #narrow-form input, #narrow-form button').forEach((control) => { control.disabled = loading; });
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
    if (location.hash === "#new") {
      if (busy) { requestController?.abort(); requestVersion++; setLoading(false); }
      $("status").hidden = true;
      $("topic-input").value = ""; $("synonyms-input").value = "";
      $("from-input").value = "2010"; $("to-input").value = "";
      setIncludeGroups([]);
      activeSubfield = ""; activeExclusions = []; activeAuthored = []; activeUnderstandingKey = "";
      draftPlace = null; manualDraft = false;
      draftTopic = ""; sentenceText = ""; draftErrors = []; draftNote = ""; draftLabels = []; showDraftFrom = false;
      syncOptions(true); renderSynonyms(); renderUnderstood();
      $("report-stage").hidden = true;
      $("report-source").textContent = ""; $("report-freshness").textContent = "";
      $("data-notice").textContent = "Data from OpenAlex. Searches are cached anonymously to keep the tool free.";
      return;
    }
    $("report-stage").hidden = false;
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
    const subfield = params.has("subfield") ? params.get("subfield").match(/^(?:https:\/\/openalex\.org\/subfields\/)?([1-9][0-9]{3})$/)?.[1] : "";
    if (params.getAll("subfield").length > 1 || params.has("subfield") && !subfield) { notify("Choose a subfield from the report and try again.", true); return; }
    let excludeTerms;
    try { excludeTerms = JSON.parse(params.get("exclude") || "[]"); if (!Array.isArray(excludeTerms) || params.getAll("exclude").length > 1 || params.getAll("authored").length > 1 || params.getAll("places").length>1 || params.getAll("placeMode").length>1 || !["authored","mentions"].includes(params.get("placeMode") || "authored")) throw new Error(); globalThis.TMM_PLACES.normaliseIds(params.get("places")?.split(",") || []); }
    catch { notify("Use valid excluded terms and country codes, then try again.", true); return; }
    search(name, terms, id ? { id, name: params.get("title") || id } : null, true, params.get("cache") === "only", include, params.get("from") ?? params.get("period") ?? "2010", params.get("to") ?? "", subfield, null, {placeIds:params.get("places")?.split(",") || [],placeMode:params.get("placeMode") || "authored",excludeTerms,authoredCodes:params.get("authored") ? params.get("authored").split(",") : [],understandingKey:params.get("understanding") || ""});
  }

  let lastSearchOk = false;
  async function search(name = $("topic-input").value, terms = synonyms(), selection = null, fromRoute = false, cacheOnly = false, include = readIncludeGroups(), from = $("from-input").value, to = $("to-input").value, subfield = activeSubfield, refinementBack = null, options = {}) {
    if (busy) return;
    const useAI = typeof options.sentence === "string" && (window.AI_SEARCH_ENABLED !== false || Boolean(options.mode));
    const exclusions = options.excludeTerms ?? activeExclusions, authored = options.authoredCodes ?? activeAuthored;
    const placeIds=options.placeIds ?? draftPlace?.ids ?? [],placeMode=options.mode || options.placeMode || draftPlace?.mode || "authored";
    const understandingKey = options.understandingKey ?? activeUnderstandingKey;
    if (!useAI || options.mode) {
    if (!name.trim()) { notify("Enter a research topic and try again.", true); return; }
    const currentYear = new Date().getFullYear();
    if (!/^\d{4}$/.test(String(from)) || Number(from) < 2000 || Number(from) > currentYear) { $("search-options").open = true; notify(`Enter a From year between 2000 and ${currentYear}.`, true); return; }
    if (to != null && to !== "" && (!/^\d{4}$/.test(String(to)) || Number(to) < 2000 || Number(to) > currentYear)) { $("search-options").open = true; notify(`Enter a To year between 2000 and ${currentYear}, or leave it empty to include papers up to today.`, true); return; }
    if (to != null && to !== "" && Number(from) > Number(to)) { $("search-options").open = true; notify("The From year must be the same as or earlier than the To year.", true); return; }
    if (!checkIncludeLimits(name, terms, include, from, to, selection, subfield, exclusions, authored,placeIds,placeMode)) return;
    const normalizedInclude = normaliseGroups(include);
    // Keep the original single-group request serialization, including preset order.
    include = normalizedInclude.length === 1 ? [groupsOf(include).find(group => normaliseGroups([group]).length).map(term => term.trim()).filter(Boolean)] : normalizedInclude;
    }
    $("search-clarification").hidden = true;
    pendingClarification = null;
    setLoading(true);
    vanishQuery();
    const version = ++requestVersion;
    lastSearchOk = false;
    // When the AI check cannot run or cannot finish, a plain keyword search still answers the question.
    const plainFallback = reason => {
      if (!useAI || options.mode || options.clarification || !String(name).trim()) return false;
      setTimeout(async () => {
        await search(name, terms, selection, fromRoute, cacheOnly, include, from, to, subfield, refinementBack, { ...options, sentence: undefined });
        if (lastSearchOk) notify("The AI check could not run (" + reason + "), so this is a plain keyword search. Counts may include off-topic papers.", true);
      }, 0);
      return true;
    };
    notify(useAI ? "Understanding and checking your search…" : queryOperatorCount(name, terms, include) > 5 ? "This search is more complex, so it takes a little longer…" : "Loading research data…", true);
    const controller = new AbortController();
    requestController = controller;
    const timeout = setTimeout(() => controller.abort(), useAI ? 110000 : 30000);
    try {
      const url = new URL(window.WORKER_URL.replace(/\/$/, "") + (useAI ? "/api/search" : "/api/topic"));
      url.searchParams.set("q", name.trim());
      url.searchParams.set("syn", terms.join(","));
      url.searchParams.set("from", String(from));
      if (to != null && to !== "") url.searchParams.set("to", String(to));
      include.forEach((group, index) => url.searchParams.set(index ? "include" + (index + 1) : "include", group.join(",")));
      if (cacheOnly) url.searchParams.set("cache", "only");
      if (subfield) url.searchParams.set("subfield", subfield);
      if (selection) {
        url.searchParams.set("subtopic", selection.id);
        url.searchParams.set("subtopicName", selection.name);
        if (selection.parent) url.searchParams.set("parent", selection.parent);
        if (selection.parentName) url.searchParams.set("parentName", selection.parentName);
      }
      if (exclusions.length) url.searchParams.set("exclude", JSON.stringify(exclusions));
      if(placeIds.length){url.searchParams.set("places",globalThis.TMM_PLACES.tokens(placeIds).join(","));url.searchParams.set("placeMode",placeMode);}
      else if (authored.length) url.searchParams.set("authored", authored.join(","));
      if (understandingKey) url.searchParams.set("understanding", understandingKey);
      const current = options.mode ? { name, synonyms: terms, includeGroups: groupsOf(include), from: Number(from), to: to == null || to === "" ? null : Number(to), excludeTerms: exclusions, authoredCodes: authored,placeIds,placeMode,subfieldId: subfield, ...(selection ? {subtopicId:selection.id,subtopicName:selection.name} : {}) } : undefined;
      if (useAI) url.search = "";
      let sentenceToSend = options.sentence;
      if (useAI && !options.mode && !options.clarification && typeof sentenceToSend === "string") sentenceToSend = composeSentence(sentenceToSend, from, to);
      let response;
      try { response = await fetch(url, { signal: controller.signal, ...(useAI ? { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({sentence:sentenceToSend,...(draftPlace || options.placeMode?{placeMode}:{}), ...(options.clarification ? {clarification:options.clarification} : {}), ...(options.mode ? {mode:options.mode,current} : {})}) } : {}) }); }
      catch { throw new Error(connectionError()); }
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The data service returned an unreadable report. Try again later."); }
      if (!response.ok) {
        throw Object.assign(new Error(typeof data.message === "string" && data.message.trim() ? data.message : "The data service could not complete the search. Try again later."), { code: data.error, unmatched: Array.isArray(data.failingCheck?.missing) ? data.failingCheck.missing.filter(word => typeof word === "string").slice(0, 4) : [] });
      }
      if (version !== requestVersion) return;
      if (useAI && data.papersKind === "unavailable" && plainFallback("the paper check did not finish")) return;
      if (useAI && data.planOnly) {
        pendingClarification = null; $("search-clarification").hidden = true;
        $("report-stage").hidden = true; $("papers").innerHTML = ""; $("experts").innerHTML = "";
        const plan=data.plan,groups=(plan.includeGroups || []).map(group=>group.preset ? window.TMM_SEARCH_PRESETS[group.preset].label : group.terms.join(" or "));
        const places=(plan.place?.codes || []).map(code=>new Intl.DisplayNames(["en"],{type:"region"}).of(code));
        const summary=[plan.topic,...groups.map(group=>"About: "+group),...(places.length?["Place: "+places.join(", ")]:[]),"Since "+plan.years.from,...(plan.years.to?["Until "+plan.years.to]:[]),...(plan.excludeTerms?.length?["Excluding: "+plan.excludeTerms.join(", ")]:[])].join(" · ");
        notify("Search plan: "+summary+". "+data.message,true);
        return;
      }
      if (useAI && data.clarification) {
        pendingClarification = {sentence:options.sentence, ...data.clarification};
        $("report-stage").hidden = true;
        $("search-clarification").innerHTML = '<span id="clarification-question">'+escape(data.clarification.question)+'</span>' + (data.clarification.options || []).map((option,index)=>'<button type="button" data-clarify="'+index+'">'+escape(option.label)+'</button>').join("");
        $("search-clarification").hidden = false;
        clearTimeout(noticeTimer); $("status").hidden = true;
        if (!data.clarification.options?.length) $("topic-input").focus();
        return;
      }
      if (!useAI && include.length > 1 && window.TMM_PRESET_IDENTITIES.encode(normaliseGroups(groupsOf(data))) !== window.TMM_PRESET_IDENTITIES.encode(include)) throw new Error("The data service did not retain every include group. Update the Worker and try again.");
      if (!useAI && subfield && data.subfieldId !== subfield) throw new Error("The data service did not retain the subfield. Update the Worker and try again.");
      topic = presentReport({ ...data, searchTerms: useAI ? data.searchTerms : { name: name.trim(), synonyms: terms, ...includeFields(groupsOf(data)) } });
      const savedPredecessor = myLibrary.find(entry => entry.id === topic.id)?.refinementBack;
      const predecessor = refinementBack || refinementHistory.get(topic.id) || savedPredecessor;
      if (predecessor) { topic.refinementBack = predecessor; refinementHistory.set(topic.id, predecessor); }
      isSample = false;
      lastSearchOk = true;
      cacheOnlyView = cacheOnly;
      if (!cacheOnly || data.cached === false) { libraryDirty = true; libraryRevision++; }
      renderTopic();
      const saved = rememberReport();
      if (!fromRoute) location.hash = reportHash(topic, cacheOnlyView);
      route(false);
      if (topic.kpis.total === 0) { clearTimeout(noticeTimer); $("status").hidden = true; }
      else if (saved) notify("Research data loaded.");
    } catch (error) { if (version === requestVersion && (!error.code || error.code === "rephrase_required") && plainFallback(error.code === "rephrase_required" ? "the question could not be fully interpreted" : String(error.message || "service problem").replace(/[.\s]+$/, "").slice(0, 120))) { /* plain search runs next */ } else if (version === requestVersion) { if(error.code === "ai_unavailable" || error.code === "rephrase_required") $("report-stage").hidden = true; notify((error.message || "The data service returned an unreadable report. Try again later.") + (error.code === "rephrase_required" && error.unmatched?.length ? " Not matched: " + error.unmatched.join(", ") + "." : ""), true); } }
    finally {
      clearTimeout(timeout);
      if (version === requestVersion) setLoading(false);
    }
  }

  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    if ($("topic-input").value !== sentenceText) previewSentence();
    if (window.AI_SEARCH_ENABLED !== false && !advancedDirty) {
      if (!$("topic-input").value.trim()) { notify("Add a research topic, then try again.", true); return; }
      draftErrors = []; renderUnderstood();
      search(draftTopic, synonyms(), null, false, false, readIncludeGroups(), $("from-input").value, $("to-input").value, activeSubfield, null, {sentence:$("topic-input").value});
      return;
    }
    if (draftErrors.length) { notify(draftErrors[0], true); return; }
    if (!draftTopic.trim()) { notify("Add a research topic, then try again.", true); return; }
    renderSynonyms();
    search(draftTopic, synonyms());
  });
  try { buildPlaceSelect(); } catch { /* See syncPlaceSelect. */ }
  try {
    const aiToggle = document.getElementById("ai-toggle");
    let saved = null;
    try { saved = localStorage.getItem("tmm-ai-check"); } catch { /* Storage may be unavailable. */ }
    if (saved === "off") window.AI_SEARCH_ENABLED = false;
    if (aiToggle && typeof aiToggle.addEventListener === "function") {
      aiToggle.checked = window.AI_SEARCH_ENABLED !== false;
      aiToggle.addEventListener("change", () => {
        window.AI_SEARCH_ENABLED = aiToggle.checked;
        try { localStorage.setItem("tmm-ai-check", aiToggle.checked ? "on" : "off"); } catch { /* Optional convenience. */ }
        notify(aiToggle.checked ? "AI check on: experts and key papers are checked for relevance." : "AI check off: quick counts only, no checked experts or key papers.");
      });
    }
  } catch { /* The switch is optional. */ }
  document.getElementById("place-select")?.addEventListener?.("change", event => {
    if (busy) { syncPlaceSelect(); return; }
    pickedPlace = event.target.value === "custom" ? null : event.target.value;
    applyPickedPlace(); draftErrors = []; renderUnderstood();
  });
  $("topic-input").addEventListener("input", () => {
    $("search-clarification").hidden = true; pendingClarification = null;
    previewSentence(true);
  });
  $("narrow-input").addEventListener("input", () => { if (!busy) previewNarrow(); });
  $("narrow-form").addEventListener("submit", event => {
    event.preventDefault();
    if (busy || isSample) return;
    const merged = previewNarrow($("narrow-input").value !== narrowText);
    if (merged.errors.length) { notify(merged.errors[0], true); return; }
    if (merged.noChange) { $("narrow-note").textContent = merged.note || "Those details are already included. Add something else to narrow the search."; $("narrow-note").hidden = false; return; }
    const back = { hash: reportHash(topic, cacheOnlyView), title: $("topic-name").textContent };
    search(merged.topic, merged.synonyms, topic.subtopicId ? { id: topic.subtopicId, name: baseTitle(topic) } : null, false, false, merged.includeGroups, merged.from, merged.to, topic.subfieldId || "", back);
  });
  $("synonyms-input").addEventListener("input", () => { manualDraft = true; advancedDirty = true; renderSynonyms(); syncOptions(); });
  for (const id of [...includeInputIds, "from-input", "to-input"]) $(id).addEventListener("input", () => {
    if (id !== "from-input" && id !== "to-input") { manualDraft = true; advancedDirty = true; }
    const index = includeInputIds.indexOf(id);
    if (index >= 0) { editingGroups[index] = true; syncIncludePresets(); }
    syncOptions();
    clearIncludeError();
    draftErrors = []; draftNote = "";
    renderUnderstood();
  });
  includeInputIds.forEach((id, index) => {
    $("edit-include-" + (index + 1)).addEventListener("click", () => {
      if (busy) return;
      editingGroups[index] = true;
      syncIncludePresets();
      $(id).focus();
    });
  });
  // Like the region chips, Children 0–9 fills the next empty group and never overwrites one.
  $("children-preset").addEventListener("click", () => { if (!busy) addIncludePreset("children"); });
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
    if (button.dataset.clarify !== undefined) {
      if (busy || !pendingClarification || $("topic-input").value !== pendingClarification.sentence) return;
      const pending=pendingClarification,index=Number(button.dataset.clarify);
      if (!Number.isInteger(index) || !pending.options[index] || !pending.key) return;
      search(undefined, undefined, null, false, false, undefined, undefined, undefined, undefined, null,
        {sentence:pending.sentence,clarification:{key:pending.key,option:index}});
      return;
    }
    if (button.dataset.spellWord !== undefined) {
      if (busy) return;
      $("topic-input").value = window.TMM_SPELL.apply($("topic-input").value, button.dataset.spellWord, button.dataset.spellTo);
      previewSentence(true);
      $("topic-input").focus();
      return;
    }
    if (button.dataset.draftRemove !== undefined) {
      manualDraft = true;
      if (busy) return;
      const [kind, rawIndex] = button.dataset.draftRemove.split(":"), index = Number(rawIndex);
      if (kind === "topic") { draftTopic = ""; $("topic-input").value = ""; sentenceText = ""; }
      if (kind === "group") { const groups = readIncludeGroups(); groups.splice(index, 1); setIncludeGroups(groups); }
      if (kind === "synonym") $("synonyms-input").value = synonyms().filter((_, i) => i !== index).join(", ");
      if (kind === "from") { $("from-input").value = "2010"; showDraftFrom = false; }
      if (kind === "to") $("to-input").value = "";
      if (kind === "subfield") activeSubfield = "";
      if (kind === "exclude") activeExclusions = activeExclusions.filter((_, i) => i !== index);
      if (kind === "place" && draftPlace?.ids) {
        $("topic-input").value=globalThis.TMM_PLACES.resolve(activeUnderstandingKey && topic.understanding?.sentence || $("topic-input").value).withoutPlaces;
        pickedPlace = null;
        previewSentence(true);$("topic-input").focus();return;
      }
      if (kind === "place") {
        if (draftPlace?.mode === "mentions") setIncludeGroups(readIncludeGroups().filter(group => parser.key(group) !== parser.key(draftPlace.terms)));
        activeAuthored = []; draftPlace = null; pickedPlace = null;
      }
      draftErrors = []; renderSynonyms(); renderUnderstood(); $("topic-input").focus();
      return;
    }
    if (button.dataset.narrowRemove !== undefined) {
      if (busy || !narrowDraft) return;
      const [kind, rawIndex] = button.dataset.narrowRemove.split(":"), index = Number(rawIndex);
      if (kind === "topic") narrowDraft.topic = "";
      if (kind === "group") { narrowDraft.groups.splice(index, 1); narrowDraft.includeGroups = narrowDraft.groups.map(item => item.terms); }
      if (kind === "years") { narrowDraft.explicitRange = false; narrowDraft.from = 2010; narrowDraft.to = null; narrowDraft.errors = []; }
      previewNarrow(false); $("narrow-input").focus();
      return;
    }
    if (button.dataset.placeToggle !== undefined) {
      if (busy || !draftPlace) return;
      const other = draftPlace.mode === "authored" ? "mentions" : "authored";
      // Only the choice changes. Measure momentum then runs the full AI-checked search, with experts and key papers.
      pickedMode = other;
      draftPlace = { ...draftPlace, mode: other };
      activeAuthored = other === "authored" ? draftPlace.codes : [];
      renderUnderstood();
      notify("Press Measure momentum to search with this meaning.");
      return;
    }
    if (button.dataset.refine !== undefined) {
      if (busy || isSample) return;
      const choice = refineChoices[Number(button.dataset.refine)];
      if (!choice) return;
      const terms = topic.searchTerms || { name: topic.name, synonyms: topic.synonyms };
      const groups = groupsOf(topic).map(group => [...group]);
      const alternatives = [...terms.synonyms];
      let subfield = topic.subfieldId || "";
      if (choice.kind === "subfield") subfield = choice.id;
      else if (choice.kind === "region") groups.push([...window.TMM_SEARCH_PRESETS[choice.preset].terms]);
      else alternatives.push(choice.term);
      const back = { hash: reportHash(topic, cacheOnlyView), title: $("topic-name").textContent };
      search(terms.name, alternatives, topic.subtopicId ? { id: topic.subtopicId, name: baseTitle(topic) } : null, false, false, groups, reportRange(topic).from, reportRange(topic).to, subfield, back);
      return;
    }
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
    const subfieldColumn = topic.subfieldId ? `,${topic.subfieldId},"${topic.selectedSubfield.name.replaceAll('"', '""')}"` : "";
    const jsonCell = value => ',"' + JSON.stringify(value).replaceAll('"', '""') + '"';
    const filtersColumn = (topic.excludeTerms?.length ? jsonCell(topic.excludeTerms) : "") + (topic.authoredCodes?.length ? jsonCell(topic.authoredCodes) : "");
    const csv = "sample_data,range,year,papers" + (groups.length > 1 ? ",include_groups" : "") + (topic.subfieldId ? ",subfield_id,subfield" : "") + (topic.excludeTerms?.length ? ",exclude_terms" : "") + (topic.authoredCodes?.length ? ",authored_codes" : "") + "\r\n" + topic.years.filter((item) => item.year >= range.from && (range.to === null || item.year <= range.to)).map((item) => `${isSample},${rangeLabel(range, true)},${item.year},${item.count}${groupColumn}${subfieldColumn}${filtersColumn}`).join("\r\n") + "\r\n";
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
  if (!isSample && location.hash !== "#new") {
    rememberReport(myLibrary.some((entry) => entry.id === topic.id));
    if (!location.hash || location.hash === "#search") history.replaceState(null, "", reportHash(topic, cacheOnlyView));
  }
  route();
})();
