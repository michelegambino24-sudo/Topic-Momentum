/* Landing page: a self-playing demo built only from saved, real data. It never calls the Worker or the AI. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const presets = window.TMM_SEARCH_PRESETS || {};
  let reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const number = (value) => new Intl.NumberFormat("en-US").format(Math.round(value));
  const percent = (value) => `${value < 0 ? "−" : "+"}${Math.abs(value * 100).toFixed(Math.abs(value * 100) >= 10 ? 0 : 1)}%`;
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const appLink = (params) => "app.html#" + new URLSearchParams(params).toString();

  // Saved demo report (tools/save-demo.mjs) or, until it exists, real yearly counts from landing-example.js.
  function demoData() {
    if (window.TMM_DEMO?.years?.length) return window.TMM_DEMO;
    const example = window.LANDING_EXAMPLES?.topics?.find((item) => item.id === "neurotechnology");
    if (!example) return null;
    const years = Object.entries(example.years).map(([year, count]) => ({ year: Number(year), count }));
    const partial = window.LANDING_EXAMPLES.partialYear;
    const last = partial - 1, first = last - 5;
    const at = (year) => years.find((item) => item.year === year)?.count || 0;
    const growth = at(first) ? (at(last) / at(first)) ** (1 / 5) - 1 : null;
    return {
      question: "How fast is neurotechnology research growing?",
      chips: ["Topic: neurotechnology"],
      title: "Neurotechnology",
      from: 2010, partialYear: partial, years, fetched: window.LANDING_EXAMPLES.fetched,
      kpis: { total: years.reduce((sum, item) => sum + item.count, 0), lastYear: at(last), lastYearLabel: `Papers in ${last}`, growth, growthLabel: `Growth ${first}–${last}` },
      insights: [
        growth === null ? null : { label: "Momentum", text: `Growing ${percent(growth)} a year since ${first}` },
        { label: "Scale", text: `${number(at(last))} papers in ${last}, ${(at(last) / Math.max(1, at(first))).toFixed(1)}× more than in ${first}` }
      ].filter(Boolean),
      open: appLink({ topic: "neurotechnology" })
    };
  }

  const examples = [
    { title: "Epigenetics in pregnancy", note: "Health research with a clear growth story", params: { topic: "epigenetics", include: (presets.pregnancy?.terms || ["pregnancy", "pregnant", "prenatal"]).join(",") } },
    { title: "Neurotechnology in children", note: "Emerging technology for early childhood", params: { topic: "neurotechnology", include: (presets.children?.terms || ["children", "child"]).join(",") } },
    { title: "Agentic AI", note: "One of the fastest-rising topics right now", params: { topic: "agentic ai" } }
  ];
  $("example-grid").innerHTML = examples.map((item) => `<a class="example-card" href="${escape(appLink(item.params))}"><strong>${escape(item.title)}</strong><span>${escape(item.note)}</span><em aria-hidden="true">Open report</em></a>`).join("");

  const data = demoData();
  if (!data) { $("demo-window").hidden = true; return; }
  $("demo-open").href = data.open;
  $("demo-source").textContent = `Demo: a saved search from ${new Date(data.fetched + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}. Real counts; numbers in the live tool update weekly.`;
  $("demo-summary").textContent = `Demo search: ${data.question} Result: ${data.title}. ${data.insights.map((item) => item.text).join(". ")}.`;

  function chartSVG() {
    const years = data.years.filter((item) => item.year >= data.from);
    const width = 640, height = 200, left = 8, right = 8, top = 16, bottom = 24;
    const max = Math.max(1, ...years.map((item) => item.count));
    const x = (i) => left + i * (width - left - right) / Math.max(1, years.length - 1);
    const y = (count) => height - bottom - count / max * (height - top - bottom);
    const points = years.map((item, i) => [x(i), y(item.count), item]);
    const partialIndex = points.findIndex(([, , item]) => item.year === data.partialYear);
    const complete = partialIndex >= 0 ? points.slice(0, partialIndex) : points;
    const line = complete.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    const area = complete.length > 1 ? `${line} L${complete.at(-1)[0].toFixed(1)},${height - bottom} L${complete[0][0].toFixed(1)},${height - bottom} Z` : "";
    const dashed = partialIndex > 0 ? `<path class="demo-line demo-partial" d="M${complete.at(-1)[0].toFixed(1)},${complete.at(-1)[1].toFixed(1)} L${points[partialIndex][0].toFixed(1)},${points[partialIndex][1].toFixed(1)}"/>` : "";
    const label = (i) => `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === years.length - 1 ? "end" : "middle"}">${years[i].year}</text>`;
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="presentation"><path class="demo-area" d="${area}"/><path class="demo-line" pathLength="1" d="${line}"/>${dashed}<g class="demo-axis">${label(0)}${label(Math.floor((years.length - 1) / 2))}${label(years.length - 1)}</g></svg>`;
  }

  const kpis = [
    ["Papers", data.kpis.total, number],
    [data.kpis.growthLabel || "Growth", data.kpis.growth, (value) => value === null ? "New topic" : percent(value)],
    [data.kpis.lastYearLabel || "Papers last year", data.kpis.lastYear, number]
  ];

  function renderStatic() {
    $("demo-typed").textContent = data.question;
    $("demo-chips").innerHTML = data.chips.map((chip) => `<span class="demo-chip is-in">${escape(chip)}</span>`).join("");
    $("demo-title").textContent = data.title;
    $("demo-kpis").innerHTML = kpis.map(([label, value, format]) => `<div><span>${escape(label)}</span><strong data-value="${value ?? ""}">${escape(format(value))}</strong></div>`).join("");
    $("demo-chart").innerHTML = chartSVG();
    $("demo-insights").innerHTML = data.insights.map((item, index) => `<li data-index="${index}"><span>${escape(item.label)}</span>${escape(item.text)}</li>`).join("");
  }

  // Timeline in milliseconds. Every step runs once per play; reduced motion shows the finished result.
  let timers = [], running = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const root = $("demo-window"), steps = [...document.querySelectorAll("#demo-steps li")];
  const setStep = (n) => steps.forEach((item) => item.classList.toggle("is-active", Number(item.dataset.step) === n));

  function countUp(node, target, format, duration = 700) {
    if (!Number.isFinite(target)) { node.textContent = format(target ?? null); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3;
      node.textContent = format(t < 1 ? target * eased : target);
      if (t < 1 && running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function play() {
    timers.forEach(clearTimeout); timers = []; running = true;
    renderStatic();
    root.className = "demo is-playing";
    if (reduceMotion) { root.classList.add("is-done", "show-chips", "show-report", "show-finale"); document.querySelectorAll("#demo-insights li").forEach((li) => li.classList.add("is-in")); steps.forEach((item) => item.classList.add("is-active")); return; }
    $("demo-typed").textContent = "";
    $("demo-chips").innerHTML = "";
    setStep(1);
    const text = data.question, typeStart = 500, perChar = 42;
    [...text].forEach((_, i) => later(typeStart + i * perChar, () => { $("demo-typed").textContent = text.slice(0, i + 1); }));
    const typed = typeStart + text.length * perChar;
    later(typed + 250, () => root.classList.add("press"));
    later(typed + 500, () => {
      root.classList.remove("press"); root.classList.add("show-chips");
      data.chips.forEach((chip, i) => later(i * 140, () => {
        $("demo-chips").insertAdjacentHTML("beforeend", `<span class="demo-chip">${escape(chip)}</span>`);
        const added = $("demo-chips").lastElementChild;
        requestAnimationFrame(() => requestAnimationFrame(() => added?.classList.add("is-in")));
      }));
    });
    const counting = typed + 500 + data.chips.length * 140 + 500;
    later(counting, () => { setStep(2); root.classList.add("show-loading"); });
    later(counting + 1300, () => {
      root.classList.remove("show-loading"); root.classList.add("show-report");
      document.querySelectorAll("#demo-kpis strong").forEach((node, i) => countUp(node, kpis[i][1], kpis[i][2]));
    });
    const insightsAt = counting + 1300 + 1500;
    later(insightsAt, () => setStep(3));
    data.insights.forEach((_, i) => later(insightsAt + i * 1300, () => document.querySelector(`#demo-insights li[data-index="${i}"]`)?.classList.add("is-in")));
    later(insightsAt + data.insights.length * 1300 + 300, () => { root.classList.add("show-finale", "is-done"); running = false; });
  }

  // Card spotlight: a soft light follows the pointer on the example cards (pointer devices only).
  if (!reduceMotion && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
    document.querySelectorAll(".example-card").forEach((card) => {
      let frame = 0;
      card.addEventListener("pointermove", (event) => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const box = card.getBoundingClientRect();
          card.style.setProperty("--x", `${event.clientX - box.left}px`);
          card.style.setProperty("--y", `${event.clientY - box.top}px`);
        });
      });
    });
  }

  renderStatic();
  $("demo-replay").addEventListener("click", () => {
    root.scrollIntoView({ behavior: "instant", block: "center" });
    play();
  });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
    reduceMotion = event.matches;
    if (reduceMotion) play();
  });
  // Start when the demo is visible, so people who land lower on the page still see it from the beginning.
  if ("IntersectionObserver" in window && !reduceMotion) {
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); play(); } }, { threshold: 0.35 });
    observer.observe(root);
  } else play();
})();

// One persistent particle field: the same points move between four research shapes.
(() => {
  "use strict";
  const stage = document.getElementById("hero-visual");
  const canvas = document.getElementById("research-particles");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const small = matchMedia("(max-width: 700px)").matches;
  const count = small ? 900 : 2400;
  const data = window.TMM_DEMO || {};
  const years = (data.years || Object.entries(window.LANDING_EXAMPLES?.topics?.find(item => item.id === "neurotechnology")?.years || {}).map(([year, count]) => ({year: +year, count})))
    .filter(item => item.year !== (data.partialYear || window.LANDING_EXAMPLES?.partialYear)).sort((a, b) => a.year - b.year);
  const maximum = Math.max(1, ...years.map(item => item.count));
  const countries = (data.countries || []).filter(item => item.count > 0 && window.REPORT_MAP?.centers[item.code]).slice(0, 8);
  const colors = getComputedStyle(document.documentElement);
  const ink = colors.getPropertyValue("--chart").trim();
  const bright = colors.getPropertyValue("--action").trim();
  // Cached radial sprites avoid thousands of shadow blurs per frame.
  function sprite(color) {
    const tile = document.createElement("canvas"); tile.width = tile.height = 48;
    const brush = tile.getContext("2d");
    const glow = brush.createRadialGradient(24, 24, 0, 24, 24, 24);
    glow.addColorStop(0, color); glow.addColorStop(0.12, color);
    glow.addColorStop(1, colors.getPropertyValue("--clear").trim());
    brush.fillStyle = glow; brush.fillRect(0, 0, 48, 48); return tile;
  }
  const dot = sprite(ink), light = sprite(bright);
  const sphere = (lat, lon) => [Math.cos(lat) * Math.sin(lon), -Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const shapeNames = ["search", "growth", "where", "experts"];
  const descriptions = [
    "Type a topic or a question in plain words.",
    "See how many papers are published each year.",
    "See which countries publish most.",
    "Find the most active researchers."
  ];
  const points = Array.from({length: count}, (_, i) => {
    const u = i / (count - 1), angle = i * 2.3999632297;
    const globe = sphere(Math.asin(1 - 2 * u), angle);
    // A thick circular rim with a diagonal handle, all with a little depth.
    const ringAngle = u / .78 * Math.PI * 2;
    const radius = .63 + .045 * Math.sin(angle);
    const handle = (u - .78) / .22;
    const search = u < .78
      ? [-.2 + Math.cos(ringAngle) * radius, -.22 + Math.sin(ringAngle) * radius, .06 * Math.cos(angle)]
      : [.25 + handle * .65 + .045 * Math.sin(angle), .23 + handle * .65 - .045 * Math.sin(angle), .06 * Math.cos(angle)];
    const sample = u * Math.max(0, years.length - 1), index = Math.floor(sample);
    const value = years.length ? (years[index].count + ((years[index + 1]?.count ?? years[index].count) - years[index].count) * (sample - index)) / maximum : u;
    const growth = [(u - .5) * 2.1, .65 - value * 1.5 + .045 * Math.sin(angle), Math.sin(angle) * .33];
    // Mortarboard: a broad diamond, curved headband and a hanging tassel.
    // Extra points trace the rim so the cap reads clearly at phone sizes.
    let expert;
    const thickness = .025 * Math.sin(angle);
    if (u < .36) {
      const edge = u / .36 * 4, side = Math.floor(edge), t = edge - side;
      const corners = [[0, -.72], [.92, -.30], [0, .12], [-.92, -.30], [0, -.72]];
      const first = corners[side], last = corners[side + 1];
      expert = [first[0] + (last[0] - first[0]) * t, first[1] + (last[1] - first[1]) * t + thickness, .05 * Math.cos(angle)];
    } else if (u < .65) {
      const v = (u - .36) / .29, w = (i * .61803398875) % 1;
      const a = v * 2 - 1, b = w * 2 - 1;
      expert = [.46 * (a + b), -.30 + .21 * (a - b), thickness];
    } else if (u < .86) {
      const v = (u - .65) / .21, theta = v * Math.PI;
      const depth = (i * .61803398875) % 1;
      expert = [.50 * Math.cos(theta), .03 + depth * .22 + .09 * Math.sin(theta), .16 * Math.sin(theta)];
    } else {
      const v = (u - .86) / .14;
      if (v < .45) {
        const t = v / .45;
        expert = [.76 * t, -.30 + .07 * t + thickness, .08];
      } else if (v < .86) {
        const t = (v - .45) / .41;
        expert = [.76 + thickness * .5, -.23 + .70 * t, .08];
      } else {
        const t = (v - .86) / .14;
        expert = [.76 + Math.sin(angle) * .07 * t, .47 + .17 * t, .08 + thickness];
      }
    }
    return [search, growth, globe, expert];
  });
  const caption = document.getElementById("shape-caption"), pause = document.getElementById("particle-pause");
  const buttons = [...stage.querySelectorAll("[data-shape]")];
  let width = 1, height = 1, frame = 0, clock = 0, rotationTime = 0, previous = null;
  let visible = true, paused = false, selected = motion.matches ? 2 : 0;
  let targetX = 0, targetY = 0, tiltX = 0, tiltY = 0;
  let transition = null, manualTransition = false, holdUntil = 750;
  let positions = points.map(shapes => shapes[selected].slice());
  let globeWeight = selected === 2 ? 1 : 0, expertWeight = selected === 3 ? 1 : 0;
  // Solve the project's strong ease-in-out cubic-bezier (.77, 0, .175, 1).
  function ease(t) {
    if (t <= 0 || t >= 1) return t;
    let low = 0, high = 1, u = t;
    for (let i = 0; i < 14; i++) {
      u = (low + high) / 2;
      const x = 3 * (1 - u) ** 2 * u * .77 + 3 * (1 - u) * u ** 2 * .175 + u ** 3;
      if (x < t) low = u; else high = u;
    }
    return 3 * (1 - u) * u ** 2 + u ** 3;
  }
  function updateControls() {
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.shape === shapeNames[selected])));
    caption.textContent = descriptions[selected];
  }
  function selectShape(index, manual = false) {
    if (index !== selected) {
      // Retarget from what is actually on screen, including interrupted morphs.
      transition = motion.matches ? null : {
        from: positions.map(point => point.slice()), start: clock,
        globe: globeWeight, expert: expertWeight
      };
      selected = index;
      if (motion.matches) {
        positions = points.map(shapes => shapes[selected].slice());
        globeWeight = selected === 2 ? 1 : 0; expertWeight = selected === 3 ? 1 : 0;
      }
    }
    manualTransition = manual && transition !== null;
    holdUntil = clock + (manual ? 8000 : 1500);
    updateControls();
  }
  function project(point) {
    const yaw = motion.matches ? 0 : (Math.sin(rotationTime * .00035) * .45 + tiltX) * (1 - expertWeight * .8);
    const pitch = motion.matches ? 0 : (-.12 + tiltY) * (1 - expertWeight * .8);
    // Breathing and buoyancy remain gentle during the resting part of each cycle.
    // Both use the paused rotation clock, so pause and reduced motion stay still.
    const breath = motion.matches ? 1 : 1 + Math.sin(rotationTime * .0015) * .014;
    const float = motion.matches ? 0 : Math.sin(rotationTime * .0009) * .025;
    const px = point[0] * breath, py = point[1] * breath + float;
    const x = px * Math.cos(yaw) + point[2] * Math.sin(yaw);
    const z = -px * Math.sin(yaw) + point[2] * Math.cos(yaw);
    const y = py * Math.cos(pitch) - z * Math.sin(pitch);
    const depth = py * Math.sin(pitch) + z * Math.cos(pitch);
    const perspective = 3.8 / (3.8 - depth), scale = Math.min(width, height) * .32;
    return [width / 2 + x * scale * perspective, height / 2 + y * scale * perspective, perspective, depth];
  }
  function draw() {
    ctx.clearRect(0, 0, width, height);
    if (transition) {
      const t = Math.min(1, (clock - transition.start) / 750), mix = ease(t);
      positions = points.map((shapes, i) => shapes[selected].map((value, axis) => transition.from[i][axis] + (value - transition.from[i][axis]) * mix));
      globeWeight = transition.globe + ((selected === 2 ? 1 : 0) - transition.globe) * mix;
      expertWeight = transition.expert + ((selected === 3 ? 1 : 0) - transition.expert) * mix;
      if (t === 1) { transition = null; manualTransition = false; }
    }
    for (const point of positions) {
      const [x, y, scale, depth] = project(point), size = (small ? 6 : 7) * scale;
      ctx.globalAlpha = .35 + (depth + 1.5) * .15;
      ctx.drawImage(dot, x - size / 2, y - size / 2, size, size);
    }
    const maxCountry = Math.max(1, ...countries.map(item => item.count));
    for (const item of countries) {
      const [lat, lon] = window.REPORT_MAP.centers[item.code];
      const [x, y, scale, depth] = project(sphere(lat * Math.PI / 180, lon * Math.PI / 180));
      if (depth < 0) continue;
      ctx.globalAlpha = globeWeight * (.25 + .75 * item.count / maxCountry);
      const size = 24 * scale; ctx.drawImage(light, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; previous = null; }
  function tick(now) {
    const delta = previous === null ? 0 : Math.min(64, now - previous);
    previous = now; clock += delta;
    if (!paused) rotationTime += delta;
    tiltX += (targetX - tiltX) * .05; tiltY += (targetY - tiltY) * .05;
    if (!paused && !transition && clock >= holdUntil) selectShape((selected + 1) % shapeNames.length);
    draw();
    if (!paused || manualTransition) frame = requestAnimationFrame(tick); else stop();
  }
  function sync() {
    stop(); pause.hidden = motion.matches;
    if (visible && !document.hidden && (!paused || manualTransition) && !motion.matches) frame = requestAnimationFrame(tick);
    else draw();
  }
  function resize() {
    const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
  }
  buttons.forEach(button => {
    button.disabled = false;
    button.addEventListener("click", () => { selectShape(shapeNames.indexOf(button.dataset.shape), true); sync(); });
  });
  pause.addEventListener("click", () => { paused = !paused; manualTransition = false; pause.textContent = paused ? "Resume visual" : "Pause visual"; sync(); });
  stage.addEventListener("pointermove", event => {
    if (!finePointer.matches || motion.matches) return;
    const box = canvas.getBoundingClientRect(); targetX = (event.clientX - box.left - box.width / 2) / box.width * .22; targetY = (event.clientY - box.top - box.height / 2) / box.height * .16;
  });
  stage.addEventListener("pointerleave", () => { targetX = targetY = 0; });
  document.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", () => {
    if (motion.matches) {
      selected = 2; transition = null; positions = points.map(shapes => shapes[2].slice());
      globeWeight = 1; expertWeight = 0; targetX = targetY = tiltX = tiltY = 0;
      updateControls();
    } else holdUntil = clock + 750;
    sync();
  });
  if ("IntersectionObserver" in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(stage);
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(stage); else window.addEventListener("resize", resize);
  updateControls(); resize(); sync();
})();
