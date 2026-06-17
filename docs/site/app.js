const DATA_URL = "site/data/icml2026_index.json";
const MAP_URL = "site/data/icml2026_map.json";
const PAGE_SIZE = 80;
const REPO_RAW_BASE = "https://raw.githubusercontent.com/KimYeongHyeon/icml-2026-materials-browser/main/";
const LOCAL_ASSET_PREFIX = window.location.pathname.includes("/docs/") ? "../" : "";
const MATHJAX_RETRY_LIMIT = 40;
const PDFJS_VIEWER_BASE = "https://mozilla.github.io/pdf.js/web/viewer.html";

const state = {
  tab: "poster",
  query: "",
  category: "all",
  group: "all",
  asset: "all",
  selectedId: "",
  visibleCount: PAGE_SIZE,
  data: null,
  mapData: null,
  mapColor: "area",
  mapMode: "global",
  mapFilterValue: "",
  mapGraph: null,
  mapHoverId: "",
};

const els = {
  headerStats: document.querySelector("#headerStats"),
  tabs: [...document.querySelectorAll(".tab")],
  search: document.querySelector("#searchInput"),
  category: document.querySelector("#categorySelect"),
  group: document.querySelector("#groupSelect"),
  asset: document.querySelector("#assetSelect"),
  resultCount: document.querySelector("#resultCount"),
  activeSummary: document.querySelector("#activeSummary"),
  results: document.querySelector("#results"),
  mapView: document.querySelector("#mapView"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapDetail: document.querySelector("#mapDetail"),
  mapColor: document.querySelector("#mapColorSelect"),
  mapMode: document.querySelector("#mapModeSelect"),
  mapLegend: document.querySelector("#mapLegend"),
  viewerKind: document.querySelector("#viewerKind"),
  viewerTitle: document.querySelector("#viewerTitle"),
  viewerActions: document.querySelector("#viewerActions"),
  viewerMeta: document.querySelector("#viewerMeta"),
  viewerFrame: document.querySelector("#viewerFrame"),
};

const AREA_COLORS = {
  "LLMs": "#60a5fa",
  "Vision": "#22d3ee",
  "Theory": "#a78bfa",
  "Optimization": "#f59e0b",
  "Reinforcement Learning": "#34d399",
  "Generative Models": "#f472b6",
  "Multimodal Learning": "#38bdf8",
  "Probabilistic Methods": "#c084fc",
  "Systems": "#f97316",
  "Safety": "#ef4444",
  "Agents": "#2dd4bf",
  "Evaluation": "#c084fc",
  "Other": "#94a3b8",
};

const DOMAIN_COLORS = {
  "General": "#94a3b8",
  "Biology": "#84cc16",
  "Medical": "#fb7185",
  "Climate": "#38bdf8",
  "Robotics": "#34d399",
  "Education": "#facc15",
  "Finance": "#f97316",
  "Chemistry": "#a78bfa",
  "Materials": "#c084fc",
  "Scientific Discovery": "#f472b6",
  "Social Science": "#2dd4bf",
};

const QUALITY_COLORS = {
  "title_abstract": "#22c55e",
  "title_topic": "#60a5fa",
  "title_only": "#f59e0b",
  "unavailable": "#64748b",
};

const AVAILABILITY_COLORS = {
  "Downloaded": "#22c55e",
  "Metadata only": "#60a5fa",
  "Local file": "#22c55e",
  "Source link": "#60a5fa",
  "Blocked": "#ef4444",
  "Unavailable": "#f59e0b",
};

function normalize(value) {
  return String(value || "").toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function queueMathTypeset(root = document.body, attempt = 0) {
  if (!root) return;
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([root]).catch(() => {});
    return;
  }
  if (attempt < MATHJAX_RETRY_LIMIT) {
    window.setTimeout(() => queueMathTypeset(root, attempt + 1), 150);
  }
}

function plainMathTitle(value) {
  const greek = {
    alpha: "α",
    beta: "β",
    gamma: "γ",
    delta: "δ",
    epsilon: "ε",
    lambda: "λ",
    mu: "μ",
    pi: "π",
    sigma: "σ",
    theta: "θ",
  };
  let title = String(value || "");
  title = title.replaceAll("\\mathbb{R}", "ℝ");
  title = title.replaceAll("\\mathcal{O}", "O");
  title = title.replace(/\\([a-zA-Z]+)/g, (_, command) => greek[command] || command);
  title = title.replace(/\$([^$]+)\$/g, "$1");
  title = title.replace(/\s+/g, " ").trim();
  return title;
}

function typeLabel(type) {
  return {
    paper: "Paper",
    poster: "Poster",
    workshop: "Workshop",
    map: "Map",
  }[type] || type;
}

function categoryTags(record) {
  return Array.isArray(record.categoryTags) && record.categoryTags.length ? record.categoryTags : [record.category || "Other"];
}

function viewerKindLabel(record) {
  if (record.type === "paper" && /\/poster\//.test(record.pageUrl || "")) {
    return `Poster · ${record.category}`;
  }
  return `${typeLabel(record.type)} · ${record.category}`;
}

function assetLabel(record) {
  if (record.hasPdf) return "PDF";
  if (record.hasSlide) return "Slides";
  if (record.hasPoster) return "Poster";
  return "Metadata";
}

function statusClass(record) {
  if (record.availabilityStatus === "downloaded") return "good";
  if (record.availabilityStatus === "blocked") return "bad";
  if (record.availabilityStatus === "unavailable") return "warn";
  return "";
}

function getFilteredRecords(options = {}) {
  const query = normalize(state.query);
  const ignoreMapFilter = Boolean(options.ignoreMapFilter);
  return state.data.records.filter((record) => {
    if (state.tab !== "map" && record.type !== state.tab) return false;
    if (state.category !== "all" && !categoryTags(record).includes(state.category)) return false;
    if (state.group !== "all" && record.group !== state.group) return false;
    if (state.asset === "local" && !(record.hasPdf || record.hasPoster || record.hasSlide)) return false;
    if (state.asset === "pdf" && !record.hasPdf) return false;
    if (state.asset === "poster" && !record.hasPoster) return false;
    if (state.asset === "slide" && !record.hasSlide) return false;
    if (state.asset === "blocked" && record.availabilityStatus !== "blocked") return false;
    if (state.asset === "metadata" && record.availabilityStatus !== "metadata") return false;
    if (state.asset === "unavailable" && record.availabilityStatus !== "unavailable") return false;
    if (!ignoreMapFilter && state.tab === "map" && state.mapFilterValue && mapColorValue(record) !== state.mapFilterValue) return false;
    if (!query) return true;
    const haystack = normalize(`${record.title} ${plainMathTitle(record.title)} ${record.authors} ${record.group} ${categoryTags(record).join(" ")} ${(record.areaTags || []).join(" ")} ${(record.domainTags || []).join(" ")} ${record.clusterLabel || ""}`);
    return haystack.includes(query);
  });
}

function updateHeader() {
  const summary = state.data.summary;
  const counts = summary.typeCounts;
  els.headerStats.innerHTML = [
    ["Papers", counts.paper || 0],
    ["Posters", counts.poster || 0],
    ["Workshops", counts.workshop || 0],
    ["PDFs", summary.assetCounts.pdf || 0],
    ["Poster images", summary.assetCounts.poster || 0],
    ["Slides", summary.assetCounts.slide || 0],
    ["Blocked", summary.availabilityCounts?.blocked || 0],
  ].filter(([label, value]) => label !== "Papers" || value > 0)
    .map(([label, value]) => `<span class="stat-pill"><strong>${value.toLocaleString()}</strong> ${label}</span>`)
    .join("");
}

function option(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function updateSelects() {
  const recordsForTab = state.tab === "map" ? state.data.records : state.data.records.filter((record) => record.type === state.tab);
  const categories = [...new Set(recordsForTab.flatMap((record) => categoryTags(record)))].sort();
  const groups = [...new Set(recordsForTab.map((record) => record.group))].sort();

  els.category.innerHTML = option("all", "All fields") + categories.map((name) => option(name, name)).join("");
  els.group.innerHTML = option("all", "All groups") + groups.map((name) => option(name, name)).join("");
  els.category.value = categories.includes(state.category) ? state.category : "all";
  els.group.value = groups.includes(state.group) ? state.group : "all";
  state.category = els.category.value;
  state.group = els.group.value;
}

function renderResults() {
  const filtered = getFilteredRecords();
  els.resultCount.textContent = `${filtered.length.toLocaleString()} results`;
  els.activeSummary.textContent = `${typeLabel(state.tab)} · ${state.category === "all" ? "all fields" : state.category}`;

  const visible = filtered.slice(0, state.visibleCount);
  els.results.innerHTML = visible
    .map((record) => {
      const selected = record.id === state.selectedId ? " is-selected" : "";
      return `
        <button class="result-item${selected}" type="button" data-id="${escapeHtml(record.id)}">
          <span class="result-title">${escapeHtml(plainMathTitle(record.title))}</span>
          <span class="result-authors">${escapeHtml(record.authors || "Authors unavailable")}</span>
          <span class="badges">
            ${categoryTags(record).slice(0, 3).map((category) => `<span class="badge">${escapeHtml(category)}</span>`).join("")}
            <span class="badge">${escapeHtml(record.group)}</span>
            <span class="badge">${assetLabel(record)}</span>
            <span class="badge ${statusClass(record)}">${escapeHtml(record.availabilityLabel || "Metadata only")}</span>
          </span>
          <span class="result-details">${escapeHtml(record.status || record.availabilityLabel || "available")} ${record.failureReason ? "· " + escapeHtml(record.failureReason) : ""}</span>
        </button>
      `;
    })
    .join("");

  if (filtered.length === 0) {
    const message = "Adjust the filters or search terms.";
    els.results.innerHTML = `<div class="empty-state"><strong>No records</strong><span>${escapeHtml(message)}</span></div>`;
  }

  els.results.querySelectorAll(".result-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      const selected = state.data.records.find((record) => record.id === state.selectedId);
      renderResults();
      renderViewer(selected);
    });
  });

  queueMathTypeset(els.results);
}

