const DATA_URL = "site/data/icml2026_index.json";
const MAP_URL = "site/data/icml2026_map.json";
const PAGE_SIZE = 80;
const REPO_CDN_BASE = "https://cdn.jsdelivr.net/gh/KimYeongHyeon/icml-2026-materials-browser@main/";
const LOCAL_ASSET_PREFIX = window.location.pathname.includes("/docs/") ? "../" : "";
const MATHJAX_RETRY_LIMIT = 40;

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
  mapEngine: "force",
  mapColor: "area",
  mapMode: "global",
  mapLive: true,
  mapFilterValue: "",
  mapGraph: null,
  mapGraphData: null,
  sigmaGraph: null,
  sigmaRenderer: null,
  cyGraph: null,
  mapHoverId: "",
  mapInteraction: {
    spaceDown: false,
    pointerId: null,
    mode: "",
    moved: false,
    suppressClickUntil: 0,
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0 },
    center: { x: 0, y: 0 },
  },
  mapSelection: {
    active: false,
    start: null,
    end: null,
    nodeIds: [],
  },
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
  mapEngine: document.querySelector("#mapEngineSelect"),
  mapColor: document.querySelector("#mapColorSelect"),
  mapMode: document.querySelector("#mapModeSelect"),
  mapLive: document.querySelector("#mapLiveButton"),
  mapReflow: document.querySelector("#mapReflowButton"),
  mapFit: document.querySelector("#mapFitButton"),
  mapZoomOut: document.querySelector("#mapZoomOutButton"),
  mapZoomIn: document.querySelector("#mapZoomInButton"),
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

const AREA_LAYOUT_ANCHORS = {
  "LLMs": { x: -340, y: -210 },
  "Agents": { x: -150, y: -300 },
  "Systems": { x: 90, y: -310 },
  "Vision": { x: 320, y: -210 },
  "Multimodal Learning": { x: 390, y: 20 },
  "Generative Models": { x: 230, y: 210 },
  "Optimization": { x: 0, y: 120 },
  "Theory": { x: -230, y: 210 },
  "Probabilistic Methods": { x: -410, y: 20 },
  "Reinforcement Learning": { x: -170, y: -20 },
  "Safety": { x: 170, y: -20 },
  "Evaluation": { x: 0, y: -90 },
  "Other": { x: 0, y: 0 },
};

