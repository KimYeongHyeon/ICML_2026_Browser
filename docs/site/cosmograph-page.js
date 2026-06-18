import {
  AREA_COLORS,
  DOMAIN_COLORS,
  TYPE_COLORS,
  buildSemanticGraph,
  escapeHtml,
  loadGraphBundle,
  renderDetailHtml,
} from "./graph-data.js";

// Cosmograph colors points by a data attribute + value→color map. Points carry
// area / domain / type (typeLabel) attributes, so pick the attribute and map
// that match the selected Color By mode. TYPE_COLORS is keyed by lowercase type,
// but the point attribute is the capitalized typeLabel, hence this remap.
const TYPE_LABEL_COLORS = {
  Paper: TYPE_COLORS.paper,
  Poster: TYPE_COLORS.poster,
  Workshop: TYPE_COLORS.workshop,
};

function cosmographColorBy(mode) {
  if (mode === "domain") return { by: "domain", map: DOMAIN_COLORS };
  if (mode === "type") return { by: "type", map: TYPE_LABEL_COLORS };
  return { by: "area", map: AREA_COLORS };
}

// luma.gl (Cosmograph's WebGL layer) emits a benign multiple-version console
// error asynchronously during WebGL init when 9.2.x copies collide. It is the
// documented "Cosmograph blocked → canvas fallback" condition (MAP_SPEC §12.4),
// not an application error, and it can fire *after* the dynamic import resolves —
// so filter just that noise for the page lifetime rather than only during the
// import window. Every other console error passes through untouched.
const baseConsoleError = console.error.bind(console);
console.error = (...args) => {
  const text = args.map((item) => String(item)).join(" ");
  if (/luma\.gl/i.test(text) && /multiple versions|Found luma\.gl|yarn why/i.test(text)) return;
  baseConsoleError(...args);
};
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
  fit: document.querySelector("#fitGraph"),
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
    mountCosmographFallback(bundle);
    return;
  }
  // The CDN module can load while the WebGL/luma runtime still fails to
  // initialize (the documented Cosmograph-blocked condition, MAP_SPEC §12.4/§13).
  // Wrap prep + construction so any such throw falls back to the canvas graph
  // instead of dropping the whole page into an error state with no graph.
  try {
    status(`Preparing ${bundle.nodes.length.toLocaleString()} Cosmograph points`);
    const points = cosmographPoints(bundle);
    const links = cosmographLinks(bundle);
    // Cosmograph's Data Kit only prepares the columns declared here, so every
    // field the runtime config consumes (color/size/label/position/width) must
    // be declared before prepareCosmographData runs — otherwise Domain/Type
    // colors and the projected x/y layout point at columns never ingested.
    const colorBy = cosmographColorBy(els.color.value);
    const prepared = await state.prepareCosmographData({
      points: {
        pointIdBy: "id",
        pointColorBy: colorBy.by,
        pointSizeBy: "size",
        pointLabelBy: "title",
        pointXBy: "x",
        pointYBy: "y",
      },
      links: {
        linkSourceBy: "source",
        linkTargetsBy: ["target"],
        linkWidthBy: "score",
      },
    }, points, links);
    state.graph = new state.Cosmograph(els.canvas, {
      points: prepared.points,
      links: prepared.links,
      ...prepared.cosmographConfig,
      backgroundColor: "#111827",
      pointColorByMap: colorBy.map,
      showLabels: false,
      showDynamicLabels: false,
      showHoveredPointLabel: true,
      hoveredPointCursor: "pointer",
      simulationRepulsion: 0.35,
      simulationLinkDistance: 18,
      simulationFriction: 0.84,
      onClick: (index) => {
        // Cosmograph's click callback passes (index, position, event), not a
        // point object. Map the index back to the original point id via the
        // bundle (same order as the points passed to prepareCosmographData);
        // a background click (no index) clears the detail panel.
        const node = typeof index === "number" ? state.bundle?.nodes[index] : null;
        if (node?.id) {
          setDetailById(node.id);
        } else {
          els.detail.innerHTML = renderDetailHtml(null);
        }
      },
    });
    els.detail.innerHTML = renderDetailHtml(null);
    status(graphHud(bundle, "Cosmograph runtime"), "ready");
  } catch (error) {
    console.warn("Cosmograph runtime init failed; using canvas fallback", error);
    state.graph?.destroy?.();
    state.graph = null;
    els.canvas.innerHTML = "";
    mountCosmographFallback(bundle);
  }
}

// Mount the local canvas graph that honestly renders the same semantic data
// whenever the Cosmograph runtime is unavailable or fails to initialize.
function mountCosmographFallback(bundle) {
  state.fallback = mountCanvasGraph(els.canvas, bundle, {
    detail: els.detail,
    onSelect: (node) => {
      els.detail.innerHTML = renderDetailHtml(node, state.bundle?.links || []);
    },
  });
  els.detail.innerHTML = renderDetailHtml(null);
  status(graphHud(bundle, "Cosmograph blocked, canvas fallback"), "ready");
}

function scheduleRender() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => void renderGraph(), 200);
}

// Reset the camera to the full graph view (MAP_SPEC §9.2). Works for both the
// Cosmograph runtime (fitView) and the canvas fallback (.fit()).
function fitGraph() {
  if (state.fallback) {
    state.fallback.fit();
    return;
  }
  state.graph?.fitView?.();
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
  els.fit.addEventListener("click", fitGraph);
}

async function init() {
  try {
    status("Loading semantic map data");
    try {
      const module = await Promise.race([
        import("https://cdn.jsdelivr.net/npm/@cosmograph/cosmograph@2.3.2/+esm"),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Cosmograph module timed out")), 4500)),
      ]);
      state.Cosmograph = module.Cosmograph;
      state.prepareCosmographData = module.prepareCosmographData;
    } catch (error) {
      console.warn("Cosmograph module unavailable; using canvas fallback", error);
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
