import {
  buildSemanticGraph,
  escapeHtml,
  graphTooltip,
  renderDetailHtml,
} from "./graph-data.js";
import { mountCanvasGraph } from "./graph-canvas-fallback.js";

const state = {
  rawIndex: null,
  rawMap: null,
  graphBundle: null,
  renderer: null,
  fallback: null,
  Graph: null,
  Sigma: null,
  selectedNode: "",
};

const els = {
  search: document.querySelector("#graphSearch"),
  area: document.querySelector("#areaFilter"),
  domain: document.querySelector("#domainFilter"),
  type: document.querySelector("#typeFilter"),
  color: document.querySelector("#colorMode"),
  reset: document.querySelector("#resetFilters"),
  fit: document.querySelector("#fitGraph"),
  canvas: document.querySelector("#graphCanvas"),
  detail: document.querySelector("#graphDetail"),
  status: document.querySelector("#graphStatus"),
  tooltip: document.querySelector("#graphTooltip"),
};

function status(text, mode = "loading") {
  els.status.textContent = text;
  els.status.dataset.state = mode;
}

function option(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function populateSelect(select, values, label) {
  const current = select.value || "all";
  select.innerHTML = option("all", `All ${label}`) + values.map(([value, count]) => option(value, `${value} (${count.toLocaleString()})`)).join("");
  select.value = [...values.map(([value]) => value), "all"].includes(current) ? current : "all";
}

function buildGraphology(bundle) {
  if (!state.Graph || !state.Sigma) throw new Error("Sigma.js modules are unavailable");
  const graph = new state.Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  // Soft filtering: when a search/filter is active, dim unmatched nodes and
  // edges instead of removing them, so the Area/Domain/Type/Search controls
  // actually guide the eye in the Sigma runtime (the canvas fallback already
  // does this; the Sigma path previously styled every node identically).
  const DIM_NODE = "rgba(148, 163, 184, 0.16)";
  const DIM_EDGE = "rgba(39, 52, 73, 0.22)";
  for (const node of bundle.nodes) {
    const dimmed = bundle.isFiltered && !node.isMatch;
    graph.addNode(node.id, {
      label: node.title,
      x: node.x,
      y: node.y,
      size: dimmed ? Math.max(0.4, node.size * 0.55) : node.size,
      color: dimmed ? DIM_NODE : node.color,
      borderColor: dimmed ? DIM_NODE : node.domainColor,
      title: node.title,
      area: node.area,
      domain: node.domain,
      typeLabel: node.typeLabel,
      sourceNode: node,
    });
  }
  for (const link of bundle.links) {
    if (!graph.hasNode(link.source) || !graph.hasNode(link.target)) continue;
    const dimmed = bundle.isFiltered && !link.isMatch;
    graph.mergeEdge(link.source, link.target, {
      size: dimmed ? 0.02 : Math.max(0.03, Number(link.score || 0) * 0.16),
      color: dimmed ? DIM_EDGE : "#273449",
      score: link.score,
    });
  }
  return graph;
}

function showTooltip(nodeKey, event) {
  const attrs = state.renderer?.getGraph().getNodeAttributes(nodeKey);
  const node = attrs?.sourceNode;
  if (!node) return;
  els.tooltip.textContent = graphTooltip(node);
  // Sigma's event.event.x/y are relative to the graph container, but
  // .graph-tooltip is position:fixed, so it must be placed in viewport
  // coordinates. Add the container's bounding rect (as the canvas fallback does)
  // or the tooltip is offset toward the viewport origin by the dock + header.
  const rect = els.canvas.getBoundingClientRect();
  els.tooltip.style.left = `${Math.round(rect.left + event.event.x + 14)}px`;
  els.tooltip.style.top = `${Math.round(rect.top + event.event.y + 14)}px`;
  els.tooltip.hidden = false;
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

function renderDetail(nodeKey) {
  const graph = state.renderer?.getGraph();
  const node = nodeKey && graph?.hasNode(nodeKey) ? graph.getNodeAttribute(nodeKey, "sourceNode") : null;
  els.detail.innerHTML = renderDetailHtml(node, state.graphBundle?.links || []);
}

function fitGraph() {
  if (state.fallback) {
    state.fallback.fit();
    return;
  }
  const camera = state.renderer?.getCamera?.();
  if (!camera) return;
  camera.animatedReset({ duration: 420 });
}

function renderGraph() {
  state.renderer?.kill();
  state.renderer = null;
  state.fallback?.destroy();
  state.fallback = null;
  els.canvas.innerHTML = "";
  const bundle = buildSemanticGraph(state.rawIndex, state.rawMap, {
    query: els.search.value,
    areaFilter: els.area.value,
    domainFilter: els.domain.value,
    typeFilter: els.type.value,
    colorMode: els.color.value,
    neighborLimit: 2,
  });
  state.graphBundle = bundle;
  try {
    const graph = buildGraphology(bundle);
    state.renderer = new state.Sigma(graph, els.canvas, {
      defaultEdgeColor: "#273449",
      defaultEdgeType: "line",
      labelColor: { color: "#f8fafc" },
      labelDensity: 0.08,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 13,
      minCameraRatio: 0.03,
      maxCameraRatio: 16,
      stagePadding: 24,
      renderEdgeLabels: false,
      zIndex: true,
    });
    state.renderer.on("enterNode", (event) => {
      showTooltip(event.node, event);
      els.canvas.style.cursor = "pointer";
    });
    state.renderer.on("leaveNode", () => {
      hideTooltip();
      els.canvas.style.cursor = "";
    });
    state.renderer.on("clickNode", (event) => {
      state.selectedNode = event.node;
      renderDetail(event.node);
    });
    state.renderer.on("clickStage", () => {
      state.selectedNode = "";
      renderDetail("");
    });
    window.setTimeout(fitGraph, 120);
    status(`${bundle.nodes.length.toLocaleString()} nodes · ${bundle.links.length.toLocaleString()} links · Sigma.js`, "ready");
    renderDetail(state.selectedNode);
  } catch (error) {
    console.warn("Sigma.js renderer unavailable; using canvas fallback", error);
    state.fallback = mountCanvasGraph(els.canvas, bundle, {
      tooltip: els.tooltip,
      detail: els.detail,
      onSelect: (node) => {
        state.selectedNode = node?.id || "";
        els.detail.innerHTML = renderDetailHtml(node, state.graphBundle?.links || []);
      },
    });
    status(`${bundle.nodes.length.toLocaleString()} nodes · ${bundle.links.length.toLocaleString()} links · canvas fallback`, "ready");
    els.detail.innerHTML = renderDetailHtml(null);
  }
}

function installEvents() {
  for (const input of [els.search, els.area, els.domain, els.type, els.color]) {
    input.addEventListener("input", renderGraph);
    input.addEventListener("change", renderGraph);
  }
  els.reset.addEventListener("click", () => {
    els.search.value = "";
    els.area.value = "all";
    els.domain.value = "all";
    els.type.value = "all";
    els.color.value = "area";
    renderGraph();
  });
  els.fit.addEventListener("click", fitGraph);
}

async function init() {
  try {
    status("Loading semantic map data");
    try {
      const [{ default: Graph }, { default: Sigma }] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/graphology@0.26.0/+esm"),
        import("https://cdn.jsdelivr.net/npm/sigma@3.0.3/+esm"),
      ]);
      state.Graph = Graph;
      state.Sigma = Sigma;
    } catch (error) {
      console.warn("Sigma.js modules unavailable; using canvas fallback", error);
    }
    const [indexResponse, mapResponse] = await Promise.all([
      fetch("site/data/icml2026_index.json"),
      fetch("site/data/icml2026_map.json"),
    ]);
    state.rawIndex = await indexResponse.json();
    state.rawMap = await mapResponse.json();
    const bundle = buildSemanticGraph(state.rawIndex, state.rawMap, { neighborLimit: 2 });
    populateSelect(els.area, bundle.areas, "areas");
    populateSelect(els.domain, bundle.domains, "domains");
    populateSelect(els.type, bundle.types.map(([label, count]) => [label.toLowerCase(), count]), "types");
    renderGraph();
    installEvents();
  } catch (error) {
    console.error(error);
    status(`Sigma.js failed: ${error.message}`, "error");
    els.detail.innerHTML = `<div class="graph-empty"><strong>Graph unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

void init();
