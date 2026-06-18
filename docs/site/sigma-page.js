import {
  buildSemanticGraph,
  escapeHtml,
  graphTooltip,
  loadGraphBundle,
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
  for (const node of bundle.nodes) {
    graph.addNode(node.id, {
      label: node.title,
      x: node.x,
      y: node.y,
      size: node.size,
      color: node.color,
      borderColor: node.domainColor,
      title: node.title,
      area: node.area,
      domain: node.domain,
      typeLabel: node.typeLabel,
      sourceNode: node,
    });
  }
  for (const link of bundle.links) {
    if (!graph.hasNode(link.source) || !graph.hasNode(link.target)) continue;
    graph.mergeEdge(link.source, link.target, {
      size: Math.max(0.03, Number(link.score || 0) * 0.16),
      color: "#273449",
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
  els.tooltip.style.left = `${Math.round(event.event.x + 14)}px`;
  els.tooltip.style.top = `${Math.round(event.event.y + 14)}px`;
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
    const bundle = await loadGraphBundle({ neighborLimit: 2 });
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