function mapRecordById() {
  const records = state.mapData?.records || [];
  return new Map(records.map((record) => [record.id, record]));
}

function mapColorValue(record) {
  if (state.mapColor === "domain") return (record.domainTags || ["General"])[0] || "General";
  if (state.mapColor === "cluster") return record.clusterLabel || "Cluster";
  if (state.mapColor === "quality") return record.embeddingTextQuality || "unavailable";
  if (state.mapColor === "availability") return record.availabilityLabel || "Metadata";
  return (record.areaTags || record.categoryTags || ["Other"])[0] || "Other";
}

function colorForValue(value) {
  const palette = {
    area: AREA_COLORS,
    domain: DOMAIN_COLORS,
    quality: QUALITY_COLORS,
    availability: AVAILABILITY_COLORS,
  }[state.mapColor];
  if (palette?.[value]) return palette[value];
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 72% 58%)`;
}

function scaleMapValue(value, min, max) {
  return max === min ? 50 : 5 + ((value - min) / (max - min)) * 90;
}

function selectedNeighborIds(mapById) {
  const selected = mapById.get(state.selectedId);
  if (!selected) return new Set();
  return new Set((selected.nearestNeighbors || []).slice(0, 12).map((item) => item.id));
}

function graphNodeIds(visibleRecords, mapById) {
  const visibleIds = new Set(visibleRecords.map((record) => record.id));
  if (state.mapMode !== "focused") return visibleIds;
  if (!visibleIds.has(state.selectedId)) {
    state.selectedId = visibleRecords[0]?.id || "";
  }
  const ids = new Set([state.selectedId]);
  for (const id of selectedNeighborIds(mapById)) {
    if (visibleIds.has(id)) ids.add(id);
  }
  return ids;
}

function buildGraphData(visibleRecords, mapById) {
  const ids = graphNodeIds(visibleRecords, mapById);
  const recordsById = new Map(visibleRecords.map((record) => [record.id, record]));
  const selectedNeighbors = selectedNeighborIds(mapById);
  const nodes = [...ids].map((id) => {
    const record = recordsById.get(id);
    return {
      id,
      record,
      title: plainMathTitle(record?.title || ""),
      group: mapColorValue(record || {}),
      selected: id === state.selectedId,
      adjacent: selectedNeighbors.has(id),
      type: record?.type || "record",
    };
  }).filter((node) => node.record);
  const links = [];
  const seen = new Set();
  const neighborLimit = state.mapMode === "focused" ? 12 : 3;
  for (const node of nodes) {
    const map = mapById.get(node.id);
    for (const neighbor of (map?.nearestNeighbors || []).slice(0, neighborLimit)) {
      if (!ids.has(neighbor.id)) continue;
      const key = [node.id, neighbor.id].sort().join("::");
      if (seen.has(key) || node.id === neighbor.id) continue;
      seen.add(key);
      links.push({
        source: node.id,
        target: neighbor.id,
        value: Number(neighbor.score || 0),
        selected: node.id === state.selectedId || neighbor.id === state.selectedId,
      });
    }
  }
  return { nodes, links };
}

function renderMapLegend(visibleRecords) {
  if (!els.mapLegend) return;
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
    <button class="legend-item legend-all${state.mapFilterValue ? "" : " is-active"}" type="button" data-value="" title="Show all color groups">
      <span class="legend-swatch legend-swatch-all"></span>
      <span>All</span>
      <strong>${allCount.toLocaleString()}</strong>
    </button>
  ` + items.map(([value, count]) => `
    <button class="legend-item${state.mapFilterValue === value ? " is-active" : ""}" type="button" data-value="${escapeHtml(value)}" title="${escapeHtml(value)}">
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
      resetResultWindow();
      renderMap();
      renderViewer(null);
    });
  });
}

function ensureForceGraph() {
  if (state.mapGraph || typeof window.ForceGraph !== "function") return state.mapGraph;
  els.mapCanvas.innerHTML = "";
  state.mapGraph = window.ForceGraph()(els.mapCanvas)
    .backgroundColor("#111827")
    .nodeId("id")
    .nodeLabel((node) => node.title)
    .nodeVal((node) => node.selected ? 9 : node.adjacent ? 4 : node.type === "workshop" ? 2.4 : 1.8)
    .linkCurvature(0.06)
    .linkWidth((link) => link.selected ? 1.7 : Math.max(0.25, Number(link.value || 0) * 1.8))
    .linkColor((link) => link.selected ? "rgba(147,197,253,0.72)" : "rgba(148,163,184,0.08)")
    .linkDirectionalParticles((link) => link.selected ? 2 : 0)
    .linkDirectionalParticleWidth(1.4)
    .linkDirectionalParticleSpeed(0.004)
    .d3AlphaDecay(0.028)
    .d3VelocityDecay(0.34)
    .cooldownTicks(140)
    .onNodeHover((node) => {
      state.mapHoverId = node?.id || "";
      els.mapCanvas.style.cursor = node ? "pointer" : "grab";
      state.mapGraph.refresh();
    })
    .onNodeClick((node) => {
      if (!node?.record) return;
      state.selectedId = node.id;
      renderMap();
      renderMapDetail(node.record);
      renderViewer(node.record);
    })
    .nodeCanvasObject((node, ctx, globalScale) => {
      const color = colorForValue(node.group);
      const isSelected = node.id === state.selectedId;
      const isHover = node.id === state.mapHoverId;
      const isAdjacent = node.adjacent;
      const radius = isSelected ? 8.5 : isHover ? 7 : isAdjacent ? 5.4 : 4.2;
      if (isSelected || isHover) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.12)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? "#60a5fa" : color;
      ctx.globalAlpha = isSelected || isAdjacent || isHover || state.mapMode === "focused" ? 0.96 : 0.82;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isSelected ? 1.8 : 0.8;
      ctx.strokeStyle = isSelected ? "#dbeafe" : "rgba(255,255,255,0.55)";
      ctx.stroke();
      const shouldLabel = isSelected || isHover || (state.mapMode === "focused" && isAdjacent) || globalScale > 1.65;
      if (!shouldLabel) return;
      const label = node.title.length > 68 ? `${node.title.slice(0, 65)}...` : node.title;
      const fontSize = Math.max(10, 13 / globalScale);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const textX = node.x + radius + 5;
      const textY = node.y;
      const metrics = ctx.measureText(label);
      ctx.fillStyle = "rgba(17,24,39,0.78)";
      ctx.fillRect(textX - 3, textY - fontSize * 0.7, metrics.width + 6, fontSize * 1.35);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(label, textX, textY);
    });
  return state.mapGraph;
}

function renderMapDetail(record) {
  if (!record) {
    els.mapDetail.innerHTML = `<div class="empty-state compact"><strong>Select a point</strong><span>Click a mapped record to inspect it.</span></div>`;
    return;
  }
  const mapById = mapRecordById();
  const map = mapById.get(record.id);
  const neighbors = (map?.nearestNeighbors || []).slice(0, 8)
    .map((neighbor) => ({ score: neighbor.score, record: state.data.records.find((item) => item.id === neighbor.id) }))
    .filter((item) => item.record);
  els.mapDetail.innerHTML = `
    <div class="map-detail-card">
      <p class="eyebrow">${escapeHtml(typeLabel(record.type))} · ${escapeHtml(record.clusterLabel || "Mapped record")}</p>
      <h3>${escapeHtml(plainMathTitle(record.title))}</h3>
      <div class="badges">
        ${(record.areaTags || []).slice(0, 3).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        ${(record.domainTags || []).slice(0, 2).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        <span class="badge">${escapeHtml(record.embeddingTextQuality || "unavailable")}</span>
      </div>
      <button class="action primary map-open-record" type="button">Open in viewer</button>
      <div class="neighbor-list">
        ${neighbors.map((item) => `<button type="button" class="neighbor-item" data-id="${escapeHtml(item.record.id)}"><strong>${escapeHtml(plainMathTitle(item.record.title))}</strong><span>${Number(item.score || 0).toFixed(2)} similarity</span></button>`).join("")}
      </div>
    </div>
  `;
  els.mapDetail.querySelector(".map-open-record")?.addEventListener("click", () => {
    state.tab = record.type;
    state.category = "all";
    state.group = "all";
    state.asset = "all";
    els.asset.value = "all";
    renderAll();
    state.selectedId = record.id;
    renderResults();
    renderViewer(record);
  });
  els.mapDetail.querySelectorAll(".neighbor-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      const selected = state.data.records.find((item) => item.id === state.selectedId);
      renderMap();
      renderMapDetail(selected);
      renderViewer(selected);
    });
  });
}

function renderMap() {
  if (state.tab !== "map") return;
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
  const colorFilter = state.mapFilterValue ? ` · ${state.mapFilterValue}` : "";
  els.activeSummary.textContent = `Map · ${state.category === "all" ? "all fields" : state.category} · ${state.mapMode}${colorFilter}`;
  if (!visibleRecords.length) {
    state.mapGraph = null;
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No mapped records</strong><span>Adjust the filters.</span></div>`;
    renderMapDetail(null);
    return;
  }
  const graph = ensureForceGraph();
  if (!graph) {
    state.mapGraph = null;
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>Graph library unavailable</strong><span>force-graph could not be loaded.</span></div>`;
    renderMapDetail(visibleRecords[0]);
    return;
  }
  const graphData = buildGraphData(visibleRecords, mapById);
  graph
    .width(els.mapCanvas.clientWidth || 840)
    .height(els.mapCanvas.clientHeight || 640)
    .graphData(graphData);
  if (state.mapMode === "focused") {
    graph.d3Force("charge")?.strength(-240);
    graph.d3Force("link")?.distance((link) => link.selected ? 42 : 70);
    graph.zoomToFit(320, 80);
  } else {
    graph.d3Force("charge")?.strength(-34);
    graph.d3Force("link")?.distance(28);
  }
  const selected = state.data.records.find((record) => record.id === state.selectedId && record.mapAvailable);
  renderMapDetail(selected || visibleRecords[0]);
}

function resetResultWindow() {
  state.visibleCount = PAGE_SIZE;
}

function loadMoreResultsIfNeeded() {
  const remaining = getFilteredRecords().length - state.visibleCount;
  if (remaining <= 0) return;
  state.visibleCount += PAGE_SIZE;
  renderResults();
}

function actionLink(href, label, primary = false) {
  if (!href) return "";
  return `<a class="action ${primary ? "primary" : ""}" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function assetActionHref(record, path) {
  if (!path) return "";
  if (record.bestAssetKind === "pdf" || record.bestAssetKind === "slide") {
    return pdfViewerUrl(path);
  }
  return assetUrl(path);
}

function assetActionLabel(record) {
  if (record.bestAssetKind === "pdf") return "Preview PDF";
  if (record.bestAssetKind === "slide") return "Preview slides";
  if (record.bestAssetKind === "poster") return "Open poster";
  return "Open asset";
}

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (window.location.hostname.endsWith("github.io")) return `${REPO_RAW_BASE}${path}`;
  return new URL(`${LOCAL_ASSET_PREFIX}${path}`, window.location.href).href;
}

function pdfViewerUrl(path) {
  return `${PDFJS_VIEWER_BASE}?file=${encodeURIComponent(assetUrl(path))}`;
}

function fallbackPageUrl(record) {
  return record.pageUrl || record.openreviewUrl || record.projectPageUrl || record.pdfUrl || "";
}

function fallbackPageLabel(record) {
  if (record.type === "paper" && /\/poster\//.test(record.pageUrl || "")) return "Poster source page";
  if (record.availabilityStatus === "blocked") return `${typeLabel(record.type)} source page`;
  if (record.status === "downloaded") return "Downloaded source page";
  if (record.availabilityStatus === "metadata") return "Metadata source page";
  return "Source page";
}

function sourcePageEmbeddable(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return ![
      "icml.cc",
      "openreview.net",
      "docs.google.com",
      "drive.google.com",
      "sites.google.com",
    ].some((blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`));
  } catch {
    return false;
  }
}

function renderSourcePageFallback(record, sourceUrl, message) {
  const canEmbed = sourcePageEmbeddable(sourceUrl);
  const frame = canEmbed
    ? `<iframe src="${escapeHtml(sourceUrl)}" title="${escapeHtml(record.title)} source page"></iframe>`
    : `
      <div class="source-page-open">
        <strong>Preview unavailable</strong>
        <span>This source blocks embedding in GitHub Pages.</span>
        <a class="action primary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Open source page</a>
      </div>
    `;

  return `
    <div class="source-page-shell">
      <div class="source-page-note">
        <strong>${escapeHtml(fallbackPageLabel(record))}</strong>
        <span>${escapeHtml(message)}</span>
      </div>
      ${frame}
    </div>
  `;
}

function renderAssetOpenFallback(record, assetPath) {
  const url = assetUrl(assetPath);
  const canPreview = record.bestAssetKind === "pdf" || record.bestAssetKind === "slide";
  const preview = canPreview
    ? `<iframe src="${escapeHtml(pdfViewerUrl(assetPath))}" title="${escapeHtml(record.title)} PDF preview"></iframe>`
    : `
      <div class="source-page-open">
        <strong>Open when needed</strong>
        <span>Select the asset explicitly to view or download it.</span>
        <a class="action primary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open asset</a>
      </div>
    `;
  return `
    <div class="source-page-shell asset-preview-shell">
      ${preview}
    </div>
  `;
}

function renderMiniMap(record) {
  if (!record?.mapAvailable || !state.mapData?.records?.length) return "";
  const mapById = mapRecordById();
  const center = mapById.get(record.id);
  if (!center) return "";
  const neighbors = (center.nearestNeighbors || []).slice(0, 6)
    .map((neighbor, index) => ({
      record: state.data.records.find((item) => item.id === neighbor.id),
      score: neighbor.score,
      angle: (Math.PI * 2 * index) / Math.max(1, Math.min(6, center.nearestNeighbors.length)),
    }))
    .filter((item) => item.record);
  const nodeButtons = neighbors.map((item, index) => {
    const radius = index % 2 === 0 ? 34 : 42;
    const left = 50 + Math.cos(item.angle) * radius;
    const top = 50 + Math.sin(item.angle) * radius;
    return `<button class="mini-graph-node" type="button" data-id="${escapeHtml(item.record.id)}" style="left:${left}%;top:${top}%;" title="${escapeHtml(plainMathTitle(item.record.title))}"></button>`;
  }).join("");
  const edges = neighbors.map((item, index) => {
    const radius = index % 2 === 0 ? 34 : 42;
    const x = 50 + Math.cos(item.angle) * radius;
    const y = 50 + Math.sin(item.angle) * radius;
    return `<line x1="50" y1="50" x2="${x}" y2="${y}" />`;
  }).join("");
  return `
    <section class="mini-map-panel">
      <h3>Related papers</h3>
      <div class="mini-graph" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">${edges}</svg>
        <span class="mini-graph-node is-center" style="left:50%;top:50%;"></span>
        ${nodeButtons}
      </div>
      <div class="neighbor-list">
        ${neighbors.map((item) => `<button type="button" class="neighbor-item" data-id="${escapeHtml(item.record.id)}"><strong>${escapeHtml(plainMathTitle(item.record.title))}</strong><span>${Number(item.score || 0).toFixed(2)} similarity</span></button>`).join("")}
      </div>
    </section>
  `;
}

function renderViewer(record) {
  if (!record) {
    els.viewerKind.textContent = "No selection";
    els.viewerTitle.textContent = "Select a record";
    els.viewerActions.innerHTML = "";
    els.viewerMeta.innerHTML = "";
    els.viewerFrame.innerHTML = `<div class="empty-state"><strong>No matching record</strong><span>Adjust the filters.</span></div>`;
    queueMathTypeset(els.viewerFrame);
    return;
  }

  els.viewerKind.textContent = viewerKindLabel(record);
  els.viewerTitle.textContent = plainMathTitle(record.title);
  els.viewerMeta.innerHTML = [
    record.group,
    record.authors,
    record.availabilityLabel,
    record.status,
    record.failureReason,
  ]
    .filter(Boolean)
    .map((value) => `<span class="chip">${escapeHtml(value)}</span>`)
    .join("");

  const preferred = record.bestAsset;
  const localAsset = record.localPdfPath || record.localSlidePath || record.localPosterPath;
  const actions = [
    actionLink(assetActionHref(record, localAsset), assetActionLabel(record), true),
    actionLink(record.pageUrl, "Official page"),
    actionLink(record.openreviewUrl, "OpenReview"),
    actionLink(record.projectPageUrl, "Project"),
    actionLink(record.pdfUrl && !record.localPdfPath ? record.pdfUrl : "", "Open PDF"),
  ].join("");
  els.viewerActions.innerHTML = actions;

  if (preferred && record.bestAssetKind === "poster") {
    els.viewerFrame.innerHTML = `<img src="${escapeHtml(assetUrl(preferred))}" alt="${escapeHtml(record.title)} poster" />`;
  } else if (preferred && (record.bestAssetKind === "pdf" || record.bestAssetKind === "slide")) {
    els.viewerFrame.innerHTML = renderAssetOpenFallback(record, preferred);
  } else if (fallbackPageUrl(record)) {
    const sourceUrl = fallbackPageUrl(record);
    const message = record.failureReason || "No local PDF, poster image, or slide deck was collected, so the source page is used instead.";
    els.viewerFrame.innerHTML = renderSourcePageFallback(record, sourceUrl, message);
  } else {
    let title = assetLabel(record);
    let message = "No public local media file was collected for this record.";
    if (record.availabilityStatus === "blocked") {
      title = "Blocked";
      message = record.failureReason || "The source was checked, but the material is not publicly downloadable yet or blocked the download.";
    } else if (record.availabilityStatus === "metadata") {
      title = "Metadata only";
      message = record.type === "paper"
        ? "The main-conference paper PDFs are not public in the collected official sources yet."
        : "The source exposed metadata, but no downloadable media file.";
    } else if (record.availabilityStatus === "unavailable") {
      title = "Unavailable / skipped";
      message = record.failureReason || "The linked source was not a direct downloadable material.";
    }
    els.viewerFrame.innerHTML = `<div class="empty-state status-${escapeHtml(record.availabilityStatus || "metadata")}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
  }
  const miniMap = renderMiniMap(record);
  if (miniMap) {
    els.viewerFrame.insertAdjacentHTML("beforeend", miniMap);
    els.viewerFrame.querySelectorAll(".mini-graph-node[data-id], .neighbor-item").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = state.data.records.find((item) => item.id === button.dataset.id);
        state.selectedId = button.dataset.id;
        renderResults();
        renderMap();
        renderViewer(selected);
      });
    });
  }
  queueMathTypeset(document.body);
}

