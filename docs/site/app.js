import {
  MAP_URL,
  SEARCH_EMBEDDINGS_URL,
} from "./config.js";
import {
  loadIndexData,
  loadShardRecords,
} from "./data-loader.js";
import { els } from "./dom.js";
import { enrichPaperPresentationRecords } from "./records.js";
import { state } from "./state.js";
import { escapeHtml, normalize, plainMathTitle } from "./utils.js";
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
  fitForceGraph,
  reflowMap,
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
import { renderSemanticInsightPanel } from "./semantic-insights.js";
import { loadSearchEmbeddings } from "./semantic-search.js";
import { loadStudyFeatures } from "./study-features.js";
import { loadTrends } from "./trends.js";
import {
  loadReferenceRecord,
  loadReferencesManifest,
} from "./references.js";

let fullRecordsPromise = null;
let mapDataPromise = null;
let studyFeaturesPromise = null;
let searchEmbeddingsStarted = false;

configureMapCore({ findDisplayRecord });
configureMapEngine({
  ensureMapSelectionBox,
  hideGraphTooltip,
});
configureBrowse({
  applyFilterChange,
  hydrateSelectedRecord(recordId) {
    void hydrateFullRecordsInBackground().then(() => {
      if (state.selectedId !== recordId || state.tab === "map" || state.tab === "references") return;
      const selected = findDisplayRecord(recordId);
      if (!selected) return;
      renderResults();
      renderViewer(selected);
    });
  },
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
  ensureStudyFeatures,
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
  renderSemanticInsightPanel(visibleRecords, query);
  if ((query || state.selectedId) && !state.studyFeaturesLoaded) {
    void ensureStudyFeatures().then(() => {
      if (renderToken === state.mapRenderToken && state.tab === "map") renderMap();
    });
  }
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
    rendered = renderForceGraph(graphData);
  } catch {
    rendered = false;
  }
  if (!rendered) {
    destroyGraphEngine();
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>Graph library unavailable</strong><span>ForceGraph could not be loaded.</span></div>`;
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
  ensureStudyFeatures,
  updateHeader,
});

function renderDataHealthNote() {
  if (!els.dataNote) return;
  const embedding = state.data?.summary?.embedding || {};
  const summary = state.data?.summary || {};
  const typeCounts = summary.typeCounts || {};
  const assetCounts = summary.assetCounts || {};
  const status = embedding.status || "missing";
  const source = state.dataManifest ? "sharded index" : "monolithic index";
  const generatedAt = state.data?.generatedAt ? new Date(state.data.generatedAt).toLocaleString() : "";
  const stale = status !== "fresh";
  els.dataNote.classList.add("is-visible");
  els.dataNote.classList.toggle("is-warning", stale);
  const loadedText = `Loaded ${escapeHtml(source)}${generatedAt ? ` · ${escapeHtml(generatedAt)}` : ""}.`;
  const snapshot = [
    `${Number(typeCounts.paper || 0).toLocaleString()} papers`,
    `${Number(typeCounts.workshop || 0).toLocaleString()} workshops`,
    `${Number(assetCounts.pdf || 0).toLocaleString()} local PDFs`,
  ].filter((item) => !item.startsWith("0 ")).join(" · ");
  const messages = {
    fresh: ["Data snapshot.", `${loadedText}${snapshot ? ` ${snapshot}.` : ""} Semantic index fresh.`],
    legacy: ["Semantic metadata pending.", `${loadedText} Existing semantic vectors are available; the rebuild workflow will attach freshness metadata.`],
    stale: ["Semantic rebuild recommended.", `${loadedText} Dense vectors may be older than the current records, so search also uses lexical matching.`],
    missing: ["Semantic search limited.", `${loadedText} Dense vectors are not available yet, so map/search use lexical matching until the rebuild workflow runs.`],
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

function scheduleMapDataPreload() {
  if (state.mapData?.records?.length) return;
  const preload = () => void ensureMapData();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preload, { timeout: 1800 });
  } else {
    window.setTimeout(preload, 900);
  }
}

function referenceStat(label, value) {
  return `<span><strong>${Number(value || 0).toLocaleString()}</strong><small>${escapeHtml(label)}</small></span>`;
}

function referencePercent(part, total) {
  const denominator = Number(total || 0);
  if (!denominator) return "0%";
  return `${Math.round((Number(part || 0) / denominator) * 100)}%`;
}

function hasMetricValue(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key) && value[key] !== null && value[key] !== undefined;
}

function metricNumber(value, key) {
  return Number(value?.[key] || 0);
}

function referenceCandidateCount(manifest) {
  const summary = manifest?.summary || {};
  const source = manifest?.source || {};
  const sourceCandidates = Number(source.matchedRecords || 0) + Number(source.unmatchedRecords || 0);
  const summaryCandidates = Number(summary.matchedRecords || 0) + Number(summary.unmatchedRecords || 0);
  if (hasMetricValue(source, "pdfRecords")) return metricNumber(source, "pdfRecords");
  if (hasMetricValue(summary, "pdfRecords")) return metricNumber(summary, "pdfRecords");
  if (hasMetricValue(source, "matchedRecords") || hasMetricValue(source, "unmatchedRecords")) return sourceCandidates;
  if (hasMetricValue(summary, "matchedRecords") || hasMetricValue(summary, "unmatchedRecords")) return summaryCandidates;
  if (hasMetricValue(summary, "recordCount")) return metricNumber(summary, "recordCount");
  return 0;
}

function referenceCoveredCount(manifest) {
  const summary = manifest?.summary || {};
  const source = manifest?.source || {};
  if (hasMetricValue(summary, "recordsWithReferences")) return metricNumber(summary, "recordsWithReferences");
  if (hasMetricValue(summary, "matchedRecords")) return metricNumber(summary, "matchedRecords");
  if (hasMetricValue(source, "matchedRecords")) return metricNumber(source, "matchedRecords");
  if (hasMetricValue(summary, "recordCount")) return metricNumber(summary, "recordCount");
  return 0;
}

function optionalSummaryNumber(manifest, key) {
  const summary = manifest?.summary || {};
  const source = manifest?.source || {};
  if (hasMetricValue(summary, key)) return metricNumber(summary, key);
  if (hasMetricValue(source, key)) return metricNumber(source, key);
  return null;
}

function optionalMetricLabel(value) {
  return value === null ? "unknown" : Number(value || 0).toLocaleString();
}

function referenceCountChips(items = []) {
  return items.slice(0, 10).map((item) => `
    <span class="reference-chip"><b>${escapeHtml(item.label || item.author || "")}</b>${Number(item.references || item.count || 0).toLocaleString()}</span>
  `).join("");
}

function referenceDisplayText(item = {}) {
  return plainMathTitle(item.title || item.raw || item.key || "").replace(/\s+/g, " ").trim();
}

function looksLikeCitationTitle(text) {
  const value = String(text || "").trim();
  if (value.length < 18) return false;
  if (/^(url\s+https?:|https?:|arxiv preprint|openreview\.net|association for computational linguistics)$/i.test(value)) return false;
  if (/^(and|[a-z]\.)\s+/i.test(value)) return false;
  if (/^[A-Za-z]{1,3},\s*[A-Z]\./.test(value)) return false;
  if (/[a-z]{3,}[A-Z]\.,/.test(value)) return false;
  if (/^(?:[A-Z][\w'’.-]+,\s*(?:[A-Z]\.|[A-Z][a-z]+|et al\.?)\s*){2,}$/u.test(value)) return false;
  if (/^[A-Z]\.,?\s+/.test(value) || /^[A-Z][\w'’.-]+,\s+[A-Z]\.?[, ]/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  return /[a-z]{3,}/i.test(value);
}

function referenceCitationItems(items = [], limit = 12) {
  const seen = new Set();
  return items
    .map((item) => ({ ...item, displayText: referenceDisplayText(item) }))
    .filter((item) => {
      const key = item.displayText.toLowerCase();
      if (!looksLikeCitationTitle(item.displayText) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function referenceBadge(value) {
  return value ? `<b>${escapeHtml(String(value))}</b>` : "";
}

function overlapStrength(sharedCount, score) {
  const shared = Number(sharedCount || 0);
  const ratio = Number(score || 0);
  if (shared >= 5 || ratio >= 0.12) return "strong";
  if (shared >= 3 || ratio >= 0.06) return "moderate";
  return "weak";
}

function renderReferenceGraph(payload = {}, record = null) {
  const overlaps = (payload.overlaps || []).slice(0, 10);
  if (!overlaps.length) {
    return `<div class="reference-overlap-graph is-empty">No shared-reference graph yet.</div>`;
  }
  const width = 760;
  const height = 260;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 94;
  const maxShared = Math.max(1, ...overlaps.map((item) => Number(item.sharedCount || 0)));
  const centerRadius = Math.min(34, 15 + Math.sqrt(Number(payload.referenceCount || 0)));
  const nodes = overlaps.map((item, index) => {
    const angle = (-Math.PI / 2) + (index / overlaps.length) * Math.PI * 2;
    const shared = Number(item.sharedCount || 0);
    return {
      ...item,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      r: 8 + (shared / maxShared) * 12,
      title: plainMathTitle(findDisplayRecord(item.recordId)?.title || item.title || item.recordId),
    };
  });
  return `
    <div class="reference-overlap-graph" aria-label="Citation overlap graph">
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <title>${escapeHtml(plainMathTitle(record?.title || payload.title || "Selected record"))} citation overlap graph</title>
        ${nodes.map((node) => `
          <line
            x1="${cx}"
            y1="${cy}"
            x2="${node.x.toFixed(1)}"
            y2="${node.y.toFixed(1)}"
            style="--w:${(1.2 + (Number(node.sharedCount || 0) / maxShared) * 4).toFixed(2)}"
          />
        `).join("")}
        <circle class="reference-node is-selected" cx="${cx}" cy="${cy}" r="${centerRadius}">
          <title>${escapeHtml(plainMathTitle(record?.title || payload.title || "Selected record"))} · ${Number(payload.referenceCount || 0).toLocaleString()} refs</title>
        </circle>
        ${nodes.map((node, index) => `
          <a href="#" data-id="${escapeHtml(node.recordId)}" aria-label="${escapeHtml(node.title)}">
            <circle class="reference-node" cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${node.r.toFixed(1)}">
              <title>${escapeHtml(node.title)} · ${Number(node.sharedCount || 0).toLocaleString()} shared refs</title>
            </circle>
            <text x="${node.x.toFixed(1)}" y="${(node.y + 4).toFixed(1)}">${index + 1}</text>
          </a>
        `).join("")}
      </svg>
      <small>Node size follows shared reference count. Edge width follows shared references with the selected paper.</small>
    </div>
  `;
}

function renderReferencesLoading() {
  els.referencesView.innerHTML = `<div class="empty-state"><strong>Loading references</strong><span>Reading the citation overlap index.</span></div>`;
}

async function renderReferences() {
  if (state.tab !== "references") return;
  if (!state.referencesManifestLoaded) renderReferencesLoading();
  const manifest = await loadReferencesManifest();
  if (state.tab !== "references") return;
  if (!manifest) {
    els.referencesView.innerHTML = `<div class="empty-state"><strong>No reference index</strong><span>Run the reference builder.</span></div>`;
    return;
  }
  const summary = manifest.summary || {};
  const totalCandidates = referenceCandidateCount(manifest);
  const coveredReferences = referenceCoveredCount(manifest);
  const referenceCoverage = referencePercent(coveredReferences, totalCandidates);
  const withoutExtractedReferences = Math.max(0, totalCandidates - coveredReferences);
  const remoteAttempted = optionalSummaryNumber(manifest, "remotePdfAttemptedRecords");
  const blockedRemote = optionalSummaryNumber(manifest, "remotePdfBlockedRecords");
  const extractionErrors = Number(summary.extractionErrors || summary.errors || 0);
  const remoteHealthUnknown = remoteAttempted === null || blockedRemote === null;
  const records = Object.entries(manifest.records || {})
    .map(([id, entry]) => ({ id, ...entry, record: findDisplayRecord(id) }))
    .filter((item) => item.record)
    .sort((left, right) => (right.overlapCount - left.overlapCount) || (right.referenceCount - left.referenceCount))
    .slice(0, 16);
  const topReferences = referenceCitationItems(manifest.analysis?.topReferences || [], 12);
  els.resultCount.textContent = `${Number(summary.recordCount || 0).toLocaleString()} reference records`;
  els.activeSummary.textContent = activeFilterSummary("References", [
    `${Number(summary.recordsWithReferences || 0).toLocaleString()} reference sets`,
    `${Number(summary.recordsWithOverlaps || 0).toLocaleString()} overlap groups`,
  ]);
  els.referencesView.innerHTML = `
    <section class="reference-dashboard">
      <div class="reference-dashboard-head">
        <div>
          <p class="eyebrow">Bibliographic citations</p>
          <h2>Reference analysis</h2>
        </div>
        <span>Lazy-loaded · not part of startup</span>
      </div>
      <div class="selection-stat-grid reference-stat-grid">
        ${referenceStat("matched records", summary.matchedRecords || summary.pdfRecords)}
        ${referenceStat("reference sets", coveredReferences)}
        ${referenceStat("overlap groups", summary.recordsWithOverlaps)}
        ${referenceStat("unique references", summary.uniqueReferenceKeys)}
      </div>
      <div class="reference-health-grid">
        <span><b>${escapeHtml(referenceCoverage)}</b><small>reference coverage for this run</small></span>
        <span><b>${coveredReferences.toLocaleString()} / ${totalCandidates.toLocaleString()}</b><small>with extracted refs / candidate PDFs</small></span>
        <span><b>${withoutExtractedReferences.toLocaleString()}</b><small>without extracted refs</small></span>
        <span><b>${escapeHtml(optionalMetricLabel(remoteAttempted))}</b><small>remote PDF attempts</small></span>
        <span><b>${extractionErrors.toLocaleString()}</b><small>extraction errors</small></span>
      </div>
      <p class="reference-health-note">${blockedRemote || extractionErrors ? "Blocked or failed PDFs are excluded from citation overlap; semantic map/search still uses title and abstract text." : remoteHealthUnknown ? "Remote PDF attempt counts are unavailable for this artifact; extraction errors are shown when reported." : "No blocking extraction errors in the current reference artifact."}</p>
      <div class="reference-coverage-explain">
        <span><b>What counts</b>Only records with extracted references can contribute citation-overlap edges.</span>
        <span><b>What does not count</b>Semantic map/search still works for records without extracted references.</span>
        <span><b>Coverage gap</b>${withoutExtractedReferences.toLocaleString()} candidate PDFs currently have no extracted bibliography.</span>
      </div>
      <div class="reference-analysis-grid">
        <article class="reference-panel-block">
          <h3>Most cited reference titles</h3>
          <div class="reference-sample-list reference-top-list">
            ${topReferences.map((item) => `<span>${escapeHtml(item.displayText)}<b>${Number(item.count || 0).toLocaleString()}</b></span>`).join("") || "<small>No clean citation titles available yet.</small>"}
          </div>
        </article>
        <article class="reference-panel-block">
          <h3>Reference concentration</h3>
          <div class="reference-chip-list">${referenceCountChips(manifest.analysis?.referenceCounts?.byArea || [])}</div>
          <div class="reference-chip-list">${referenceCountChips(manifest.analysis?.referenceCounts?.byDomain || [])}</div>
        </article>
      </div>
      <article class="reference-panel-block">
        <h3>Records with citation overlap</h3>
        <p class="reference-sort-note">Sorted by overlap count first, then extracted reference count.</p>
        <div class="reference-record-list">
          ${records.map((item, index) => `
            <button class="reference-record-item" type="button" data-id="${escapeHtml(item.id)}">
              <span class="neighbor-rank">${index + 1}</span>
              <span>
                <strong>${escapeHtml(plainMathTitle(item.record.title))}</strong>
                <small>${Number(item.referenceCount || 0).toLocaleString()} refs · ${Number(item.overlapCount || 0).toLocaleString()} overlapping records</small>
              </span>
            </button>
          `).join("") || "<small>No overlap records yet. More matched references will improve this view.</small>"}
        </div>
        <div class="reference-selected" id="referenceSelected"></div>
      </article>
    </section>
  `;
  els.referencesView.querySelectorAll(".reference-record-item").forEach((button) => {
    button.addEventListener("click", () => {
      void renderReferenceSelection(button.dataset.id);
    });
  });
  if (records[0]) void renderReferenceSelection(records[0].id);
}

async function renderReferenceSelection(recordId) {
  const target = els.referencesView.querySelector("#referenceSelected");
  if (!target) return;
  const record = findDisplayRecord(recordId);
  target.innerHTML = `<div class="empty-state compact"><strong>Loading overlap</strong><span>Reading one record shard.</span></div>`;
  const payload = await loadReferenceRecord(recordId);
  if (state.tab !== "references" || !target.isConnected) return;
  const references = referenceCitationItems(payload?.references || [], 5);
  const overlaps = (payload?.overlaps || []).slice(0, 10);
  target.innerHTML = `
    <div class="reference-selected-head">
      <strong>${escapeHtml(plainMathTitle(record?.title || payload?.title || recordId))}</strong>
      <span>${Number(payload?.referenceCount || 0).toLocaleString()} extracted refs</span>
    </div>
    ${renderReferenceGraph(payload || {}, record)}
    <p class="reference-selected-note">Overlap means shared normalized references for this selected record; it is citation evidence, separate from semantic-map similarity.</p>
    <div class="reference-sample-list reference-selected-samples">
      ${references.map((item) => `<span>${escapeHtml(item.displayText)}${referenceBadge(item.year || item.source || "")}</span>`).join("") || "<small>No clean citation sample in this shard yet.</small>"}
    </div>
    <div class="reference-overlap-list">
      ${overlaps.map((item, index) => {
        const overlapRecord = findDisplayRecord(item.recordId);
        return `
          <button class="reference-overlap-item" type="button" data-id="${escapeHtml(item.recordId)}">
            <span class="neighbor-rank">${index + 1}</span>
            <span>
              <strong>${escapeHtml(plainMathTitle(overlapRecord?.title || item.title || item.recordId))}</strong>
              <small>${escapeHtml(overlapStrength(item.sharedCount, item.score))} link · ${Number(item.sharedCount || 0).toLocaleString()} shared references · ${Number(item.score || 0).toFixed(2)} overlap${(item.references || []).length ? ` · ${escapeHtml((item.references || []).slice(0, 2).map(referenceDisplayText).filter(Boolean).join(" / "))}` : ""}</small>
            </span>
          </button>
        `;
      }).join("") || "<small>No strong overlap yet for this record.</small>"}
    </div>
  `;
  target.querySelectorAll(".reference-overlap-item").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedRecord = findDisplayRecord(button.dataset.id);
      state.tab = selectedRecord?.type === "workshop" ? "workshop" : "paper";
      state.selectedId = button.dataset.id;
      state.viewerMapRequested = true;
      state.viewerReferenceRequested = true;
      renderAll();
    });
  });
  target.querySelectorAll(".reference-overlap-graph a").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void renderReferenceSelection(link.dataset.id);
    });
  });
}

function renderAll() {
  els.tabs.forEach((button) => {
    const count = button.dataset.tab === "references"
      ? 1
      : button.dataset.tab === "map"
      ? displayRecords().filter((record) => record.mapAvailable && (!state.mapData?.records?.length || mapRecordById().has(record.id))).length
      : displayRecords().filter((record) => record.type === button.dataset.tab).length;
    button.hidden = count === 0;
    button.classList.toggle("is-active", button.dataset.tab === state.tab);
  });
  updateSelects();
  resetResultWindow();
  const isMap = state.tab === "map";
  const isReferences = state.tab === "references";
  document.body.classList.toggle("is-map-tab", isMap);
  document.body.classList.toggle("is-references-tab", isReferences);
  els.results.hidden = isMap || isReferences;
  els.mapView.hidden = !isMap;
  els.referencesView.hidden = !isReferences;
  const selected = isMap || isReferences ? null : ensureVisibleSelection();
  if (!isMap && state.mapGraph) {
    state.mapGraph.pauseAnimation?.();
  } else if (isMap && state.mapGraph && state.mapLive) {
    state.mapGraph.resumeAnimation?.();
  }
  renderResults();
  renderMap();
  void renderReferences();
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

function openTrendRepresentative(recordId) {
  const record = findDisplayRecord(recordId);
  if (!record) return;
  state.tab = record.type === "workshop" ? "workshop" : "paper";
  state.selectedId = record.id;
  state.viewerMapRequested = true;
  state.viewerReferenceRequested = true;
  state.query = "";
  els.search.value = "";
  if (els.mapSearch) els.mapSearch.value = "";
  state.category = "all";
  state.group = "all";
  state.asset = "all";
  els.asset.value = "all";
  clearMapSelection();
  renderAll();
}

function loadSearchEmbeddingsInBackground() {
  if (searchEmbeddingsStarted) return;
  searchEmbeddingsStarted = true;
  void loadSearchEmbeddings(SEARCH_EMBEDDINGS_URL)
    .finally(rerenderActiveMapQuery);
}

function ensureStudyFeatures() {
  if (state.studyFeaturesLoaded) return Promise.resolve(state.studyFeatures);
  if (!studyFeaturesPromise) {
    studyFeaturesPromise = loadStudyFeatures().catch(() => null);
  }
  return studyFeaturesPromise;
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
  scheduleMapDataPreload();
  scheduleFullRecordsHydration();
  els.mapDetail.addEventListener("click", (event) => {
    const button = event.target.closest(".trend-card-main[data-record-id], .trend-representatives [data-record-id]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openTrendRepresentative(button.dataset.recordId);
  }, true);
  els.mapView.addEventListener("click", (event) => {
    const button = event.target.closest(".topic-lens-records [data-record-id]");
    if (!button) return;
    openTrendRepresentative(button.dataset.recordId);
  });
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
      if (nextTab === "references") {
        state.selectedId = "";
      }
      clearMapSelection();
      els.asset.value = "all";
      resetResultWindow();
      renderAll();
      window.scrollTo(0, 0);
    });
    if (button.dataset.tab === "map") {
      button.addEventListener("pointerenter", scheduleMapDataPreload);
      button.addEventListener("focus", scheduleMapDataPreload);
    }
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
