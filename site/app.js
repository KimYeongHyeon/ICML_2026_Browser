import {
  DATA_URL,
  MAP_URL,
  SEARCH_EMBEDDINGS_URL,
} from "./config.js";
import { els } from "./dom.js";
import { enrichPaperPresentationRecords } from "./records.js";
import { state } from "./state.js";
import { escapeHtml, normalize } from "./utils.js";
import {
  configureViewer,
  renderViewer,
} from "./viewer.js";
import {
  activeFilterSummary,
  configureBrowse,
  displayRecords,
  ensureVisibleSelection,
  findDisplayRecord,
  getFilteredRecords,
  loadMoreResultsIfNeeded,
  renderResults,
  resetResultWindow,
  toggleSaved,
  updateHeader,
  updateSelects,
} from "./browse.js";
import { colorForValue } from "./map-tooltip.js";
import {
  buildGraphData,
  configureMapCore,
  mapColorValue,
  mapRecordById,
  mapSearchSummary,
  mapSemanticSearchIds,
} from "./map-core.js";
import { installMapDebugProbe } from "./map-debug.js";
import {
  applyMapMotionSettings,
  configureMapEngine,
  destroyGraphEngine,
  ensureCytoscapeLibrary,
  fitForceGraph,
  reflowMap,
  renderCytoscapeGraph,
  renderForceGraph,
  zoomMap,
} from "./map-engine.js";
import {
  configureMapDetail,
  destroyMiniGraph,
  mountMiniGraph,
  renderMapDetail,
  renderMiniMap,
  semanticNeighborhood,
} from "./map-detail.js";
import {
  clearMapSelection,
  configureMapInteractions,
  ensureMapSelectionBox,
  hideGraphTooltip,
  installMapPointerInteractions,
  showGraphTooltip,
} from "./map-interactions.js";
import { loadSavedIds } from "./saved.js";
import { loadSearchEmbeddings } from "./semantic-search.js";

configureMapCore({ findDisplayRecord });
configureMapEngine({
  ensureMapSelectionBox,
  findDisplayRecord,
  hideGraphTooltip,
  renderMap,
  renderMapDetail,
  renderViewer,
  showGraphTooltip,
});
configureBrowse({ applyFilterChange });
configureMapDetail({
  findDisplayRecord,
  hideGraphTooltip,
  renderAll,
  renderMap,
  renderResults,
  renderViewer,
  showGraphTooltip,
});
configureMapInteractions({
  findDisplayRecord,
  renderViewer,
});

function renderMapLegend(visibleRecords) {
  if (!els.mapLegend) return;
  if (state.mapColor === "quality" || state.mapColor === "availability") {
    state.mapColor = "area-domain";
    if (els.mapColor) els.mapColor.value = state.mapColor;
  }
  const counts = new Map();
  for (const record of visibleRecords) {
    const value = mapColorValue(record);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const items = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);
  const allCount = visibleRecords.length;
  els.mapLegend.innerHTML = `
    ${state.mapColor === "area-domain" ? `<div class="legend-note">Fill = research area. Shape = domain. Ring = domain accent. Click an area to filter.</div>` : ""}
    <button class="legend-item legend-all${state.mapFilterValue ? "" : " is-active"}" type="button" data-value="" title="Show all color groups">
      <span class="legend-swatch legend-swatch-all"></span>
      <span>All</span>
      <strong>${allCount.toLocaleString()}</strong>
    </button>
  ` + items.map(([value, count]) => `
    <button class="legend-item${state.mapFilterValue === value ? " is-active" : ""}" type="button" data-value="${escapeHtml(value)}" title="${escapeHtml(state.mapColor === "area-domain" ? `Filter area: ${value}` : value)}">
      <span class="legend-swatch" style="background:${colorForValue(value)}"></span>
      <span>${escapeHtml(value)}</span>
      <strong>${count.toLocaleString()}</strong>
    </button>
  `).join("");
  els.mapLegend.querySelectorAll(".legend-item").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.value || "";
      state.mapFilterValue = state.mapFilterValue === value ? "" : value || "";
      state.selectedId = "";
      clearMapSelection();
      resetResultWindow();
      renderMap();
      renderViewer(null);
    });
  });
}

