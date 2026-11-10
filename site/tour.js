/* Guided tour of the report page. Plain script, no dependencies. */
(function () {
  "use strict";
  var HOW = "How it works", SKILLS = "Skills", SAFETY = "Safety";
  var I = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/>',
    swap: '<path d="M4 8h13"/><path d="m13 4 4 4-4 4"/><path d="M20 16H7"/><path d="m11 12-4 4 4 4"/>',
    gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><path d="M3 20h18"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    badge: '<path d="M12 3l2.4 2 3.1-.2.8 3 2.5 1.8-1.2 2.9 1.2 2.9-2.5 1.8-.8 3-3.1-.2L12 21l-2.4-2-3.1.2-.8-3-2.5-1.8 1.2-2.9-1.2-2.9 2.5-1.8.8-3 3.1.2z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    type: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
    db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9 10h6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'
  };
  var STEPS = [
    { chapter: HOW, icon: "server", target: "#search-form .primary", title: "The Worker", text: "The page sends your question to a Worker: a small program on a server that talks to OpenAI and OpenAlex, then sends the report back." },
    { chapter: HOW, icon: "key", title: "The API key", text: "A long secret code that tells OpenAI which account is calling. It stays in the Worker, never in the page, because anyone can inspect what the browser receives." },
    { chapter: SKILLS, icon: "layout", target: ".topbar", title: "Hallmark", text: "Stops AI from making the same boring page every time. It pushes for a layout with more variety and real content instead of placeholder text." },
    { chapter: SKILLS, icon: "badge", target: "#report-content", title: "Impeccable", text: "Keeps the whole site consistent. It gives the AI one set of design rules to follow, so colours, buttons and style match everywhere." },
    { chapter: SKILLS, icon: "type", target: "#kpis", title: "better-typography", text: "Makes the text look right: easy to read, and the right size on any screen, from phone to laptop." },
    { chapter: SKILLS, icon: "cursor", target: ".report-actions", title: "Emil Kowalski\u2019s skills", text: "Makes things move in a natural way. Instead of the flat, stiff effects AI usually adds, buttons and menus react smoothly, like real objects." },
    { chapter: SAFETY, icon: "key", title: "Secrets", text: "Keep API keys on the server, in an environment variable or a secret manager. Never in browser code or on GitHub. If a key is exposed, revoke it and create a new one." },
    { chapter: SAFETY, icon: "globe", target: "#library-nav", title: "Public access", text: "Who can reach your site, and what can they trigger? If it can cost money, set usage and rate limits on the server." },
    { chapter: SAFETY, icon: "db", target: "#save-report", title: "Stored data", text: "What does the site save, who can see it, and for how long? Keep only what you need, and make sure old data gets deleted." },
    { chapter: SAFETY, icon: "lock", target: ".topbar", title: "Authentication vs authorisation", text: "Authentication checks who you are. Authorisation checks what you are allowed to do. The server must check both on every request." },
  ];
  var list = [], index = 0, open = false, dragged = false, drag = null, spot, card, shield, opener, raf = 0, timer = 0;

  function visible(el) {
    if (!el || el.closest("[hidden]")) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function targetOf(step) { var t = step.target ? document.querySelector(step.target) : null; return visible(t) ? t : null; }

  function build() {
    shield = el("div", "tour-shield");
    spot = el("div", "tour-spot");
    spot.setAttribute("aria-hidden", "true");
    card = el("div", "tour-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-label", "Guided tour");
    card.innerHTML = '<div class="tour-head"><span class="tour-icon" aria-hidden="true"><svg viewBox="0 0 24 24" id="tour-svg"></svg></span><p class="tour-count" id="tour-count"></p></div><h2 class="tour-title" id="tour-title"></h2><p class="tour-text" id="tour-text"></p><div class="tour-actions"><button type="button" class="text-button" id="tour-skip">Skip tour</button><span class="tour-nav"><button type="button" id="tour-back">Back</button><button type="button" class="primary" id="tour-next">Next</button></span></div>';
    document.body.append(shield, spot, card);
    card.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("button")) return;
      var r = card.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      card.setPointerCapture(e.pointerId);
      card.classList.add("tour-dragging");
    });
    card.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var x = Math.min(Math.max(e.clientX - drag.dx, 8), window.innerWidth - card.offsetWidth - 8);
      var y = Math.min(Math.max(e.clientY - drag.dy, 8), window.innerHeight - card.offsetHeight - 8);
      card.style.left = x + "px"; card.style.top = y + "px"; dragged = true;
    });
    function drop() { drag = null; card.classList.remove("tour-dragging"); }
    card.addEventListener("pointerup", drop);
    card.addEventListener("pointercancel", drop);
    card.querySelector("#tour-skip").addEventListener("click", end);
    card.querySelector("#tour-back").addEventListener("click", function () { go(index - 1); });
    card.querySelector("#tour-next").addEventListener("click", function () { index === list.length - 1 ? end() : go(index + 1); });
  }

  function place() {
    raf = 0;
    if (!open) return;
    var step = list[index], target = targetOf(step), vw = window.innerWidth, vh = window.innerHeight;
    var cw = card.offsetWidth, ch = card.offsetHeight, left, y;
    var keep = dragged;
    if (!target) {
      spot.hidden = true;
      shield.classList.add("tour-dim");
      if (!keep) { card.style.left = Math.max((vw - cw) / 2, 16) + "px"; card.style.top = Math.max((vh - ch) / 2, 8) + "px"; }
      return;
    }
    spot.hidden = false;
    shield.classList.remove("tour-dim");
    var r = target.getBoundingClientRect(), pad = 10;
    var top = Math.max(r.top - pad, 4), bottom = Math.min(r.bottom + pad, vh - 4);
    spot.style.top = top + "px";
    spot.style.left = Math.max(r.left - pad, 4) + "px";
    spot.style.width = Math.min(r.width + pad * 2, vw - 8) + "px";
    spot.style.height = Math.max(bottom - top, 0) + "px";
    if (r.height > vh * 0.5) {
      left = Math.max(16, (vw - cw) / 2); y = vh - ch - 16;
    } else {
      left = Math.min(Math.max(r.left, 16), vw - cw - 16);
      if (vh - r.bottom - pad >= ch + 16) y = r.bottom + pad + 14;
      else if (r.top - pad >= ch + 16) y = r.top - pad - ch - 14;
      else if (vw - r.right - pad >= cw + 32) { left = r.right + pad + 18; y = Math.min(Math.max(r.top, 8), vh - ch - 8); }
      else if (r.left - pad >= cw + 32) { left = r.left - pad - cw - 18; y = Math.min(Math.max(r.top, 8), vh - ch - 8); }
      else y = vh - ch - 16;
    }
    if (keep) return;
    card.style.left = left + "px";
    card.style.top = Math.max(y, 8) + "px";
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(place); }

  function go(n) {
    index = Math.min(Math.max(n, 0), list.length - 1);
    dragged = false;
    var step = list[index], target = targetOf(step);
    var same = list.filter(function (s) { return s.chapter === step.chapter; });
    card.setAttribute("data-chapter", step.chapter.replace(/\s+/g, "-").toLowerCase());
    card.querySelector("#tour-count").textContent = step.chapter + " · " + (same.indexOf(step) + 1) + " of " + same.length;
    card.querySelector("#tour-svg").innerHTML = I[step.icon] || "";
    card.querySelector("#tour-title").textContent = step.title;
    card.querySelector("#tour-text").textContent = step.text;
    card.querySelector("#tour-back").disabled = index === 0;
    card.querySelector("#tour-next").textContent = index === list.length - 1 ? "Done" : "Next";
    if (target) {
      var r = target.getBoundingClientRect();
      target.scrollIntoView({ block: r.height > window.innerHeight * 0.5 ? "start" : "center", behavior: reduced() ? "auto" : "smooth" });
    }
    schedule();
    clearTimeout(timer);
    timer = setTimeout(schedule, 450);
    card.querySelector("#tour-next").focus({ preventScroll: true });
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); end(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); index === list.length - 1 ? end() : go(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
  }

  function start(from) {
    if (open) return;
    var page = document.getElementById("topic-page");
    if (page && page.hidden) { location.hash = "#search"; setTimeout(function () { start(from); }, 350); return; }
    opener = from || document.getElementById("start-tour");
    list = STEPS.slice();
    if (!list.length) return;
    if (!card) build();
    open = true;
    document.body.classList.add("tour-open");
    shield.hidden = card.hidden = false;
    window.scrollTo(0, 0);
    go(0);
  }

  function end() {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    document.body.classList.remove("tour-open");
    shield.hidden = spot.hidden = card.hidden = true;
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  function bind() {
    var b = document.getElementById("start-tour");
    if (b && !b.dataset.tourBound) { b.dataset.tourBound = "1"; b.addEventListener("click", function () { start(b); }); }
  }
  document.addEventListener("DOMContentLoaded", bind);
  if (document.readyState !== "loading") bind();
  globalThis.TMM_TOUR = { start: start, end: end };
})();