function renderAll() {
  els.tabs.forEach((button) => {
    const count = button.dataset.tab === "map" ? state.mapData?.records?.length || 0 : state.data?.summary?.typeCounts?.[button.dataset.tab] || 0;
    button.hidden = count === 0;
    button.classList.toggle("is-active", button.dataset.tab === state.tab);
  });
  updateSelects();
  state.selectedId = "";
  resetResultWindow();
  const isMap = state.tab === "map";
  document.body.classList.toggle("is-map-tab", isMap);
  els.results.hidden = isMap;
  els.mapView.hidden = !isMap;
  renderResults();
  renderMap();
  renderViewer(null);
}

async function init() {
  els.results.innerHTML = `<div class="empty-state"><strong>Loading index</strong><span>Reading the local ICML 2026 manifest.</span></div>`;
  const response = await fetch(DATA_URL);
  state.data = await response.json();
  try {
    const mapResponse = await fetch(MAP_URL);
    state.mapData = mapResponse.ok ? await mapResponse.json() : null;
  } catch {
    state.mapData = null;
  }
  updateHeader();
  renderAll();

  els.tabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.category = "all";
      state.group = "all";
      state.asset = "all";
      state.mapFilterValue = "";
      els.asset.value = "all";
      resetResultWindow();
      renderAll();
    });
  });

  els.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.category.addEventListener("change", (event) => {
    state.category = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.group.addEventListener("change", (event) => {
    state.group = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.asset.addEventListener("change", (event) => {
    state.asset = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.mapColor.addEventListener("change", (event) => {
    state.mapColor = event.target.value;
    state.mapFilterValue = "";
    renderMap();
  });
  els.mapMode.addEventListener("change", (event) => {
    state.mapMode = event.target.value;
    renderMap();
  });
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
    }
  });
}

init().catch((error) => {
  els.results.innerHTML = `<div class="empty-state"><strong>Could not load data</strong><span>${escapeHtml(error.message)}</span></div>`;
});