const CLUSTER_AREA_HINTS = {
  "cluster-llms": "LLMs",
  "cluster-agents": "Agents",
  "cluster-systems": "Systems",
  "cluster-vision": "Vision",
  "cluster-multimodal": "Multimodal Learning",
  "cluster-generative": "Generative Models",
  "cluster-optimization": "Optimization",
  "cluster-theory": "Theory",
  "cluster-probabilistic": "Probabilistic Methods",
  "cluster-rl": "Reinforcement Learning",
  "cluster-safety": "Safety",
  "cluster-evaluation": "Evaluation",
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

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(id, salt = 0) {
  return ((stableHash(`${id}:${salt}`) % 10000) / 10000);
}

function clusterAnchor(record) {
  const primaryArea = (record?.areaTags || []).find((tag) => tag !== "Other");
  const clusterHint = CLUSTER_AREA_HINTS[record?.clusterId] || record?.clusterLabel;
  const value = primaryArea || (AREA_LAYOUT_ANCHORS[clusterHint] ? clusterHint : "Other");
  return AREA_LAYOUT_ANCHORS[value] || AREA_LAYOUT_ANCHORS.Other;
}

function seededGraphPosition(id, record) {
  const anchor = clusterAnchor(record);
  const angle = seededUnit(id, 1) * Math.PI * 2;
  const radius = Math.sqrt(seededUnit(id, 2)) * (record?.type === "workshop" ? 88 : 126);
  return {
    x: anchor.x + Math.cos(angle) * radius,
    y: anchor.y + Math.sin(angle) * radius,
  };
}

function projectedGraphPosition(mapPoint, id, record) {
  const hasProjection = Number.isFinite(mapPoint?.x)
    && Number.isFinite(mapPoint?.y)
    && (Math.abs(mapPoint.x) > 1e-9 || Math.abs(mapPoint.y) > 1e-9);
  if (!hasProjection) return seededGraphPosition(id, record);
  return {
    x: mapPoint.x * 1500,
    y: -mapPoint.y * 1500,
  };
}

function selectedNeighborIds(mapById) {
  const selected = mapById.get(state.selectedId);
  if (!selected) return new Set();
  return new Set((selected.nearestNeighbors || []).slice(0, 12).map((item) => item.id));
}

function focusedGraphIds(visibleIds, mapById) {
  if (!visibleIds.has(state.selectedId)) {
    state.selectedId = [...visibleIds][0] || "";
  }
  const ids = new Set([state.selectedId]);
  const selected = mapById.get(state.selectedId);
  const firstHop = (selected?.nearestNeighbors || [])
    .filter((item) => visibleIds.has(item.id))
    .slice(0, 10);
  for (const neighbor of firstHop) ids.add(neighbor.id);
  for (const neighbor of firstHop) {
    const neighborMap = mapById.get(neighbor.id);
    for (const secondHop of (neighborMap?.nearestNeighbors || []).slice(0, 4)) {
      if (visibleIds.has(secondHop.id) && secondHop.id !== state.selectedId) ids.add(secondHop.id);
    }
  }
  return ids;
}

function focusDepth(id, selectedNeighbors, mapById) {
  if (id === state.selectedId) return 0;
  if (selectedNeighbors.has(id)) return 1;
  const selected = mapById.get(state.selectedId);
  const firstHop = (selected?.nearestNeighbors || []).slice(0, 12).map((item) => item.id);
  return firstHop.some((neighborId) => (mapById.get(neighborId)?.nearestNeighbors || []).some((item) => item.id === id)) ? 2 : 3;
}

function graphNodeIds(visibleRecords, mapById) {
  const visibleIds = new Set(visibleRecords.map((record) => record.id));
  if (state.mapMode !== "focused") return visibleIds;
  return focusedGraphIds(visibleIds, mapById);
}

function focusedLayoutContext(ids, mapById) {
  const selected = mapById.get(state.selectedId);
  const firstHop = (selected?.nearestNeighbors || [])
    .filter((item) => ids.has(item.id))
    .slice(0, 10);
  const firstHopIndex = new Map(firstHop.map((item, index) => [item.id, index]));
  const firstHopScore = new Map(firstHop.map((item) => [item.id, Number(item.score || 0)]));
  const angles = new Map();
  firstHop.forEach((item, index) => {
    const baseAngle = (-Math.PI / 2) + (index / Math.max(1, firstHop.length)) * Math.PI * 2;
    angles.set(item.id, baseAngle + (seededUnit(item.id, 9) - 0.5) * 0.24);
  });

  const secondAnchors = new Map();
  firstHop.forEach((item, firstIndex) => {
    const neighborMap = mapById.get(item.id);
    (neighborMap?.nearestNeighbors || []).slice(0, 5).forEach((secondHop, secondIndex) => {
      if (!ids.has(secondHop.id) || secondHop.id === state.selectedId || firstHopIndex.has(secondHop.id)) return;
      const score = Number(secondHop.score || 0);
      const previous = secondAnchors.get(secondHop.id);
      if (!previous || score > previous.score) {
        secondAnchors.set(secondHop.id, {
          anchorId: item.id,
          firstIndex,
          secondIndex,
          score,
        });
      }
    });
  });

  return { firstHopIndex, firstHopScore, angles, secondAnchors };
}

function focusedGraphPosition(id, record, context) {
  if (id === state.selectedId) return { x: 0, y: 0 };
  if (context.firstHopIndex.has(id)) {
    const rank = context.firstHopIndex.get(id);
    const score = context.firstHopScore.get(id) || 0.5;
    const angle = context.angles.get(id) || seededUnit(id, 3) * Math.PI * 2;
    const radius = 126 + rank * 4 + (1 - Math.min(0.9, score)) * 38;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  }

  const secondAnchor = context.secondAnchors.get(id);
  if (secondAnchor) {
    const anchorAngle = context.angles.get(secondAnchor.anchorId) || 0;
    const anchorPosition = focusedGraphPosition(secondAnchor.anchorId, record, context);
    const side = secondAnchor.secondIndex % 2 === 0 ? -1 : 1;
    const angle = anchorAngle + side * (0.62 + seededUnit(id, 4) * 0.34);
    const radius = 72 + seededUnit(id, 5) * 44;
    return {
      x: anchorPosition.x + Math.cos(angle) * radius,
      y: anchorPosition.y + Math.sin(angle) * radius,
    };
  }

  const fallback = seededGraphPosition(id, record);
  return { x: fallback.x * 0.36, y: fallback.y * 0.36 };
}

function buildGraphData(visibleRecords, mapById) {
  const ids = graphNodeIds(visibleRecords, mapById);
  const recordsById = new Map(visibleRecords.map((record) => [record.id, record]));
  const selectedNeighbors = selectedNeighborIds(mapById);
  const focusContext = state.mapMode === "focused" ? focusedLayoutContext(ids, mapById) : null;
  const nodes = [...ids].map((id) => {
    const record = recordsById.get(id);
    const position = focusContext
      ? focusedGraphPosition(id, record, focusContext)
      : projectedGraphPosition(mapById.get(id), id, record);
    const depth = state.mapMode === "focused" ? focusDepth(id, selectedNeighbors, mapById) : 0;
    return {
      id,
      record,
      title: plainMathTitle(record?.title || ""),
      group: mapColorValue(record || {}),
      selected: id === state.selectedId,
      adjacent: selectedNeighbors.has(id),
      depth,
      type: record?.type || "record",
      focusRank: focusContext?.firstHopIndex.get(id) ?? 99,
      seedX: position.x,
      seedY: position.y,
      x: position.x,
      y: position.y,
    };
  }).filter((node) => node.record);
  const links = [];
  const seen = new Set();
  const neighborLimit = state.mapMode === "focused" ? 6 : 3;
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
        depth: node.id === state.selectedId || neighbor.id === state.selectedId ? 1 : 2,
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
      clearMapSelection();
      resetResultWindow();
      renderMap();
      renderViewer(null);
    });
  });
}

