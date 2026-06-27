import {
  MAP_URL,
  SEARCH_EMBEDDINGS_URL,
  TRENDS_URL,
} from "./config.js";
import {
  loadIndexData,
  loadShardRecords,
} from "./data-loader.js";
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
  queueWorkerSearch,
  refreshSearchWorkerIndex,
  updateHeader,
  updateSelects,
} from "./browse.js";
import {
  buildGraphData,
  configureMapCore,
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
  controlMiniGraph,
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
import { renderMapLegend } from "./map-legend.js";
import { loadSearchEmbeddings } from "./semantic-search.js";

let fullRecordsPromise = null;
let mapDataPromise = null;
let searchEmbeddingsStarted = false;

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
configureBrowse({
  applyFilterChange,
  renderAfterWorkerSearch() {
    if (state.tab === "map") renderMap();
    else renderResults();
  },
});
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

async function renderMap() {
  if (state.tab !== "map") return;
  const renderToken = ++state.mapRenderToken;
  if (!state.mapData?.records?.length) {
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>Loading map</strong><span>Reading the precomputed semantic graph.</span></div>`;
    await ensureMapData();
    if (renderToken !== state.mapRenderToken || state.tab !== "map") return;
  }
  if (!state.mapData?.records?.length) {
    state.mapGraph = null;
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No map data</strong><span>The precomputed semantic graph could not be loaded.</span></div>`;
    renderMapDetail(null);
    return;
  }
  const mapById = mapRecordById();
  const legendRecords = getFilteredRecords({ ignoreMapFilter: true }).filter((record) => record.mapAvailable && mapById.has(record.id));
  const visibleRecords = getFilteredRecords().filter((record) => record.mapAvailable && mapById.has(record.id));
  renderMapLegend(legendRecords, () => {
    state.selectedId = "";
    clearMapSelection();
    resetResultWindow();
    renderMap();
    renderViewer(null);
  }, () => {
    renderMap();
  });
  els.resultCount.textContent = `${visibleRecords.length.toLocaleString()} mapped records`;
  const query = normalize(state.query);
  const clusterSummary = state.mapColor === "embedding-cluster"
    ? `${state.mapEmbeddingClusterLevel} clusters`
    : "";
  const colorSummary = {
    "area-domain": "area + domain",
    "embedding-cluster": "embedding cluster",
    cluster: "semantic area group",
    area: "research area",
    domain: "domain",
  }[state.mapColor] || state.mapColor;
  els.activeSummary.textContent = activeFilterSummary("Map", [
    state.mapMode,
    colorSummary,
    clusterSummary,
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
  if (!selected) await loadTrends();
  renderMapDetail(selected || null);
}

configureViewer({
  controlMiniGraph,
  destroyMiniGraph,
  ensureMapData,
  findDisplayRecord,
  mountMiniGraph,
  renderMap,
  renderMiniMap,
  renderResults,
  semanticNeighborhood,
  updateHeader,
});

function renderDataHealthNote() {
  if (!els.dataNote) return;
  const embedding = state.data?.summary?.embedding || {};
  const status = embedding.status || "missing";
  const source = state.dataManifest ? "sharded index" : "monolithic index";
  const generatedAt = state.data?.generatedAt ? new Date(state.data.generatedAt).toLocaleString() : "";
  const stale = status !== "fresh";
  els.dataNote.classList.toggle("is-visible", stale);
  els.dataNote.classList.toggle("is-warning", stale);
  const loadedText = `Loaded ${escapeHtml(source)}${generatedAt ? ` · ${escapeHtml(generatedAt)}` : ""}.`;
  const messages = {
    fresh: ["Semantic index fresh.", loadedText],
    legacy: ["Semantic metadata pending.", `${loadedText} Existing semantic vectors are available; the rebuild workflow will attach freshness metadata.`],
    stale: ["Semantic rebuild recommended.", `${loadedText} Dense vectors may be older than the current records, so search also uses lexical fallback.`],
    missing: ["Semantic fallback active.", `${loadedText} Dense vectors are not available yet, so map/search use lexical fallback until the rebuild workflow runs.`],
  };
  const [title, body] = messages[status] || messages.missing;
  els.dataNote.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`;
}

async function hydrateFullRecords() {
  if (!state.dataManifest || state.dataShardsLoaded) return;
  const records = await loadShardRecords(state.dataManifest);
  if (!records?.length) return;
  const selectedId = state.selectedId;
  const shouldRestoreMapViewer = state.tab === "map" && selectedId;
  const enrichedRecords = enrichPaperPresentationRecords(records);
  if (state.mapData?.records?.length) enrichEmbeddingClusterRecords(enrichedRecords);
  state.data.records = enrichedRecords;
  state.dataShardsLoaded = true;
  refreshSearchWorkerIndex();
  queueWorkerSearch();
  updateHeader();
  renderAll();
  if (shouldRestoreMapViewer) {
    const selected = findDisplayRecord(selectedId);
    if (selected) renderViewer(selected);
  }
}

function hydrateFullRecordsInBackground() {
  if (fullRecordsPromise || state.dataShardsLoaded) return fullRecordsPromise;
  fullRecordsPromise = hydrateFullRecords().catch(() => null);
  return fullRecordsPromise;
}

function scheduleFullRecordsHydration() {
  window.setTimeout(() => {
    void hydrateFullRecordsInBackground();
  }, 3000);
}

function renderAll() {
  els.tabs.forEach((button) => {
    const count = button.dataset.tab === "map"
      ? displayRecords().filter((record) => record.mapAvailable && (!state.mapData?.records?.length || mapRecordById().has(record.id))).length
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
  queueWorkerSearch();
  if (state.query) void hydrateFullRecordsInBackground();
  if (state.tab === "map" && state.query) loadSearchEmbeddingsInBackground();
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
  if (searchEmbeddingsStarted) return;
  searchEmbeddingsStarted = true;
  void loadSearchEmbeddings(SEARCH_EMBEDDINGS_URL)
    .finally(rerenderActiveMapQuery);
}

function updateClusterLevelVisibility() {
  if (els.mapClusterLevelSetting) {
    els.mapClusterLevelSetting.hidden = state.mapColor !== "embedding-cluster";
  }
}

async function ensureMapData() {
  if (state.mapData?.records?.length) return state.mapData;
  if (!mapDataPromise) {
    mapDataPromise = fetch(MAP_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${MAP_URL} (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        state.mapData = payload;
        enrichEmbeddingClusterRecords(state.data?.records || []);
        refreshSearchWorkerIndex();
        queueWorkerSearch();
        updateHeader();
        return payload;
      })
      .catch(() => {
        state.mapData = null;
        return null;
      });
  }
  return mapDataPromise;
}

function enrichEmbeddingClusterRecords(records) {
  const clusters = new Map((state.mapData?.embeddingClusters || []).map((cluster) => [cluster.id, cluster]));
  const levelLookups = new Map();
  for (const level of state.mapData?.embeddingClusterLevels || []) {
    const key = String(level.k || "");
    levelLookups.set(key, {
      assignments: level.assignments || [],
      clusters: level.clusters || [],
    });
  }
  const missing = [];
  const mapRecordIndexes = new Map((state.mapData?.records || []).map((record, index) => [record.id, index]));
  for (const record of records || []) {
    if (!record.embeddingClusterId) continue;
    const cluster = clusters.get(record.embeddingClusterId);
    if (!cluster?.label || !Array.isArray(cluster.topTerms)) {
      missing.push(`${record.id}:${record.embeddingClusterId}`);
      continue;
    }
    record.embeddingClusterLabel = cluster.label || "";
    record.embeddingClusterKeywords = cluster.topTerms || [];
    const mapIndex = mapRecordIndexes.get(record.id);
    record.embeddingClusterLevels = {};
    for (const [key, level] of levelLookups.entries()) {
      const clusterIndex = level.assignments[mapIndex];
      const levelCluster = Number.isInteger(clusterIndex) ? level.clusters[clusterIndex] : null;
      if (levelCluster?.label && Array.isArray(levelCluster.topTerms)) {
        record.embeddingClusterLevels[key] = {
          id: levelCluster.id,
          label: levelCluster.label,
          size: levelCluster.size,
          topTerms: levelCluster.topTerms,
          method: levelCluster.method,
        };
      }
    }
    delete record._hayParts;
    delete record._haystack;
    delete record._queryVector;
  }
  if (missing.length) {
    throw new Error(`Missing embedding cluster metadata for ${missing.length} records (${missing.slice(0, 5).join(", ")})`);
  }
}

async function loadTrends() {
  if (state.trendsLoaded) return;
  state.trendsLoaded = true;
  try {
    const response = await fetch(TRENDS_URL);
    state.trendData = response.ok ? await response.json() : null;
  } catch {
    state.trendData = null;
  }
}

async function init() {
  installMapDebugProbe();
  els.results.innerHTML = `<div class="empty-state"><strong>Loading index</strong><span>Reading the local ICML 2026 manifest.</span></div>`;
  const loaded = await loadIndexData();
  state.data = loaded.data;
  state.dataManifest = loaded.manifest;
  state.data.records = enrichPaperPresentationRecords(state.data.records || []);
  renderDataHealthNote();
  refreshSearchWorkerIndex();
  updateHeader();
  updateClusterLevelVisibility();
  renderAll();
  scheduleFullRecordsHydration();
  window.addEventListener("icml-semantic-search-ready", (event) => {
    if (state.tab !== "map") return;
    if (normalize(state.query) !== event.detail?.query) return;
    renderMap();
  });
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
        loadSearchEmbeddingsInBackground();
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
    state.mapLegendExpanded = false;
    updateClusterLevelVisibility();
    clearMapSelection();
    renderMap();
  });
  els.mapClusterLevel?.addEventListener("change", (event) => {
    state.mapEmbeddingClusterLevel = event.target.value;
    state.mapFilterValue = "";
    state.mapLegendExpanded = false;
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
