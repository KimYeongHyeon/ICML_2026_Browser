import {
  AREA_COLORS,
  buildSemanticGraph,
  escapeHtml,
  loadGraphBundle,
  renderDetailHtml,
} from "./graph-data.js";
import { mountCanvasGraph } from "./graph-canvas-fallback.js";

const state = {
  rawIndex: null,
  rawMap: null,
  graph: null,
  fallback: null,
  bundle: null,
  Cosmograph: null,
  prepareCosmographData: null,
  renderTimer: 0,
};

const els = {
  search: document.querySelector("#graphSearch"),
  area: document.querySelector("#areaFilter"),
  domain: document.querySelector("#domainFilter"),
  type: document.querySelector("#typeFilter"),
  color: document.querySelector("#colorMode"),
  reset: document.querySelector("#resetFilters"),
  canvas: document.querySelector("#graphCanvas"),
  detail: document.querySelector("#graphDetail"),
  status: document.querySelector("#graphStatus"),
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

function cosmographPoints(bundle) {
  return bundle.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    area: node.area,
    domain: node.domain,
    type: node.typeLabel,
    color: node.color,
    size: node.size,
    x: node.x,
    y: node.y,
  }));
}

function cosmographLinks(bundle) {
  return bundle.links.map((link) => ({
    source: link.source,
    target: link.target,
    score: link.score,
  }));
}

function setDetailById(id) {
  const node = state.bundle?.nodes.find((item) => item.id === id);
  els.detail.innerHTML = renderDetailHtml(node, state.bundle?.links || []);
}

function graphHud(bundle, engine) {
  const scope = bundle.isFiltered ? `${bundle.matchedCount.toLocaleString()} matched · soft filter` : "Global scope";
  const colorMode = `${els.color.value[0].toUpperCase()}${els.color.value.slice(1)} color`;
  return `${bundle.nodes.length.toLocaleString()} points · ${bundle.links.length.toLocaleString()} links · ${colorMode} · ${scope} · ${engine}`;
}

async function renderGraph() {
  state.graph?.destroy?.();
  state.graph = null;
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
  state.bundle = bundle;
  if (!state.Cosmograph || !state.prepareCosmographData) {
    state.fallback = mountCanvasGraph(els.canvas, bundle, {
      detail: els.detail,
      onSelect: (node) => {
        els.detail.innerHTML = renderDetailHtml(node, state.bundle?.links || []);
      },
    });
    els.detail.innerHTML = renderDetailHtml(null);
    status(graphHud(bundle, "Cosmograph blocked, canvas fallback"), "ready");
    return;
  }
  status(`Preparing ${bundle.nodes.length.toLocaleString()} Cosmograph points`);
  const points = cosmographPoints(bundle);
  const links = cosmographLinks(bundle);
  const prepared = await state.prepareCosmographData({
    points: { pointIdBy: "id" },
    links: { linkSourceBy: "source", linkTargetsBy: ["target"] },
  }, points, links);
  state.graph = new state.Cosmograph(els.canvas, {
    points: prepared.points,
    links: prepared.links,
    ...prepared.cosmographConfig,
    backgroundColor: "#111827",
    pointColorBy: "area",
    pointColorByMap: AREA_COLORS,
    pointSizeBy: "size",
    pointLabelBy: "title",
    linkWidthBy: "score",
    showLabels: false,
    showDynamicLabels: false,
    hoveredPointCursor: "pointer",
    simulationRepulsion: 0.35,
    simulationLinkDistance: 18,
    simulationFriction: 0.84,
    onClick: (point) => {
      if (point?.id) setDetailById(point.id);
    },
  });
  els.detail.innerHTML = renderDetailHtml(null);
  status(graphHud(bundle, "Cosmograph runtime"), "ready");
}

function scheduleRender() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => void renderGraph(), 200);
}

function installEvents() {
  for (const input of [els.search, els.area, els.domain, els.type, els.color]) {
    input.addEventListener("input", scheduleRender);
    input.addEventListener("change", scheduleRender);
  }
  els.reset.addEventListener("click", () => {
    window.clearTimeout(state.renderTimer);
    els.search.value = "";
    els.area.value = "all";
    els.domain.value = "all";
    els.type.value = "all";
    els.color.value = "area";
    void renderGraph();
  });
}

async function init() {
  try {
    status("Loading semantic map data");
    let originalConsoleError = console.error;
    try {
      console.error = (...args) => {
        const text = args.map((item) => String(item)).join(" ");
        if (/luma\.gl/i.test(text) && /multiple versions|Found luma\.gl|yarn why/i.test(text)) return;
        originalConsoleError(...args);
      };
      const module = await Promise.race([
        import("https://cdn.jsdelivr.net/npm/@cosmograph/cosmograph@2.3.2/+esm"),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Cosmograph module timed out")), 4500)),
      ]);
      state.Cosmograph = module.Cosmograph;
      state.prepareCosmographData = module.prepareCosmographData;
    } catch (error) {
      console.warn("Cosmograph module unavailable; using canvas fallback", error);
    } finally {
      console.error = originalConsoleError;
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
    await renderGraph();
    installEvents();
  } catch (error) {
    console.error(error);
    status(`Cosmograph failed: ${error.message}`, "error");
    els.detail.innerHTML = `<div class="graph-empty"><strong>Graph unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

void init();