function mapCanvasPoint(event) {
  const rect = els.mapCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function forceGraphZoomAt(point, multiplier, duration = 180) {
  const graph = state.mapGraph;
  if (!graph || typeof graph.screen2GraphCoords !== "function") return;
  const width = els.mapCanvas.clientWidth || 840;
  const height = els.mapCanvas.clientHeight || 640;
  const currentZoom = typeof graph.zoom === "function" ? graph.zoom() : 1;
  const nextZoom = Math.max(0.08, Math.min(18, currentZoom * multiplier));
  const graphPoint = graph.screen2GraphCoords(point.x, point.y);
  const centerX = graphPoint.x - (point.x - width / 2) / nextZoom;
  const centerY = graphPoint.y - (point.y - height / 2) / nextZoom;
  graph.zoom?.(nextZoom, duration);
  graph.centerAt?.(centerX, centerY, duration);
  graph.resumeAnimation?.();
}

function forceGraphZoomToBox(start, end) {
  const graph = state.mapGraph;
  if (!graph || typeof graph.screen2GraphCoords !== "function") return;
  const width = els.mapCanvas.clientWidth || 840;
  const height = els.mapCanvas.clientHeight || 640;
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const boxWidth = Math.max(8, right - left);
  const boxHeight = Math.max(8, bottom - top);
  const topLeft = graph.screen2GraphCoords(left, top);
  const bottomRight = graph.screen2GraphCoords(right, bottom);
  const spanX = Math.max(8, Math.abs(bottomRight.x - topLeft.x));
  const spanY = Math.max(8, Math.abs(bottomRight.y - topLeft.y));
  const nextZoom = Math.max(0.08, Math.min(18, Math.min(width / spanX, height / spanY) * 0.88));
  const center = graph.screen2GraphCoords(left + boxWidth / 2, top + boxHeight / 2);
  graph.centerAt?.(center.x, center.y, 240);
  graph.zoom?.(nextZoom, 240);
  graph.resumeAnimation?.();
}

function normalizedBox(start, end) {
  return {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
}

function mapNodesInBox(start, end) {
  const graph = state.mapGraph;
  if (!graph || typeof graph.graph2ScreenCoords !== "function") return [];
  const box = normalizedBox(start, end);
  return (state.mapGraphData?.nodes || []).filter((node) => {
    const point = graph.graph2ScreenCoords(node.x || 0, node.y || 0);
    return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
  });
}

function countLabels(values) {
  const counts = new Map();
  for (const value of values.flat().filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function renderMapSelectionSummary(nodes) {
  const records = nodes.map((node) => node.record).filter(Boolean);
  const areas = countLabels(records.map((record) => record.areaTags || []));
  const groups = countLabels(records.map((record) => [record.group || record.clusterLabel || "Other"]));
  const types = countLabels(records.map((record) => [typeLabel(record.type)]));
  const sample = records.slice(0, 8);
  els.mapDetail.innerHTML = `
    <div class="map-detail-card">
      <p class="eyebrow">BOX SELECTION</p>
      <h3>${nodes.length.toLocaleString()} mapped records</h3>
      <button class="action primary map-zoom-selection" type="button">Zoom to selection</button>
      <div class="selection-stat-grid">
        ${types.slice(0, 3).map(([label, count]) => `<span><strong>${count.toLocaleString()}</strong>${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="selection-stat-block">
        <strong>Top areas</strong>
        ${areas.slice(0, 6).map(([label, count]) => `<span><em>${escapeHtml(label)}</em><b>${count.toLocaleString()}</b></span>`).join("") || "<small>No area tags</small>"}
      </div>
      <div class="selection-stat-block">
        <strong>Top groups</strong>
        ${groups.slice(0, 5).map(([label, count]) => `<span><em>${escapeHtml(label)}</em><b>${count.toLocaleString()}</b></span>`).join("") || "<small>No groups</small>"}
      </div>
      <div class="selection-stat-block">
        <strong>Sample records</strong>
        ${sample.map((record) => `<button type="button" class="neighbor-item" data-id="${escapeHtml(record.id)}"><strong>${escapeHtml(plainMathTitle(record.title))}</strong><span>${escapeHtml(record.group || typeLabel(record.type))}</span></button>`).join("") || "<small>No records inside the box</small>"}
      </div>
    </div>
  `;
  els.mapDetail.querySelector(".map-zoom-selection")?.addEventListener("click", () => zoomToMapSelection());
  els.mapDetail.querySelectorAll(".neighbor-item").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = state.data.records.find((item) => item.id === button.dataset.id);
      if (!selected) return;
      state.selectedId = selected.id;
      refreshForceSelectionState();
      renderMapDetail(selected);
      renderViewer(selected);
    });
  });
}

function setMapSelection(start, end) {
  const nodes = mapNodesInBox(start, end);
  state.mapSelection = {
    active: true,
    start,
    end,
    nodeIds: nodes.map((node) => node.id),
  };
  updateMapSelectionBox(start, end);
  renderMapSelectionSummary(nodes);
}

function clearMapSelection() {
  state.mapSelection = { active: false, start: null, end: null, nodeIds: [] };
  hideMapSelectionBox();
}

function zoomToMapSelection() {
  if (!state.mapSelection.active || !state.mapSelection.start || !state.mapSelection.end) return false;
  forceGraphZoomToBox(state.mapSelection.start, state.mapSelection.end);
  clearMapSelection();
  return true;
}

function ensureMapSelectionBox() {
  let box = els.mapCanvas.querySelector(".map-selection-box");
  if (!box) {
    box = document.createElement("div");
    box.className = "map-selection-box";
    els.mapCanvas.appendChild(box);
  }
  return box;
}

function updateMapSelectionBox(start, current) {
  const box = ensureMapSelectionBox();
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  box.style.transform = `translate(${left}px, ${top}px)`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.hidden = false;
}

function hideMapSelectionBox() {
  const box = els.mapCanvas.querySelector(".map-selection-box");
  if (box) box.hidden = true;
}

function graphClickSuppressed() {
  return performance.now() < state.mapInteraction.suppressClickUntil;
}

function refreshForceSelectionState() {
  if (!state.mapGraphData?.nodes?.length) return;
  const mapById = mapRecordById();
  const selectedNeighbors = selectedNeighborIds(mapById);
  for (const node of state.mapGraphData.nodes) {
    node.selected = node.id === state.selectedId;
    node.adjacent = selectedNeighbors.has(node.id);
  }
  for (const link of state.mapGraphData.links || []) {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    link.selected = source === state.selectedId || target === state.selectedId;
  }
  state.mapGraph?.refresh?.();
}

function isTypingTarget(target) {
  return ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(target?.tagName);
}

function installMapPointerInteractions() {
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || isTypingTarget(event.target)) return;
    if (state.tab !== "map" || state.mapEngine !== "force") return;
    event.preventDefault();
    state.mapInteraction.spaceDown = true;
    els.mapCanvas.classList.add("is-space-ready");
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "Space") return;
    state.mapInteraction.spaceDown = false;
    els.mapCanvas.classList.remove("is-space-ready", "is-panning");
  });

  els.mapCanvas.addEventListener("pointerdown", (event) => {
    if (state.tab !== "map" || state.mapEngine !== "force" || event.button !== 0 || !state.mapGraph) return;
    const point = mapCanvasPoint(event);
    const interaction = state.mapInteraction;
    interaction.pointerId = event.pointerId;
    interaction.mode = interaction.spaceDown ? "pan" : "box";
    interaction.moved = false;
    interaction.start = point;
    interaction.last = point;
    interaction.center = state.mapGraph.centerAt?.() || { x: 0, y: 0 };
    els.mapCanvas.setPointerCapture?.(event.pointerId);
    if (interaction.mode === "pan") {
      els.mapCanvas.classList.add("is-panning");
      clearMapSelection();
    } else {
      updateMapSelectionBox(point, point);
    }
    event.preventDefault();
  });

  els.mapCanvas.addEventListener("pointermove", (event) => {
    const interaction = state.mapInteraction;
    if (interaction.pointerId !== event.pointerId || !interaction.mode || !state.mapGraph) return;
    const point = mapCanvasPoint(event);
    const dx = point.x - interaction.start.x;
    const dy = point.y - interaction.start.y;
    if (Math.hypot(dx, dy) > 4) interaction.moved = true;
    if (interaction.mode === "pan") {
      const zoom = typeof state.mapGraph.zoom === "function" ? state.mapGraph.zoom() : 1;
      state.mapGraph.centerAt?.(
        interaction.center.x - dx / zoom,
        interaction.center.y - dy / zoom,
        0,
      );
    } else {
      updateMapSelectionBox(interaction.start, point);
    }
    interaction.last = point;
    event.preventDefault();
  });

  els.mapCanvas.addEventListener("pointerup", (event) => {
    const interaction = state.mapInteraction;
    if (interaction.pointerId !== event.pointerId || !interaction.mode) return;
    els.mapCanvas.releasePointerCapture?.(event.pointerId);
    els.mapCanvas.classList.remove("is-panning");
    const mode = interaction.mode;
    const moved = interaction.moved;
    const start = interaction.start;
    const end = mapCanvasPoint(event);
    interaction.pointerId = null;
    interaction.mode = "";
    hideMapSelectionBox();
    if (mode === "box" && moved && Math.hypot(end.x - start.x, end.y - start.y) > 10) {
      interaction.suppressClickUntil = performance.now() + 300;
      setMapSelection(start, end);
    }
    event.preventDefault();
  });

  els.mapCanvas.addEventListener("pointercancel", () => {
    state.mapInteraction.pointerId = null;
    state.mapInteraction.mode = "";
    els.mapCanvas.classList.remove("is-panning");
    clearMapSelection();
  });
}

function ensureForceGraph() {
  if (state.mapGraph || typeof window.ForceGraph !== "function") return state.mapGraph;
  els.mapCanvas.innerHTML = "";
  state.mapGraph = window.ForceGraph()(els.mapCanvas)
    .backgroundColor("#111827")
    .nodeId("id")
    .nodeLabel((node) => node.title)
    .nodeVal((node) => node.selected ? 5.5 : node.depth === 1 ? 3.6 : node.depth === 2 ? 2.3 : node.type === "workshop" ? 1.9 : 1.5)
    .enableZoomInteraction(false)
    .enablePanInteraction(false)
    .enableNodeDrag(false)
    .linkCurvature(0.06)
    .linkWidth((link) => link.selected ? 1.25 : Math.max(0.18, Number(link.value || 0) * (state.mapMode === "focused" ? 1.1 : 1.45)))
    .linkColor((link) => link.selected ? "rgba(148,196,255,0.48)" : state.mapMode === "focused" ? "rgba(148,163,184,0.13)" : "rgba(148,163,184,0.07)")
    .linkDirectionalParticles((link) => link.selected && state.mapLive ? 1 : 0)
    .linkDirectionalParticleWidth(1)
    .linkDirectionalParticleSpeed(0.004)
    .d3AlphaMin(0.0006)
    .d3AlphaDecay(0.01)
    .d3VelocityDecay(0.38)
    .onNodeHover((node) => {
      state.mapHoverId = node?.id || "";
      els.mapCanvas.style.cursor = node && !state.mapInteraction.spaceDown ? "pointer" : "";
      state.mapGraph?.refresh?.();
    })
    .onNodeClick((node, event) => {
      if (graphClickSuppressed() || !node?.record) return;
      if (!event?.shiftKey && zoomToMapSelection()) return;
      state.selectedId = node.id;
      refreshForceSelectionState();
      renderMapDetail(node.record);
      renderViewer(node.record);
      forceGraphZoomAt(mapCanvasPoint(event), event?.shiftKey ? 0.72 : 1.34);
    })
    .onBackgroundClick((event) => {
      if (graphClickSuppressed()) return;
      if (!event?.shiftKey && zoomToMapSelection()) return;
      forceGraphZoomAt(mapCanvasPoint(event), event?.shiftKey ? 0.72 : 1.34);
    })
    .nodeCanvasObject((node, ctx, globalScale) => {
      const color = colorForValue(node.group);
      const isSelected = node.id === state.selectedId;
      const isHover = node.id === state.mapHoverId;
      const isAdjacent = node.adjacent;
      const radius = isSelected ? 6.6 : isHover ? 5.6 : isAdjacent ? 4.1 : node.depth === 2 ? 3.1 : 2.5;
      if (isSelected || isHover) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + (isSelected ? 8 : 5), 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? "rgba(96,165,250,0.14)" : "rgba(255,255,255,0.10)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected ? "#60a5fa" : color;
      ctx.globalAlpha = isSelected || isAdjacent || isHover ? 0.98 : state.mapMode === "focused" ? 0.78 : 0.82;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isSelected ? 1.5 : 0.7;
      ctx.strokeStyle = isSelected ? "#bfdbfe" : "rgba(255,255,255,0.46)";
      ctx.stroke();
      const shouldLabel = isHover
        || isSelected
        || (state.mapMode === "focused" && node.depth === 1 && node.focusRank < 1 && globalScale > 0.78);
      if (!shouldLabel) return;
      const maxLabelLength = state.mapMode === "focused" ? 28 : 58;
      const label = node.title.length > maxLabelLength ? `${node.title.slice(0, maxLabelLength - 3)}...` : node.title;
      const fontSize = Math.min(13, Math.max(9, 11 / globalScale));
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      const labelOnLeft = state.mapMode === "focused" && node.x > 0;
      ctx.textAlign = labelOnLeft ? "right" : "left";
      ctx.textBaseline = "middle";
      const textX = labelOnLeft ? node.x - radius - 5 : node.x + radius + 5;
      const textY = node.y;
      const metrics = ctx.measureText(label);
      ctx.fillStyle = "rgba(17,24,39,0.78)";
      const boxX = labelOnLeft ? textX - metrics.width - 3 : textX - 3;
      ctx.fillRect(boxX, textY - fontSize * 0.7, metrics.width + 6, fontSize * 1.35);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(label, textX, textY);
    });
  applyMapMotionSettings(state.mapGraph);
  return state.mapGraph;
}

function updateMapControlState() {
  if (!els.mapLive) return;
  els.mapLive.classList.toggle("is-active", state.mapLive);
  els.mapLive.setAttribute("aria-pressed", String(state.mapLive));
  els.mapLive.textContent = state.mapLive ? "Live: On" : "Live: Off";
}

function destroyGraphEngine(except = "") {
  if (except !== "force" && state.mapGraph) {
    state.mapGraph.pauseAnimation?.();
    state.mapGraph = null;
    state.mapGraphData = null;
  }
  if (except !== "sigma" && state.sigmaRenderer) {
    state.sigmaRenderer.kill?.();
    state.sigmaRenderer = null;
    state.sigmaGraph = null;
  }
  if (except !== "cytoscape" && state.cyGraph) {
    state.cyGraph.destroy?.();
    state.cyGraph = null;
  }
  if (except !== "force" && except !== "sigma" && except !== "cytoscape") {
    els.mapCanvas.innerHTML = "";
  }
}

function graphDataBounds(graphData) {
  const allNodes = graphData?.nodes || [];
  const focusedNodes = state.mapMode === "focused"
    ? allNodes.filter((node) => node.depth <= 1)
    : allNodes;
  const nodes = focusedNodes.length ? focusedNodes : allNodes;
  if (!nodes.length) return null;
  return nodes.reduce((bounds, node) => ({
    minX: Math.min(bounds.minX, Number(node.x) || 0),
    maxX: Math.max(bounds.maxX, Number(node.x) || 0),
    minY: Math.min(bounds.minY, Number(node.y) || 0),
    maxY: Math.max(bounds.maxY, Number(node.y) || 0),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function fitForceGraph(graph = state.mapGraph, graphData = state.mapGraphData, options = {}) {
  if (!graph || !graphData?.nodes?.length) return;
  const bounds = graphDataBounds(graphData);
  if (!bounds) return;
  const width = els.mapCanvas.clientWidth || 840;
  const height = els.mapCanvas.clientHeight || 640;
  const padding = options.padding ?? (state.mapMode === "focused" ? 84 : 92);
  const duration = options.duration ?? 420;
  const spanX = Math.max(80, bounds.maxX - bounds.minX);
  const spanY = Math.max(80, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(80, width - padding * 2);
  const availableHeight = Math.max(80, height - padding * 2);
  const fitScale = Math.min(
    availableWidth / spanX,
    availableHeight / spanY,
  );
  const zoom = Math.max(0.16, Math.min(state.mapMode === "focused" ? 3.2 : 1.35, fitScale));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  graph.centerAt?.(centerX, centerY, duration);
  graph.zoom?.(zoom, duration);
}

function createAnchorForce(strength) {
  let nodes = [];
  const force = (alpha) => {
    for (const node of nodes) {
      const targetX = Number(node.seedX) || 0;
      const targetY = Number(node.seedY) || 0;
      node.vx += (targetX - node.x) * strength * alpha;
      node.vy += (targetY - node.y) * strength * alpha;
    }
  };
  force.initialize = (nextNodes) => {
    nodes = nextNodes || [];
  };
  return force;
}

function applyForceAnchors(graph, strength) {
  if (!graph) return;
  graph.d3Force("anchor", createAnchorForce(strength));
}

function applyMapMotionSettings(graph = state.mapGraph) {
  if (!graph) return;
  const alphaTarget = state.mapLive
    ? state.mapMode === "focused" ? 0.014 : 0.006
    : 0;
  graph
    .autoPauseRedraw(!state.mapLive)
    .cooldownTicks(state.mapLive ? Infinity : 180)
    .cooldownTime(state.mapLive ? Infinity : 14000);
  if (typeof graph.d3AlphaTarget === "function") {
    graph.d3AlphaTarget(alphaTarget);
  }
  updateMapControlState();
}

function reflowMap(options = {}) {
  if (state.mapEngine === "sigma" && state.sigmaRenderer) {
    const camera = state.sigmaRenderer.getCamera?.();
    camera?.animatedReset?.({ duration: 280 });
    return;
  }
  if (state.mapEngine === "cytoscape" && state.cyGraph) {
    if (options.fit) state.cyGraph.fit(undefined, 48);
    else state.cyGraph.layout({ name: "preset", fit: true, padding: 48 }).run();
    return;
  }
  if (state.mapEngine === "force") {
    const graph = state.mapGraph;
    if (!graph) return;
    applyMapMotionSettings(graph);
    graph.resumeAnimation?.();
    graph.d3ReheatSimulation?.();
    if (options.fit) {
      window.setTimeout(() => {
        if (state.tab === "map" && state.mapGraph === graph) {
          fitForceGraph(graph, state.mapGraphData, { duration: 420, padding: 96 });
        }
      }, options.delay || 120);
    }
  }
}

function zoomMap(multiplier) {
  if (state.mapEngine === "sigma" && state.sigmaRenderer) {
    const camera = state.sigmaRenderer.getCamera?.();
    if (!camera) return;
    const nextRatio = Math.max(0.02, Math.min(8, camera.ratio / multiplier));
    camera.animate?.({ ratio: nextRatio }, { duration: 180 });
    return;
  }
  if (state.mapEngine === "cytoscape" && state.cyGraph) {
    const current = state.cyGraph.zoom();
    state.cyGraph.zoom({
      level: Math.max(0.05, Math.min(8, current * multiplier)),
      renderedPosition: { x: els.mapCanvas.clientWidth / 2, y: els.mapCanvas.clientHeight / 2 },
    });
    return;
  }
  if (state.mapEngine === "force") {
    const graph = state.mapGraph;
    if (!graph) return;
    const currentZoom = typeof graph.zoom === "function" ? graph.zoom() : 1;
    graph.zoom(Math.max(0.08, Math.min(18, currentZoom * multiplier)), 220);
    graph.resumeAnimation?.();
  }
}

function graphologyConstructor() {
  return window.graphology?.Graph || window.Graphology?.Graph || window.graphology;
}

function renderSigmaGraph(graphData) {
  const Graph = graphologyConstructor();
  if (!Graph || typeof window.Sigma !== "function") return false;
  state.mapGraph?.pauseAnimation?.();
  state.mapGraph = null;
  state.cyGraph?.destroy?.();
  state.cyGraph = null;
  state.sigmaRenderer?.kill?.();
  state.sigmaRenderer = null;
  state.sigmaGraph = new Graph({ type: "undirected", multi: false });
  const graph = state.sigmaGraph;
  const selectedNeighbors = new Set(graphData.nodes.filter((node) => node.depth === 1).map((node) => node.id));
  for (const node of graphData.nodes) {
    graph.addNode(node.id, {
      x: node.x,
      y: node.y,
      label: state.mapMode === "focused" && (node.selected || selectedNeighbors.has(node.id)) ? node.title : "",
      size: node.selected ? 9 : node.depth === 1 ? 6.5 : node.depth === 2 ? 4.2 : 2.4,
      color: node.selected ? "#60a5fa" : colorForValue(node.group),
      record: node.record,
      forceLabel: node.selected,
    });
  }
  graphData.links.forEach((link, index) => {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (graph.hasNode(source) && graph.hasNode(target) && !graph.hasEdge(source, target)) {
      graph.addEdgeWithKey(`${source}->${target}-${index}`, source, target, {
        size: link.selected ? 0.9 : 0.12,
        color: link.selected ? "#5f8fd3" : "#263244",
      });
    }
  });
  els.mapCanvas.innerHTML = "";
  state.sigmaRenderer = new window.Sigma(graph, els.mapCanvas, {
    allowInvalidContainer: true,
    defaultEdgeColor: "#263244",
    defaultNodeColor: "#60a5fa",
    labelColor: { color: "#e5e7eb" },
    labelDensity: state.mapMode === "focused" ? 0.18 : 0.04,
    labelRenderedSizeThreshold: state.mapMode === "focused" ? 7 : 11,
    renderEdgeLabels: false,
  });
  state.sigmaRenderer.on?.("clickNode", ({ node }) => {
    const record = graph.getNodeAttribute(node, "record");
    if (!record) return;
    state.selectedId = node;
    renderMap();
    renderMapDetail(record);
    renderViewer(record);
  });
  state.sigmaRenderer.on?.("enterNode", ({ node }) => {
    state.mapHoverId = node;
    els.mapCanvas.style.cursor = "pointer";
  });
  state.sigmaRenderer.on?.("leaveNode", () => {
    state.mapHoverId = "";
    els.mapCanvas.style.cursor = "grab";
  });
  window.setTimeout(() => state.sigmaRenderer?.getCamera?.()?.animatedReset?.({ duration: 260 }), 80);
  return true;
}

function renderCytoscapeGraph(graphData) {
  if (typeof window.cytoscape !== "function") return false;
  state.mapGraph?.pauseAnimation?.();
  state.mapGraph = null;
  state.sigmaRenderer?.kill?.();
  state.sigmaRenderer = null;
  state.sigmaGraph = null;
  state.cyGraph?.destroy?.();
  state.cyGraph = null;
  els.mapCanvas.innerHTML = "";
  const elements = [
    ...graphData.nodes.map((node) => ({
      data: {
        id: node.id,
        label: state.mapMode === "focused" && node.selected ? plainMathTitle(node.title).slice(0, 26) : "",
        color: node.selected ? "#60a5fa" : colorForValue(node.group),
        size: node.selected ? 18 : node.depth === 1 ? 12 : node.depth === 2 ? 8 : 5,
      },
      position: { x: node.x, y: node.y },
      classes: node.selected ? "selected" : node.depth === 1 ? "near" : node.depth === 2 ? "second" : "",
    })),
    ...graphData.links.map((link, index) => ({
      data: {
        id: `e-${index}`,
        source: typeof link.source === "object" ? link.source.id : link.source,
        target: typeof link.target === "object" ? link.target.id : link.target,
        selected: link.selected,
      },
      classes: link.selected ? "selected" : "",
    })),
  ];
  state.cyGraph = window.cytoscape({
    container: els.mapCanvas,
    elements,
    minZoom: 0.04,
    maxZoom: 6,
    wheelSensitivity: 0.18,
    layout: { name: "preset", fit: true, padding: 56 },
    style: [
      { selector: "node", style: { "background-color": "data(color)", width: "data(size)", height: "data(size)", "border-color": "rgba(255,255,255,0.52)", "border-width": 1, label: "data(label)", color: "#e5e7eb", "font-size": 10, "text-outline-color": "#111827", "text-outline-width": 3 } },
      { selector: "node.selected", style: { width: 22, height: 22, "border-color": "#dbeafe", "border-width": 3 } },
      { selector: "edge", style: { width: 0.28, "line-color": "#263244", opacity: 0.55, "curve-style": "haystack", "haystack-radius": 0 } },
      { selector: "edge.selected", style: { width: 0.9, "line-color": "#5f8fd3", opacity: 0.78 } },
    ],
  });
  state.cyGraph.on("tap", "node", (event) => {
    const id = event.target.id();
    const record = state.data.records.find((item) => item.id === id);
    if (!record) return;
    state.selectedId = id;
    renderMap();
    renderMapDetail(record);
    renderViewer(record);
  });
  return true;
}

function renderForceGraph(graphData) {
  destroyGraphEngine("force");
  const graph = ensureForceGraph();
  if (!graph) return false;
  ensureMapSelectionBox();
  state.mapGraphData = graphData;
  graph
    .width(els.mapCanvas.clientWidth || 840)
    .height(els.mapCanvas.clientHeight || 640)
    .graphData(graphData);
  applyMapMotionSettings(graph);
  if (state.mapMode === "focused") {
    graph.d3Force("charge")?.strength((node) => node.selected ? -145 : node.depth === 1 ? -72 : -34);
    graph.d3Force("link")?.distance((link) => link.selected ? 58 : 66);
    applyForceAnchors(graph, 0.028);
    fitForceGraph(graph, graphData, { duration: 260, padding: 88 });
    window.setTimeout(() => {
      if (state.tab === "map" && state.mapMode === "focused" && state.mapGraph === graph) {
        fitForceGraph(graph, graphData, { duration: 420, padding: 84 });
      }
    }, 350);
  } else {
    graph.d3Force("charge")?.strength(-22);
    graph.d3Force("link")?.distance(24);
    applyForceAnchors(graph, 0.04);
    window.setTimeout(() => {
      if (state.tab === "map" && state.mapMode === "global" && state.mapGraph === graph) {
        fitForceGraph(graph, graphData, { duration: 420, padding: 118 });
      }
    }, 450);
    window.setTimeout(() => {
      if (state.tab === "map" && state.mapMode === "global" && state.mapGraph === graph) {
        fitForceGraph(graph, graphData, { duration: 360, padding: 118 });
      }
    }, 1100);
  }
  reflowMap();
  return true;
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
    destroyGraphEngine();
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No mapped records</strong><span>Adjust the filters.</span></div>`;
    renderMapDetail(null);
    return;
  }
  const graphData = buildGraphData(visibleRecords, mapById);
  const rendered = state.mapEngine === "sigma"
    ? renderSigmaGraph(graphData)
    : state.mapEngine === "cytoscape"
      ? renderCytoscapeGraph(graphData)
      : renderForceGraph(graphData);
  if (!rendered) {
    destroyGraphEngine();
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>Graph library unavailable</strong><span>force-graph could not be loaded.</span></div>`;
    renderMapDetail(visibleRecords[0]);
    return;
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
  if (window.location.hostname.endsWith("github.io")) return `${REPO_CDN_BASE}${path}`;
  return new URL(`${LOCAL_ASSET_PREFIX}${path}`, window.location.href).href;
}

function pdfViewerUrl(path) {
  return assetUrl(path);
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
    els.viewerFrame.innerHTML = `<div class="empty-state"><strong>No record selected</strong><span>Pick a result to preview its collected material.</span></div>`;
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
  if (!isMap && state.mapGraph) {
    state.mapGraph.pauseAnimation?.();
  } else if (isMap && state.mapGraph && state.mapLive) {
    state.mapGraph.resumeAnimation?.();
  }
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
    clearMapSelection();
    els.asset.value = "all";
      resetResultWindow();
      renderAll();
    });
  });

  els.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    clearMapSelection();
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.category.addEventListener("change", (event) => {
    state.category = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    clearMapSelection();
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.group.addEventListener("change", (event) => {
    state.group = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    clearMapSelection();
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.asset.addEventListener("change", (event) => {
    state.asset = event.target.value;
    state.selectedId = "";
    state.mapFilterValue = "";
    clearMapSelection();
    resetResultWindow();
    renderResults();
    renderMap();
    renderViewer(null);
  });
  els.mapColor.addEventListener("change", (event) => {
    state.mapColor = event.target.value;
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
