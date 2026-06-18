import { graphTooltip, renderDetailHtml } from "./graph-data.js";

export function mountCanvasGraph(container, bundle, options = {}) {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "fallback-graph-canvas";
  canvas.tabIndex = 0;
  container.append(canvas);

  const tooltip = options.tooltip || document.createElement("div");
  if (!options.tooltip) {
    tooltip.className = "graph-tooltip";
    tooltip.hidden = true;
    container.append(tooltip);
  }

  const ctx = canvas.getContext("2d");
  const nodes = bundle.nodes || [];
  const links = bundle.links || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const neighborIds = new Map();
  for (const link of links) {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (!neighborIds.has(source)) neighborIds.set(source, new Set());
    if (!neighborIds.has(target)) neighborIds.set(target, new Set());
    neighborIds.get(source).add(target);
    neighborIds.get(target).add(source);
  }
  const transform = { x: 0, y: 0, scale: 1 };
  const pointer = { down: false, x: 0, y: 0, startX: 0, startY: 0 };
  let hoverNode = null;
  let selectedId = "";

  function resize() {
    const rect = container.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function fit() {
    if (!nodes.length) return;
    const rect = container.getBoundingClientRect();
    const bounds = nodes.reduce((box, node) => ({
      minX: Math.min(box.minX, node.x),
      maxX: Math.max(box.maxX, node.x),
      minY: Math.min(box.minY, node.y),
      maxY: Math.max(box.maxY, node.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const spanX = Math.max(80, bounds.maxX - bounds.minX);
    const spanY = Math.max(80, bounds.maxY - bounds.minY);
    transform.scale = Math.max(0.18, Math.min(1.6, Math.min((rect.width - 80) / spanX, (rect.height - 80) / spanY)));
    transform.x = rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * transform.scale;
    transform.y = rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * transform.scale;
    draw();
  }

  function toWorld(point) {
    return {
      x: (point.x - transform.x) / transform.scale,
      y: (point.y - transform.y) / transform.scale,
    };
  }

  function draw() {
    const rect = container.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    ctx.lineCap = "round";
    const activeId = selectedId || hoverNode?.id || "";
    const activeNeighbors = activeId ? neighborIds.get(activeId) || new Set() : new Set();
    for (const link of links) {
      const source = nodeById.get(typeof link.source === "object" ? link.source.id : link.source);
      const target = nodeById.get(typeof link.target === "object" ? link.target.id : link.target);
      if (!source || !target) continue;
      const selected = activeId && (source.id === activeId || target.id === activeId);
      const filteredOut = bundle.isFiltered && !link.isMatch;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = selected ? "rgba(186,230,253,0.55)" : filteredOut ? "rgba(148,163,184,0.0)" : "rgba(148,163,184,0.045)";
      ctx.lineWidth = Math.max(0.06, Number(link.score || 0) * (selected ? 0.7 : 0.18));
      ctx.stroke();
    }
    for (const node of nodes) {
      const selected = node.id === selectedId;
      const hovered = node.id === hoverNode?.id;
      const neighbor = activeNeighbors.has(node.id);
      const filteredOut = bundle.isFiltered && !node.isMatch;
      const focusedOut = activeId && !selected && !hovered && !neighbor;
      const radius = selected ? 5.5 : hovered ? 4.0 : node.size || 1.35;
      if (selected || hovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + (selected ? 6.5 : 4.5), 0, Math.PI * 2);
        ctx.fillStyle = selected ? "rgba(240,171,252,0.35)" : "rgba(224,242,254,0.16)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = selected || hovered ? 1 : neighbor ? 0.78 : focusedOut ? 0.08 : filteredOut ? 0.045 : 0.72;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (selected || hovered) {
        ctx.lineWidth = selected ? 1.8 : 1.2;
        ctx.strokeStyle = selected ? "#f0abfc" : "#e0f2fe";
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function closestNode(point) {
    const world = toWorld(point);
    const threshold = Math.max(8, 10 / transform.scale);
    let best = null;
    let bestDistance = threshold;
    for (const node of nodes) {
      const distance = Math.hypot(node.x - world.x, node.y - world.y);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function showTooltip(node, point) {
    if (!node) {
      tooltip.hidden = true;
      return;
    }
    const rect = container.getBoundingClientRect();
    tooltip.textContent = graphTooltip(node);
    tooltip.style.left = `${Math.round(rect.left + point.x + 12)}px`;
    tooltip.style.top = `${Math.round(rect.top + point.y + 12)}px`;
    tooltip.hidden = false;
  }

  canvas.addEventListener("pointerdown", (event) => {
    pointer.down = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (pointer.down) {
      transform.x += event.clientX - pointer.x;
      transform.y += event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      draw();
      return;
    }
    hoverNode = closestNode(point);
    canvas.style.cursor = hoverNode ? "pointer" : "grab";
    showTooltip(hoverNode, point);
    draw();
  });

  canvas.addEventListener("pointerup", (event) => {
    pointer.down = false;
    canvas.releasePointerCapture?.(event.pointerId);
    const moved = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 4;
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const node = closestNode(point);
    selectedId = node?.id || "";
    options.onSelect?.(node || null);
    if (node) {
      const rect = container.getBoundingClientRect();
      transform.x += rect.width / 2 - (node.x * transform.scale + transform.x);
      transform.y += rect.height / 2 - (node.y * transform.scale + transform.y);
    }
    draw();
  });

  canvas.addEventListener("pointerleave", () => {
    hoverNode = null;
    tooltip.hidden = true;
    draw();
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const before = toWorld(point);
    const multiplier = event.deltaY > 0 ? 0.86 : 1.16;
    transform.scale = Math.max(0.08, Math.min(10, transform.scale * multiplier));
    transform.x = point.x - before.x * transform.scale;
    transform.y = point.y - before.y * transform.scale;
    draw();
  }, { passive: false });

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);
  resize();
  fit();

  return {
    fit,
    destroy() {
      resizeObserver.disconnect();
      tooltip.hidden = true;
      container.innerHTML = "";
    },
    select(node) {
      selectedId = node?.id || "";
      options.onSelect?.(node || null);
      draw();
    },
    renderDetail(node) {
      if (options.detail) options.detail.innerHTML = renderDetailHtml(node, links);
    },
  };
}
