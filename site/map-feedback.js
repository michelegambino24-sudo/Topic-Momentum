// Pointer and keyboard inspection share one transient, exact-count label.
(() => {
  const bindings = new WeakMap();
  globalThis.TMM_BIND_MAP_FEEDBACK = host => {
    bindings.get(host)?.();
    const readout = host.querySelector(".map-readout");
    if (!readout) return;
    const hint = "Hover or focus a country for its exact count.";
    const label = document.createElement("span");
    label.className = "map-dot-label";
    label.setAttribute("aria-hidden", "true");
    label.hidden = true;
    host.append(label);
    let hovered = null, focused = null, active = null, dismissed = false;
    const removers = [];
    const listen = (node, type, handler) => {
      node.addEventListener(type, handler);
      removers.push(() => node.removeEventListener(type, handler));
    };
    const show = node => {
      active = node;
      if (!node || dismissed) { readout.textContent = hint; label.hidden = true; return; }
      readout.textContent = label.textContent = node.getAttribute("aria-label");
      label.hidden = false;
      const box = host.getBoundingClientRect();
      const dot = node.querySelector(".map-count").getBoundingClientRect();
      const width = label.offsetWidth, height = label.offsetHeight;
      let left = dot.right - box.left + 8;
      if (left + width > box.width - 4) left = dot.left - box.left - width - 8;
      label.style.left = Math.max(4, Math.min(box.width - width - 4, left)) + "px";
      label.style.top = Math.max(4, Math.min(box.height - height - 4, dot.top - box.top - height - 8)) + "px";
    };
    host.querySelectorAll(".map-marker").forEach(node => {
      listen(node, "pointerenter", () => { hovered = node; dismissed = false; show(node); });
      listen(node, "pointerleave", () => { if (hovered === node) hovered = null; show(focused || hovered); });
      listen(node, "focus", () => { focused = node; dismissed = false; show(node); });
      listen(node, "blur", () => { if (focused === node) focused = null; show(hovered || focused); });
    });
    listen(host, "pointerleave", () => { hovered = null; show(focused); });
    listen(host, "keydown", event => { if (event.key === "Escape") { dismissed = true; show(null); } });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => show(active)) : null;
    observer?.observe(host);
    show(null);
    bindings.set(host, () => { removers.forEach(remove => remove()); observer?.disconnect(); label.remove(); });
  };
})();