async function renderMap() {
  if (state.tab !== "map") return;
  const renderToken = ++state.mapRenderToken;
  if (!state.mapData?.records?.length) {
    state.mapGraph = null;
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No map data</strong><span>Run the semantic map builder.</span></div>`;
    renderMapDetail(null);
    return;
  }
  const mapById = mapRecordById();
  const legendRecords = getFilteredRecords({ ignoreMapFilter: true }).filter((record) => record.mapAvailable && mapById.has(record.id));
  const visibleRecords = getFilteredRecords().filter((record) => record.mapAvailable && mapById.has(record.id));
  renderMapLegend(legendRecords);
  els.resultCount.textContent = `${visibleRecords.length.toLocaleString()} mapped records`;
  const query = normalize(state.query);
  els.activeSummary.textContent = activeFilterSummary("Map", [
    state.mapMode,
    state.mapColor === "area-domain" ? "area + domain" : state.mapColor,
    state.mapFilterValue,
    mapSearchSummary(visibleRecords, query),
  ]);
  if (!visibleRecords.length) {
    destroyGraphEngine();
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No mapped records</strong><span>Adjust the filters.</span></div>`;
    renderMapDetail(null);
    return;
  }
  if (!visibleRecords.some((record) => record.id === state.selectedId)) {
    state.selectedId = "";
  }
  const graphData = buildGraphData(visibleRecords, mapById);
  let rendered = false;
  try {
    if (state.mapEngine === "cytoscape") {
      els.mapCanvas.innerHTML = `<div class="empty-state"><strong>Loading Cytoscape.js</strong><span>Preparing the alternate graph engine.</span></div>`;
      await ensureCytoscapeLibrary();
      if (renderToken !== state.mapRenderToken || state.tab !== "map") return;
      rendered = renderCytoscapeGraph(graphData);
    } else {
      rendered = renderForceGraph(graphData);
    }
  } catch {
    rendered = false;
  }
  if (!rendered) {
    destroyGraphEngine();
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>Graph library unavailable</strong><span>The selected graph engine could not be loaded.</span></div>`;
    renderMapDetail(null);
    return;
  }
  const selected = findDisplayRecord(state.selectedId);
  renderMapDetail(selected || null);
}

configureViewer({
  destroyMiniGraph,
  findDisplayRecord,
  mountMiniGraph,
  renderMap,
  renderMiniMap,
  renderResults,
  semanticNeighborhood,
  toggleSaved,
  updateHeader,
});

function renderAll() {
  els.tabs.forEach((button) => {
    const count = button.dataset.tab === "map"
      ? displayRecords().filter((record) => record.mapAvailable && mapRecordById().has(record.id)).length
      : displayRecords().filter((record) => record.type === button.dataset.tab).length;
    button.hidden = count === 0;
    button.classList.toggle("is-active", button.dataset.tab === state.tab);
  });
  updateSelects();
  resetResultWindow();
  const isMap = state.tab === "map";
  document.body.classList.toggle("is-map-tab", isMap);
  els.results.hidden = isMap;
  els.mapView.hidden = !isMap;
  const selected = isMap ? null : ensureVisibleSelection();
  if (!isMap && state.mapGraph) {
    state.mapGraph.pauseAnimation?.();
  } else if (isMap && state.mapGraph && state.mapLive) {
    state.mapGraph.resumeAnimation?.();
  }
  renderResults();
  renderMap();
  renderViewer(selected);
}

function applyFilterChange({ clearQuery = false } = {}) {
  if (clearQuery) {
    state.query = "";
    els.search.value = "";
    if (els.mapSearch) els.mapSearch.value = "";
  } else if (els.mapSearch && els.mapSearch.value !== state.query) {
    els.mapSearch.value = state.query;
  }
  state.mapFilterValue = "";
  clearMapSelection();
  resetResultWindow();
  const selected = ensureVisibleSelection();
  renderResults();
  renderMap();
  renderViewer(state.tab === "map" ? null : selected);
}

function rerenderActiveMapQuery() {
  if (state.tab !== "map") return;
  if (!normalize(state.query)) return;
  void renderMap();
}

function loadSearchEmbeddingsInBackground() {
  void loadSearchEmbeddings(SEARCH_EMBEDDINGS_URL)
    .finally(rerenderActiveMapQuery);
}

async function init() {
  installMapDebugProbe();
  els.results.innerHTML = `<div class="empty-state"><strong>Loading index</strong><span>Reading the local ICML 2026 manifest.</span></div>`;
  const response = await fetch(DATA_URL);
  state.data = await response.json();
  state.data.records = enrichPaperPresentationRecords(state.data.records || []);
  state.savedIds = loadSavedIds();
  try {
    const mapResponse = await fetch(MAP_URL);
    state.mapData = mapResponse.ok ? await mapResponse.json() : null;
  } catch {
    state.mapData = null;
  }
  updateHeader();
  renderAll();
  window.addEventListener("icml-semantic-search-ready", (event) => {
    if (state.tab !== "map") return;
    if (normalize(state.query) !== event.detail?.query) return;
    renderMap();
  });
  loadSearchEmbeddingsInBackground();

  els.tabs.forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.tab;
      const tabChanged = nextTab !== state.tab;
      state.tab = nextTab;
      if (tabChanged) {
        state.query = "";
        els.search.value = "";
        if (els.mapSearch) els.mapSearch.value = "";
      }
      state.category = "all";
      state.group = "all";
      state.asset = "all";
      state.mapFilterValue = "";
      if (nextTab === "map") {
        state.selectedId = "";
      }
      clearMapSelection();
      els.asset.value = "all";
      resetResultWindow();
      renderAll();
      window.scrollTo(0, 0);
    });
  });

  els.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    if (els.mapSearch && els.mapSearch.value !== state.query) els.mapSearch.value = state.query;
    applyFilterChange();
  });
  els.mapSearch?.addEventListener("input", (event) => {
    state.query = event.target.value;
    if (els.search.value !== state.query) els.search.value = state.query;
    applyFilterChange();
  });
  els.category.addEventListener("change", (event) => {
    state.category = event.target.value;
    applyFilterChange();
  });
  els.group.addEventListener("change", (event) => {
    state.group = event.target.value;
    applyFilterChange();
  });
  els.asset.addEventListener("change", (event) => {
    state.asset = event.target.value;
    applyFilterChange();
  });
  els.mapColor.addEventListener("change", (event) => {
    state.mapColor = ["quality", "availability"].includes(event.target.value) ? "area-domain" : event.target.value;
    els.mapColor.value = state.mapColor;
    state.mapFilterValue = "";
    clearMapSelection();
    renderMap();
  });
  els.mapEngine.addEventListener("change", (event) => {
    state.mapEngine = event.target.value;
    state.mapInteraction.spaceDown = false;
    state.mapInteraction.pointerId = null;
    state.mapInteraction.mode = "";
    els.mapCanvas.classList.remove("is-space-ready", "is-panning");
    clearMapSelection();
    destroyGraphEngine();
    renderMap();
  });
  els.mapMode.addEventListener("change", (event) => {
    state.mapMode = event.target.value;
    clearMapSelection();
    renderMap();
  });
  els.mapLive?.addEventListener("click", () => {
    state.mapLive = !state.mapLive;
    applyMapMotionSettings();
    if (state.mapLive) reflowMap();
  });
  els.mapReflow?.addEventListener("click", () => reflowMap());
  els.mapFit?.addEventListener("click", () => reflowMap({ fit: true }));
  els.mapZoomOut?.addEventListener("click", () => zoomMap(0.78));
  els.mapZoomIn?.addEventListener("click", () => zoomMap(1.28));
  els.results.addEventListener("scroll", () => {
    const distanceFromBottom = els.results.scrollHeight - els.results.scrollTop - els.results.clientHeight;
    if (distanceFromBottom < 320) {
      loadMoreResultsIfNeeded();
    }
  });
  window.addEventListener("resize", () => {
    if (state.tab === "map" && state.mapGraph) {
      state.mapGraph
        .width(els.mapCanvas.clientWidth || 840)
        .height(els.mapCanvas.clientHeight || 640);
      fitForceGraph(state.mapGraph, state.mapGraphData, { duration: 180 });
    }
    if (state.tab === "map" && state.cyGraph) {
      state.cyGraph.resize();
      state.cyGraph.fit(undefined, 48);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!state.mapGraph) return;
    if (document.hidden || state.tab !== "map") {
      state.mapGraph.pauseAnimation?.();
    } else if (state.mapLive) {
      state.mapGraph.resumeAnimation?.();
    }
  });
  installMapPointerInteractions();
}

init().catch((error) => {
  els.results.innerHTML = `<div class="empty-state"><strong>Could not load data</strong><span>${escapeHtml(error.message)}</span></div>`;
});
