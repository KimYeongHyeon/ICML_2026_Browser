const DATA_URL = "site/data/icml2026_index.json";
const MAP_URL = "site/data/icml2026_map.json";
const PAGE_SIZE = 80;
const REPO_CDN_BASE = "https://cdn.jsdelivr.net/gh/KimYeongHyeon/icml-2026-materials-browser@main/";
const LOCAL_ASSET_PREFIX = window.location.pathname.includes("/docs/") ? "../" : "";
const MATHJAX_RETRY_LIMIT = 40;
const PDFJS_MODULE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/+esm";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const CYTOSCAPE_URL = "https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js";

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
  mapColor: "area-domain",
  mapMode: "global",
  mapLive: true,
  mapFilterValue: "",
  mapGraph: null,
  mapGraphData: null,
  miniGraph: null,
  cyGraph: null,
  mapHoverId: "",
  mapRenderToken: 0,
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
  pdfViewer: {
    token: 0,
    loadingTask: null,
    renderTask: null,
  },
};

let pdfJsPromise = null;
const scriptPromises = new Map();

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
  "cluster-multimodal-learning": "Multimodal Learning",
  "cluster-generative": "Generative Models",
  "cluster-generative-models": "Generative Models",
  "cluster-optimization": "Optimization",
  "cluster-theory": "Theory",
  "cluster-probabilistic": "Probabilistic Methods",
  "cluster-probabilistic-methods": "Probabilistic Methods",
  "cluster-rl": "Reinforcement Learning",
  "cluster-reinforcement-learning": "Reinforcement Learning",
  "cluster-safety": "Safety",
  "cluster-evaluation": "Evaluation",
  "cluster-other": "Other",
};

const CLUSTER_ORDER = [
  "cluster-llms",
  "cluster-agents",
  "cluster-systems",
  "cluster-vision",
  "cluster-multimodal",
  "cluster-multimodal-learning",
  "cluster-generative",
  "cluster-generative-models",
  "cluster-optimization",
  "cluster-theory",
  "cluster-probabilistic",
  "cluster-probabilistic-methods",
  "cluster-rl",
  "cluster-reinforcement-learning",
  "cluster-safety",
  "cluster-evaluation",
  "cluster-other",
];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
  title = title.replace(/\\(?:texttt|textbf|textit|mathrm|mathbf|mathsf|operatorname)\{([^{}]+)\}/g, "$1");
  title = title.replace(/\\([a-zA-Z]+)/g, (_, command) => greek[command] || command);
  title = title.replace(/\$([^$]+)\$/g, "$1");
  title = title.replace(/:([A-Za-z])/g, ": $1");
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

function paperPresentationKind(record) {
  if (record.type !== "paper") return record.presentationType || "";
  const labels = Array.isArray(record.presentationLabels) ? record.presentationLabels : [];
  if (labels.includes("Oral")) return "Oral";
  if (labels.includes("Spotlight")) return "Spotlight";
  return "";
}

function viewerKindLabel(record) {
  if (record.type === "paper") {
    return `${typeLabel(record.type)} · ${paperPresentationKind(record) || record.group || "Main Conference"}`;
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

function statusLabel(value) {
  const labels = {
    accepted_public: "Accepted public",
    metadata_only: "Metadata only",
    downloaded: "Downloaded",
    blocked: "Blocked",
    unavailable: "Unavailable",
    failed: "Failed",
    skipped: "Skipped",
  };
  return labels[value] || value;
}

function presentationBadges(record) {
  const labels = Array.isArray(record.presentationLabels) ? record.presentationLabels : [];
  return labels.map((label) => {
    const className = label.toLowerCase() === "spotlight" ? "spotlight" : label.toLowerCase() === "oral" ? "oral" : "";
    return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
  }).join("");
}

function resultDetails(record) {
  return [record.session, record.roomName, record.failureReason].filter(Boolean).join(" · ");
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
    const haystack = normalize(`${record.title} ${plainMathTitle(record.title)} ${record.authors} ${record.group} ${record.decision || ""} ${record.presentationType || ""} ${(record.presentationLabels || []).join(" ")} ${record.session || ""} ${categoryTags(record).join(" ")} ${(record.areaTags || []).join(" ")} ${(record.domainTags || []).join(" ")} ${record.clusterLabel || ""}`);
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

function assetOption(value, label, count, disabled = false) {
  const suffix = value !== "all" && disabled ? " (0)" : "";
  return `<option value="${escapeHtml(value)}"${disabled ? " disabled" : ""}>${escapeHtml(`${label}${suffix}`)}</option>`;
}

function updateAssetOptions(recordsForTab) {
  const counts = {
    all: recordsForTab.length,
    local: recordsForTab.filter((record) => record.hasPdf || record.hasPoster || record.hasSlide).length,
    pdf: recordsForTab.filter((record) => record.hasPdf).length,
    poster: recordsForTab.filter((record) => record.hasPoster).length,
    slide: recordsForTab.filter((record) => record.hasSlide).length,
    blocked: recordsForTab.filter((record) => record.availabilityStatus === "blocked").length,
    metadata: recordsForTab.filter((record) => record.availabilityStatus === "metadata").length,
    unavailable: recordsForTab.filter((record) => record.availabilityStatus === "unavailable").length,
  };
  const options = [
    ["all", "All records"],
    ["local", "Downloaded locally"],
    ["pdf", "Has PDF"],
    ["poster", "Has poster image"],
    ["slide", "Has slide deck"],
    ["blocked", "Blocked"],
    ["metadata", "Metadata only"],
    ["unavailable", "Unavailable / skipped"],
  ];
  els.asset.innerHTML = options
    .map(([value, label]) => assetOption(value, label, counts[value] || 0, value !== "all" && !counts[value]))
    .join("");
  if (!counts[state.asset] && state.asset !== "all") state.asset = "all";
  els.asset.value = state.asset;
}

const ASSET_FILTER_LABELS = {
  all: "all assets",
  local: "downloaded locally",
  pdf: "has PDF",
  poster: "has poster image",
  slide: "has slide deck",
  blocked: "blocked",
  metadata: "metadata only",
  unavailable: "unavailable / skipped",
};

function activeFilterSummary(baseLabel, extraParts = []) {
  const parts = [baseLabel, state.category === "all" ? "all fields" : state.category];
  if (state.group !== "all") parts.push(state.group);
  if (state.asset !== "all") parts.push(ASSET_FILTER_LABELS[state.asset] || state.asset);
  if (state.query.trim()) {
    const query = state.query.trim();
    parts.push(`search: ${query.length > 32 ? query.slice(0, 31) + "..." : query}`);
  }
  return [...parts, ...extraParts.filter(Boolean)].join(" · ");
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
  updateAssetOptions(recordsForTab);
}

function renderResults() {
  const filtered = getFilteredRecords();
  els.resultCount.textContent = `${filtered.length.toLocaleString()} results`;
  els.activeSummary.textContent = activeFilterSummary(typeLabel(state.tab));

  const visible = filtered.slice(0, state.visibleCount);
  els.results.innerHTML = visible
    .map((record) => {
      const selected = record.id === state.selectedId ? " is-selected" : "";
      const featured = (record.presentationLabels || []).includes("Spotlight") ? " is-spotlight" : (record.presentationLabels || []).includes("Oral") ? " is-oral" : "";
      const details = resultDetails(record);
      return `
        <button class="result-item${selected}${featured}" type="button" data-id="${escapeHtml(record.id)}">
          <span class="result-title">${escapeHtml(plainMathTitle(record.title))}</span>
          <span class="result-authors">${escapeHtml(record.authors || "Authors unavailable")}</span>
          <span class="badges">
            ${presentationBadges(record)}
            ${categoryTags(record).slice(0, 3).map((category) => `<span class="badge">${escapeHtml(category)}</span>`).join("")}
            <span class="badge">${escapeHtml(record.group)}</span>
            <span class="badge">${assetLabel(record)}</span>
            <span class="badge ${statusClass(record)}">${escapeHtml(record.availabilityLabel || "Metadata only")}</span>
          </span>
          ${details ? `<span class="result-details">${escapeHtml(details)}</span>` : ""}
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
  if (state.mapColor === "cluster") return clusterColorLabel(record);
  if (state.mapColor === "quality") return record.embeddingTextQuality || "unavailable";
  if (state.mapColor === "availability") return record.availabilityLabel || "Metadata";
  return (record.areaTags || record.categoryTags || ["Other"])[0] || "Other";
}

function clusterColorLabel(record) {
  const clusterId = record?.clusterId || "";
  const rawLabel = record?.clusterLabel || CLUSTER_AREA_HINTS[clusterId] || "Cluster";
  const knownIndex = CLUSTER_ORDER.indexOf(clusterId);
  const ordinal = knownIndex >= 0 ? knownIndex + 1 : (stableHash(clusterId || rawLabel) % 90) + 10;
  return `C${String(ordinal).padStart(2, "0")} · ${rawLabel}`;
}

function colorForValue(value) {
  const palette = {
    "area-domain": AREA_COLORS,
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

function areaColorValue(record) {
  return (record?.areaTags || record?.categoryTags || ["Other"])[0] || "Other";
}

function domainColorValue(record) {
  return (record?.domainTags || ["General"])[0] || "General";
}

function domainRingColor(record) {
  return DOMAIN_COLORS[domainColorValue(record)] || colorForValue(domainColorValue(record));
}

function availabilityStatusKind(value) {
  const key = String(value || "").toLowerCase();
  if (key.includes("download")) return "ok";
  if (key.includes("block")) return "warn";
  if (key.includes("unavail") || key.includes("skip")) return "off";
  return "meta";
}

// Structured tooltip markup with a clear hierarchy: bold title, muted authors,
// color-dotted Area/Domain (the "Area:"/"Domain:" labels are kept for the spec
// and smoke contract), a type chip, and a color-coded availability pill. All
// user text is escaped.
function graphTooltipHTML(node) {
  const record = node?.record;
  const title = node?.title || (record ? plainMathTitle(record.title) : "");
  if (!record) return `<div class="gt-title">${escapeHtml(title)}</div>`;
  const area = areaColorValue(record);
  const domain = domainColorValue(record);
  const authors = record.authors
    ? (record.authors.length > 110 ? `${record.authors.slice(0, 107)}…` : record.authors)
    : "";
  const availability = record.availabilityLabel || record.bestAssetKind || record.status || "";
  const parts = [`<div class="gt-title">${escapeHtml(title)}</div>`];
  if (authors) parts.push(`<div class="gt-authors">${escapeHtml(authors)}</div>`);
  parts.push(
    `<div class="gt-meta">`
    + `<span><i class="gt-dot" style="background:${escapeHtml(colorForValue(area))}"></i>Area: ${escapeHtml(area)}</span>`
    + `<span><i class="gt-dot" style="background:${escapeHtml(domainRingColor(record))}"></i>Domain: ${escapeHtml(domain)}</span>`
    + `</div>`,
  );
  const foot = [`<span class="gt-type">${escapeHtml(typeLabel(record.type))}</span>`];
  if (record.clusterLabel) foot.push(`<span class="gt-cluster">${escapeHtml(record.clusterLabel)}</span>`);
  if (availability) {
    foot.push(`<span class="gt-status gt-status--${availabilityStatusKind(availability)}">${escapeHtml(String(availability))}</span>`);
  }
  parts.push(`<div class="gt-foot">${foot.join("")}</div>`);
  return parts.join("");
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

function selectedNeighborIds(mapById, selectedId = state.selectedId, limit = 12) {
  const selected = mapById.get(selectedId);
  if (!selected) return new Set();
  return new Set((selected.nearestNeighbors || []).slice(0, limit).map((item) => item.id));
}

function focusedGraphIds(visibleIds, mapById, selectedId = state.selectedId) {
  if (selectedId === state.selectedId && !visibleIds.has(state.selectedId)) {
    state.selectedId = [...visibleIds][0] || "";
    selectedId = state.selectedId;
  }
  const ids = new Set([selectedId]);
  const selected = mapById.get(selectedId);
  const firstHop = (selected?.nearestNeighbors || [])
    .filter((item) => visibleIds.has(item.id))
    .slice(0, 10);
  for (const neighbor of firstHop) ids.add(neighbor.id);
  for (const neighbor of firstHop) {
    const neighborMap = mapById.get(neighbor.id);
    for (const secondHop of (neighborMap?.nearestNeighbors || []).slice(0, 4)) {
      if (visibleIds.has(secondHop.id) && secondHop.id !== selectedId) ids.add(secondHop.id);
    }
  }
  return ids;
}

function focusDepth(id, selectedNeighbors, mapById, selectedId = state.selectedId) {
  if (id === selectedId) return 0;
  if (selectedNeighbors.has(id)) return 1;
  const selected = mapById.get(selectedId);
  const firstHop = (selected?.nearestNeighbors || []).slice(0, 12).map((item) => item.id);
  return firstHop.some((neighborId) => (mapById.get(neighborId)?.nearestNeighbors || []).some((item) => item.id === id)) ? 2 : 3;
}

function graphNodeIds(visibleRecords, mapById) {
  const visibleIds = new Set(visibleRecords.map((record) => record.id));
  if (state.mapMode !== "focused") return visibleIds;
  return focusedGraphIds(visibleIds, mapById);
}

function focusedLayoutContext(ids, mapById, selectedId = state.selectedId, firstHopLimit = 10) {
  const selected = mapById.get(selectedId);
  const firstHop = (selected?.nearestNeighbors || [])
    .filter((item) => ids.has(item.id))
    .slice(0, firstHopLimit);
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
      if (!ids.has(secondHop.id) || secondHop.id === selectedId || firstHopIndex.has(secondHop.id)) return;
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

function focusedGraphPosition(id, record, context, selectedId = state.selectedId) {
  if (id === selectedId) return { x: 0, y: 0 };
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
    const anchorPosition = focusedGraphPosition(secondAnchor.anchorId, record, context, selectedId);
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

function drawForceGraphNode(node, ctx, globalScale, options = {}) {
  const mode = options.mode || state.mapMode;
  const selectedId = options.selectedId || state.selectedId;
  const hoverId = options.hoverId ?? state.mapHoverId;
  const color = colorForValue(node.group);
  const isSelected = node.id === selectedId || node.selected;
  const isHover = node.id === hoverId;
  const isAdjacent = node.adjacent;
  const isEmphasized = isSelected || isHover || isAdjacent;
  // Particles, not stickers (spec 7.2 / 14.1): smaller default radius, no
  // always-on outline. Emphasis is carried by size + halo + ring, applied only
  // to hovered/selected/adjacent nodes so the 13k-node overview stays legible.
  const radius = isSelected ? 7.4 : isHover ? 6.2 : isAdjacent ? 4.6 : node.depth === 2 ? 3.4 : 2.8;
  if (isSelected || isHover) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + (isSelected ? 8 : 5), 0, 2 * Math.PI);
    ctx.fillStyle = isSelected ? "rgba(96,165,250,0.14)" : "rgba(255,255,255,0.10)";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.globalAlpha = isEmphasized ? 0.98 : mode === "focused" ? 0.72 : 0.76;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Domain ring (the secondary "ring = domain" encoding) is detail, not
  // overview: show it for emphasized nodes always, and for the whole field only
  // once the user has zoomed in past the haze threshold.
  // Default overview zoom sits near 0.16, so the threshold must be low enough to
  // reach by ordinary scrolling. Below it the field stays clean particles;
  // above it the "ring = domain" encoding the legend advertises comes in.
  const showDomainRing = (options.showDomainRing ?? state.mapColor === "area-domain")
    && node.record
    && (isEmphasized || globalScale > 0.55);
  if (showDomainRing) {
    ctx.lineWidth = isSelected ? 2.8 : isHover ? 2.4 : isAdjacent ? 1.6 : 1.1;
    ctx.strokeStyle = domainRingColor(node.record);
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + (isSelected ? 2.2 : 1.4), 0, 2 * Math.PI);
    ctx.stroke();
  }
  // Light outline only on emphasized nodes; default particles carry no stroke.
  if (isEmphasized) {
    ctx.lineWidth = isSelected ? 1.5 : 0.7;
    ctx.strokeStyle = isSelected ? "#bfdbfe" : "rgba(255,255,255,0.46)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
  }
  const shouldLabel = isHover
    && options.showCanvasHoverLabel
    || (isSelected && !options.hideSelectedLabel)
    || (mode === "focused" && node.depth === 1 && node.focusRank < (options.neighborLabelCount ?? 1) && globalScale > (options.labelScaleThreshold ?? 0.78));
  if (!shouldLabel) return;
  const maxLabelLength = options.maxLabelLength || (mode === "focused" ? 28 : 58);
  const label = node.title.length > maxLabelLength ? `${node.title.slice(0, maxLabelLength - 3)}...` : node.title;
  const fontSize = Math.min(options.maxFontSize || 13, Math.max(options.minFontSize || 9, (options.baseFontSize || 11) / globalScale));
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const labelOnLeft = mode === "focused" && node.x > 0;
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
    ${state.mapColor === "area-domain" ? `<div class="legend-note">Fill = research area. Ring = domain. Click an area to filter.</div>` : ""}
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

function mapCanvasPoint(event) {
  const rect = els.mapCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function mapCanvasCenter() {
  return {
    x: (els.mapCanvas.clientWidth || 840) / 2,
    y: (els.mapCanvas.clientHeight || 640) / 2,
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

function pointInActiveSelection(point) {
  if (!state.mapSelection.active || !state.mapSelection.start || !state.mapSelection.end) return false;
  const box = normalizedBox(state.mapSelection.start, state.mapSelection.end);
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
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

// Forgiving hover: find the node closest to the pointer within maxDist screen
// pixels. Exact-hit detection breaks down at high zoom because nodes spread far
// apart and the pointer usually lands in the empty space between them, so the
// tooltip never appears. Snapping to the nearest node keeps hover useful at any
// zoom. The graph->screen mapping is linear, so derive it from three reference
// points once and apply it to every node with plain arithmetic (cheap enough to
// run per pointer frame even at ~13k nodes).
function nearestNodeAtScreen(point, maxDist = 24) {
  const graph = state.mapGraph;
  const nodes = state.mapGraphData?.nodes;
  if (!graph || typeof graph.graph2ScreenCoords !== "function" || !nodes?.length) return null;
  const origin = graph.graph2ScreenCoords(0, 0);
  const unitX = graph.graph2ScreenCoords(1, 0);
  const unitY = graph.graph2ScreenCoords(0, 1);
  const axx = unitX.x - origin.x;
  const axy = unitX.y - origin.y;
  const ayx = unitY.x - origin.x;
  const ayy = unitY.y - origin.y;
  let best = null;
  let bestDistSq = maxDist * maxDist;
  for (const node of nodes) {
    const nx = Number(node.x) || 0;
    const ny = Number(node.y) || 0;
    const sx = origin.x + axx * nx + ayx * ny;
    const sy = origin.y + axy * nx + ayy * ny;
    const dx = sx - point.x;
    const dy = sy - point.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = node;
    }
  }
  return best;
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

function ensureGraphTooltip(container) {
  let tooltip = container.querySelector(":scope > .graph-node-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "graph-node-tooltip";
    tooltip.hidden = true;
    container.appendChild(tooltip);
  }
  return tooltip;
}

function showGraphTooltip(container, node, point) {
  if (!container || !node?.title || !point) return;
  const tooltip = ensureGraphTooltip(container);
  if (tooltip._hideTimer) {
    window.clearTimeout(tooltip._hideTimer);
    tooltip._hideTimer = null;
  }
  const rect = container.getBoundingClientRect();
  tooltip.innerHTML = graphTooltipHTML(node);
  // Anchor and clamp to the container bounds. The CSS centers the tooltip on the
  // node (translateX(-50%)); without clamping, a node near the left/right edge
  // pushes the tooltip off-canvas and its leading characters get cut off. Drive
  // position from measured size instead and keep the box fully inside the canvas.
  tooltip.style.transform = "none";
  tooltip.hidden = false;
  const pad = 8;
  const gap = 12;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const anchorX = rect.left + point.x;
  const anchorY = rect.top + point.y;
  let left = anchorX - width / 2;
  left = Math.max(rect.left + pad, Math.min(left, rect.right - width - pad));
  let top = anchorY - height - gap;
  if (top < rect.top + pad) top = anchorY + gap + 4; // flip below when no room above
  top = Math.max(rect.top + pad, Math.min(top, rect.bottom - height - pad));
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function hideGraphTooltip(container, delay = 0) {
  const tooltip = container?.querySelector(":scope > .graph-node-tooltip");
  if (!tooltip) return;
  if (tooltip._hideTimer) window.clearTimeout(tooltip._hideTimer);
  if (delay > 0) {
    tooltip._hideTimer = window.setTimeout(() => {
      tooltip.hidden = true;
      tooltip._hideTimer = null;
    }, delay);
  } else {
    tooltip.hidden = true;
    tooltip._hideTimer = null;
  }
}

function graphClickSuppressed() {
  return performance.now() < state.mapInteraction.suppressClickUntil;
}

function selectMapNode(node, event) {
  if (!node?.record) return;
  state.selectedId = node.id;
  refreshForceSelectionState();
  renderMapDetail(node.record);
  renderViewer(node.record);
  forceGraphZoomAt(mapCanvasPoint(event), event?.shiftKey ? 0.72 : 1.34);
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

function isTextEntryTarget(target) {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName) || target?.isContentEditable;
}

function installMapPointerInteractions() {
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || isTextEntryTarget(event.target)) return;
    if (state.tab !== "map" || state.mapEngine !== "force") return;
    event.preventDefault();
    state.mapInteraction.spaceDown = true;
    els.mapCanvas.classList.add("is-space-ready");
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "Space") return;
    if (state.tab === "map" && state.mapEngine === "force" && !isTextEntryTarget(event.target)) {
      event.preventDefault();
    }
    state.mapInteraction.spaceDown = false;
    els.mapCanvas.classList.remove("is-space-ready", "is-panning");
  });

  els.mapCanvas.addEventListener("pointerdown", (event) => {
    if (state.tab === "map" && state.mapEngine === "force" && event.button === 1 && state.mapGraph) {
      event.preventDefault();
      fitForceGraph(state.mapGraph, state.mapGraphData, { duration: 280, padding: state.mapMode === "focused" ? 84 : 160 });
      state.mapGraph.resumeAnimation?.();
      return;
    }
    if (state.tab !== "map" || state.mapEngine !== "force" || event.button !== 0 || !state.mapGraph) return;
    const point = mapCanvasPoint(event);
    const interaction = state.mapInteraction;
    interaction.pointerId = event.pointerId;
    interaction.mode = interaction.spaceDown ? "pan" : pointInActiveSelection(point) ? "selection-click" : "box";
    interaction.moved = false;
    interaction.start = point;
    interaction.last = point;
    interaction.center = typeof state.mapGraph.screen2GraphCoords === "function"
      ? state.mapGraph.screen2GraphCoords(mapCanvasCenter().x, mapCanvasCenter().y)
      : { x: 0, y: 0 };
    els.mapCanvas.setPointerCapture?.(event.pointerId);
    if (interaction.mode === "pan") {
      els.mapCanvas.classList.add("is-panning");
      clearMapSelection();
    } else if (interaction.mode === "box") {
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
    } else if (interaction.mode === "box") {
      updateMapSelectionBox(interaction.start, point);
    }
    interaction.last = point;
    event.preventDefault();
  });

  // Nearest-node hover (separate from the drag handler above). Owns the tooltip
  // and hover highlight for the ForceGraph engine; throttled to one update per
  // animation frame so a fast pointer can't flood refresh() at 13k nodes.
  let hoverFrame = 0;
  els.mapCanvas.addEventListener("pointermove", (event) => {
    if (state.tab !== "map" || state.mapEngine !== "force" || !state.mapGraph) return;
    const interaction = state.mapInteraction;
    if (interaction.mode === "box" || interaction.mode === "pan" || interaction.spaceDown) {
      hideGraphTooltip(els.mapCanvas, 0);
      return;
    }
    const point = mapCanvasPoint(event);
    if (hoverFrame) return;
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = 0;
      if (state.mapInteraction.mode) return;
      const node = nearestNodeAtScreen(point, 24);
      const id = node?.id || "";
      if (id !== state.mapHoverId) {
        state.mapHoverId = id;
        state.mapGraph?.refresh?.();
      }
      els.mapCanvas.style.cursor = node ? "pointer" : "crosshair";
      if (node && typeof state.mapGraph?.graph2ScreenCoords === "function") {
        showGraphTooltip(els.mapCanvas, node, state.mapGraph.graph2ScreenCoords(node.x || 0, node.y || 0));
      } else {
        hideGraphTooltip(els.mapCanvas, 120);
      }
    });
  }, { passive: true });

  els.mapCanvas.addEventListener("pointerleave", () => {
    if (state.mapHoverId) {
      state.mapHoverId = "";
      state.mapGraph?.refresh?.();
    }
    hideGraphTooltip(els.mapCanvas, 0);
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
    if (mode === "selection-click" && !moved) {
      interaction.suppressClickUntil = performance.now() + 300;
      zoomToMapSelection();
      event.preventDefault();
      return;
    }
    if (mode === "box") {
      hideMapSelectionBox();
      // Decide click vs box by one consistent distance threshold, NOT the
      // `moved` flag: `moved` flips at 4px while a box needs 10px, so a 5-10px
      // hand jitter previously fell between both branches and left a stale,
      // invisible selection active. A drag >10px makes a box; anything smaller
      // is a click/jitter that must dismiss any active box, then select or zoom.
      const dragDistance = Math.hypot(end.x - start.x, end.y - start.y);
      if (dragDistance > 10) {
        interaction.suppressClickUntil = performance.now() + 300;
        setMapSelection(start, end);
      } else {
        // Plain click (or jitter). This handler captures the pointer and
        // preventDefaults, so ForceGraph's onNodeClick never fires — do the
        // selection here. Snap to the nearest node (forgiving at any zoom);
        // empty space falls back to zoom in / shift+zoom out.
        const hadSelection = state.mapSelection.active;
        if (hadSelection) clearMapSelection();
        const node = nearestNodeAtScreen(end, 24);
        if (node?.record && !event.shiftKey) {
          selectMapNode(node, event);
        } else {
          if (hadSelection) {
            const selected = state.data.records.find((record) => record.id === state.selectedId && record.mapAvailable);
            renderMapDetail(selected || null);
          }
          forceGraphZoomAt(end, event.shiftKey ? 0.72 : 1.34);
        }
      }
    }
    event.preventDefault();
  });

  els.mapCanvas.addEventListener("pointercancel", () => {
    state.mapInteraction.pointerId = null;
    state.mapInteraction.mode = "";
    els.mapCanvas.classList.remove("is-panning");
    clearMapSelection();
  });

  els.mapCanvas.addEventListener("wheel", (event) => {
    if (state.tab !== "map" || state.mapEngine !== "force" || !state.mapGraph) return;
    event.preventDefault();
    const multiplier = event.deltaY > 0 ? 0.86 : 1.16;
    forceGraphZoomAt(mapCanvasPoint(event), multiplier, 70);
  }, { passive: false });

  els.mapCanvas.addEventListener("auxclick", (event) => {
    if (state.tab !== "map" || event.button !== 1) return;
    event.preventDefault();
    if (state.mapEngine === "force" && state.mapGraph) {
      fitForceGraph(state.mapGraph, state.mapGraphData, { duration: 280, padding: state.mapMode === "focused" ? 84 : 160 });
      state.mapGraph.resumeAnimation?.();
    } else if (state.mapEngine === "cytoscape" && state.cyGraph) {
      state.cyGraph.fit(undefined, 48);
    }
  });
}

function ensureForceGraph() {
  if (state.mapGraph || typeof window.ForceGraph !== "function") return state.mapGraph;
  els.mapCanvas.innerHTML = "";
  state.mapGraph = window.ForceGraph()(els.mapCanvas)
    .backgroundColor("rgba(0,0,0,0)")
    .nodeId("id")
    .nodeLabel("")
    .nodeVal((node) => node.selected ? 5.5 : node.depth === 1 ? 3.6 : node.depth === 2 ? 2.3 : node.type === "workshop" ? 1.9 : 1.5)
    .nodePointerAreaPaint((node, color, ctx, globalScale) => {
      // Hit area is painted in graph coordinates, so at the default overview
      // zoom (~0.16) a fixed graph-radius shrinks to ~1px on screen and hover
      // almost never lands. Keep a constant minimum screen-space target (~9px)
      // by inflating the radius inversely with zoom, so the title tooltip
      // reliably appears when the pointer is over any node at any zoom.
      const base = node.selected ? 13 : node.depth === 1 ? 10 : 8;
      const minScreenRadius = (node.selected ? 11 : 9) / Math.max(globalScale || 1, 0.0001);
      const radius = Math.max(base, minScreenRadius);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fill();
    })
    .enableZoomInteraction(false)
    .enablePanInteraction(false)
    .enableNodeDrag(false)
    .linkCurvature(0.06)
    .linkWidth((link) => link.selected ? 1.1 : Math.max(0.16, Number(link.value || 0) * (state.mapMode === "focused" ? 0.95 : 0.7)))
    .linkColor((link) => link.selected ? "rgba(186,230,253,0.55)" : state.mapMode === "focused" ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.045)")
    .linkDirectionalParticles((link) => link.selected && state.mapLive ? 1 : 0)
    .linkDirectionalParticleWidth(1)
    .linkDirectionalParticleSpeed(0.004)
    .d3AlphaMin(0.0006)
    .d3AlphaDecay(0.01)
    .d3VelocityDecay(0.38)
    // Hover/tooltip AND click selection are both driven by the custom pointer
    // handlers in installMapPointerInteractions: that handler captures the
    // pointer and preventDefaults, so ForceGraph's synthetic hover/click events
    // never fire reliably. Leaving these as no-ops keeps the two paths from
    // fighting over the tooltip and double-handling clicks.
    .nodeCanvasObject((node, ctx, globalScale) => {
      drawForceGraphNode(node, ctx, globalScale);
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
  hideGraphTooltip(els.mapCanvas);
  if (except !== "force" && state.mapGraph) {
    state.mapGraph.pauseAnimation?.();
    state.mapGraph = null;
    state.mapGraphData = null;
  }
  if (except !== "cytoscape" && state.cyGraph) {
    state.cyGraph.destroy?.();
    state.cyGraph = null;
  }
  if (except !== "force" && except !== "cytoscape") {
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

function loadScriptOnce(src) {
  if (scriptPromises.has(src)) return scriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((item) => item.src === src);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing || document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.dynamic = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    if (!existing) document.head.append(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

async function ensureCytoscapeLibrary() {
  await loadScriptOnce(CYTOSCAPE_URL);
}

function renderCytoscapeGraph(graphData) {
  if (typeof window.cytoscape !== "function") return false;
  state.mapGraph?.pauseAnimation?.();
  state.mapGraph = null;
  state.cyGraph?.destroy?.();
  state.cyGraph = null;
  els.mapCanvas.innerHTML = "";
  const elements = [
    ...graphData.nodes.map((node) => ({
      data: {
        id: node.id,
        label: state.mapMode === "focused" && node.selected ? plainMathTitle(node.title).slice(0, 26) : "",
        fullTitle: node.title,
        area: areaColorValue(node.record),
        domain: domainColorValue(node.record),
        typeLabel: typeLabel(node.record?.type),
        color: colorForValue(node.group),
        ringColor: state.mapColor === "area-domain" ? domainRingColor(node.record) : "rgba(255,255,255,0.52)",
        size: node.selected ? 18 : node.depth === 1 ? 12 : node.depth === 2 ? 8 : 5,
        record: node.record,
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
      { selector: "node", style: { "background-color": "data(color)", width: "data(size)", height: "data(size)", "border-color": "data(ringColor)", "border-width": state.mapColor === "area-domain" ? 2 : 1, label: "data(label)", color: "#e5e7eb", "font-size": 10, "text-outline-color": "#111827", "text-outline-width": 3 } },
      { selector: "node.selected", style: { width: 22, height: 22, "border-color": "data(ringColor)", "border-width": state.mapColor === "area-domain" ? 4 : 3, "underlay-color": "#60a5fa", "underlay-opacity": 0.25, "underlay-padding": 8 } },
      { selector: "edge", style: { width: 0.28, "line-color": "#263244", opacity: 0.55, "curve-style": "haystack", "haystack-radius": 0 } },
      { selector: "edge.selected", style: { width: 0.9, "line-color": "#5f8fd3", opacity: 0.78 } },
    ],
  });
  state.cyGraph.on("mouseover", "node", (event) => {
    const data = event.target.data();
    showGraphTooltip(els.mapCanvas, {
      title: data.fullTitle,
      record: data.record,
    }, event.renderedPosition);
    els.mapCanvas.style.cursor = "pointer";
  });
  state.cyGraph.on("mouseout", "node", () => {
    hideGraphTooltip(els.mapCanvas, 700);
    els.mapCanvas.style.cursor = "";
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
        fitForceGraph(graph, graphData, { duration: 420, padding: 160 });
      }
    }, 450);
    window.setTimeout(() => {
      if (state.tab === "map" && state.mapMode === "global" && state.mapGraph === graph) {
        fitForceGraph(graph, graphData, { duration: 360, padding: 170 });
      }
    }, 1100);
  }
  reflowMap();
  return true;
}

function renderMapDetail(record) {
  if (!record) {
    els.mapDetail.innerHTML = `<div class="empty-state compact"><strong>Select a paper from the map</strong><span>Hover to preview, click to inspect metadata and similar records.</span></div>`;
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
  els.activeSummary.textContent = activeFilterSummary("Map", [
    state.mapMode,
    state.mapColor === "area-domain" ? "area + domain" : state.mapColor,
    state.mapFilterValue,
  ]);
  if (!visibleRecords.length) {
    destroyGraphEngine();
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No mapped records</strong><span>Adjust the filters.</span></div>`;
    renderMapDetail(null);
    return;
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
    renderMapDetail(visibleRecords[0]);
    return;
  }
  // Honor the empty state (spec 5.2): only populate the detail panel when the
  // user has actually selected a record. Do not auto-open a random first record.
  const selected = state.data.records.find((record) => record.id === state.selectedId && record.mapAvailable);
  renderMapDetail(selected || null);
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
  if ((record.bestAssetKind === "pdf" || record.bestAssetKind === "slide") && isPdfAsset(path)) return "";
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

function isPdfAsset(path) {
  return /\.pdf(?:$|[?#])/i.test(path || "");
}

function destroyPdfViewer() {
  state.pdfViewer.token += 1;
  state.pdfViewer.renderTask?.cancel?.();
  state.pdfViewer.loadingTask?.destroy?.();
  state.pdfViewer.renderTask = null;
  state.pdfViewer.loadingTask = null;
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_MODULE_URL).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjsLib;
    });
  }
  return pdfJsPromise;
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
  const canPreview = isPdfAsset(assetPath);
  const preview = canPreview
    ? `
      <div class="pdfjs-shell" data-pdf-src="${escapeHtml(url)}">
        <div class="pdfjs-toolbar" aria-label="PDF controls">
          <button type="button" class="icon-button" data-pdf-prev title="Previous page" aria-label="Previous page">‹</button>
          <span class="pdfjs-status" data-pdf-status>Loading PDF</span>
          <button type="button" class="icon-button" data-pdf-next title="Next page" aria-label="Next page">›</button>
          <button type="button" class="icon-button" data-pdf-zoom-out title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" class="icon-button" data-pdf-zoom-in title="Zoom in" aria-label="Zoom in">+</button>
          <a class="action" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in new tab</a>
        </div>
        <div class="pdfjs-stage">
          <canvas data-pdf-canvas aria-label="${escapeHtml(record.title)} PDF preview"></canvas>
        </div>
        <div class="source-page-open pdfjs-error" data-pdf-error hidden>
          <strong>Preview unavailable</strong>
          <span>The local PDF could not be rendered in this browser.</span>
          <a class="action primary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open in new tab</a>
        </div>
      </div>
    `
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

function setPdfToolbarState(shell, pageNum, pageCount, isBusy = false) {
  const status = shell.querySelector("[data-pdf-status]");
  const prev = shell.querySelector("[data-pdf-prev]");
  const next = shell.querySelector("[data-pdf-next]");
  if (status) status.textContent = pageCount ? `${pageNum} / ${pageCount}` : "Loading PDF";
  if (prev) prev.disabled = isBusy || pageNum <= 1;
  if (next) next.disabled = isBusy || pageNum >= pageCount;
}

function showPdfError(shell) {
  shell.classList.add("has-error");
  shell.querySelector("[data-pdf-error]")?.removeAttribute("hidden");
  shell.querySelector(".pdfjs-stage")?.setAttribute("hidden", "");
  shell.querySelector("[data-pdf-status]").textContent = "Preview unavailable";
}

function uniqueChipValues(values) {
  const seen = new Set();
  return values.filter(Boolean).filter((value) => {
    const key = String(value).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function mountPdfViewer(assetPath) {
  const shell = els.viewerFrame.querySelector(".pdfjs-shell");
  const canvas = shell?.querySelector("[data-pdf-canvas]");
  const stage = shell?.querySelector(".pdfjs-stage");
  if (!shell || !canvas || !stage || !isPdfAsset(assetPath)) return;

  const token = state.pdfViewer.token;
  const source = shell.dataset.pdfSrc;
  const context = canvas.getContext("2d");
  let pdfDoc = null;
  let pageNum = 1;
  let zoom = 1;
  let rendering = false;
  let pending = false;

  const renderPage = async () => {
    if (!pdfDoc || token !== state.pdfViewer.token) return;
    if (rendering) {
      pending = true;
      return;
    }
    rendering = true;
    pending = false;
    setPdfToolbarState(shell, pageNum, pdfDoc.numPages, true);
    state.pdfViewer.renderTask?.cancel?.();
    try {
      const page = await pdfDoc.getPage(pageNum);
      if (token !== state.pdfViewer.token) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const stageWidth = Math.max(320, stage.clientWidth - 32);
      const fitScale = Math.max(0.42, Math.min(1.8, stageWidth / baseViewport.width));
      const viewport = page.getViewport({ scale: fitScale * zoom });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const renderTask = page.render({ canvasContext: context, viewport });
      state.pdfViewer.renderTask = renderTask;
      await renderTask.promise;
      setPdfToolbarState(shell, pageNum, pdfDoc.numPages, false);
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") {
        console.error("PDF preview failed", error);
        showPdfError(shell);
      }
    } finally {
      rendering = false;
      if (pending) void renderPage();
    }
  };

  try {
    const pdfjsLib = await loadPdfJs();
    if (token !== state.pdfViewer.token) return;
    const loadingTask = pdfjsLib.getDocument({ url: source, withCredentials: false });
    state.pdfViewer.loadingTask = loadingTask;
    pdfDoc = await loadingTask.promise;
    if (token !== state.pdfViewer.token) return;
    setPdfToolbarState(shell, pageNum, pdfDoc.numPages, false);
    shell.querySelector("[data-pdf-prev]")?.addEventListener("click", () => {
      if (pageNum <= 1) return;
      pageNum -= 1;
      void renderPage();
    });
    shell.querySelector("[data-pdf-next]")?.addEventListener("click", () => {
      if (pageNum >= pdfDoc.numPages) return;
      pageNum += 1;
      void renderPage();
    });
    shell.querySelector("[data-pdf-zoom-out]")?.addEventListener("click", () => {
      zoom = Math.max(0.65, zoom - 0.15);
      void renderPage();
    });
    shell.querySelector("[data-pdf-zoom-in]")?.addEventListener("click", () => {
      zoom = Math.min(2.4, zoom + 0.15);
      void renderPage();
    });
    void renderPage();
  } catch (error) {
    if (token !== state.pdfViewer.token || /Worker was destroyed/i.test(error?.message || "")) return;
    console.error("PDF.js load failed", error);
    showPdfError(shell);
  }
}

function renderPosterPreview(record, assetPath) {
  return `
    <div class="poster-preview" id="posterPreview">
      <button class="poster-zoom-toggle" type="button" aria-pressed="false" title="Click poster to enlarge. Click again to return.">
        <img src="${escapeHtml(assetUrl(assetPath))}" alt="${escapeHtml(record.title)} poster" />
      </button>
    </div>
  `;
}

function semanticNeighborhood(record) {
  if (!record?.mapAvailable || !state.mapData?.records?.length) return "";
  const mapById = mapRecordById();
  const center = mapById.get(record.id);
  if (!center) return null;
  const centerAreas = new Set(record.areaTags || []);
  const neighbors = (center.nearestNeighbors || []).slice(0, 8)
    .map((neighbor, index) => ({
      record: state.data.records.find((item) => item.id === neighbor.id),
      score: neighbor.score,
      rank: index + 1,
    }))
    .filter((item) => item.record && mapById.has(item.record.id));
  if (!neighbors.length) return null;
  const ids = new Set([record.id, ...neighbors.map((item) => item.record.id)]);
  const context = focusedLayoutContext(ids, mapById, record.id, 8);
  const selectedNeighbors = selectedNeighborIds(mapById, record.id, 8);
  const recordsById = new Map([record, ...neighbors.map((item) => item.record)].map((item) => [item.id, item]));
  const nodes = [...ids].map((id) => {
    const item = recordsById.get(id);
    const position = focusedGraphPosition(id, item, context, record.id);
    return {
      id,
      record: item,
      title: plainMathTitle(item?.title || ""),
      group: mapColorValue(item || {}),
      selected: id === record.id,
      adjacent: selectedNeighbors.has(id),
      depth: focusDepth(id, selectedNeighbors, mapById, record.id),
      type: item?.type || "record",
      focusRank: context.firstHopIndex.get(id) ?? 99,
      seedX: position.x,
      seedY: position.y,
      x: position.x,
      y: position.y,
    };
  }).filter((node) => node.record);
  const links = [];
  const seen = new Set();
  for (const node of nodes) {
    const map = mapById.get(node.id);
    for (const neighbor of (map?.nearestNeighbors || []).slice(0, 5)) {
      if (!ids.has(neighbor.id)) continue;
      const key = [node.id, neighbor.id].sort().join("::");
      if (seen.has(key) || node.id === neighbor.id) continue;
      seen.add(key);
      links.push({
        source: node.id,
        target: neighbor.id,
        value: Number(neighbor.score || 0),
        selected: node.id === record.id || neighbor.id === record.id,
        depth: node.id === record.id || neighbor.id === record.id ? 1 : 2,
      });
    }
  }
  const scores = neighbors.map((item) => Number(item.score || 0));
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const scoreRange = Math.max(0.001, maxScore - minScore);
  const similarityPercent = (score) => Math.max(0.08, Math.min(1, (Number(score || 0) - minScore) / scoreRange));
  const sharedTags = (neighborRecord) => (neighborRecord.areaTags || []).filter((tag) => centerAreas.has(tag));
  const topTags = countLabels(neighbors.map((item) => item.record.areaTags || [])).slice(0, 4);
  return { neighbors, topTags, maxScore, similarityPercent, sharedTags, graphData: { nodes, links } };
}

function destroyMiniGraph() {
  state.miniGraph?.pauseAnimation?.();
  state.miniGraph = null;
  hideGraphTooltip(els.viewerFrame.querySelector(".mini-graph"));
}

function fitGraphToElement(graph, graphData, element, options = {}) {
  if (!graph || !graphData?.nodes?.length || !element) return;
  const bounds = graphData.nodes.reduce((box, node) => ({
    minX: Math.min(box.minX, Number(node.x) || 0),
    maxX: Math.max(box.maxX, Number(node.x) || 0),
    minY: Math.min(box.minY, Number(node.y) || 0),
    maxY: Math.max(box.maxY, Number(node.y) || 0),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
  const width = element.clientWidth || 720;
  const height = element.clientHeight || 240;
  const padding = options.padding ?? 48;
  const spanX = Math.max(60, bounds.maxX - bounds.minX);
  const spanY = Math.max(60, bounds.maxY - bounds.minY);
  const zoom = Math.max(0.24, Math.min(options.maxZoom ?? 2.6, Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)));
  graph.centerAt?.((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, options.duration ?? 260);
  graph.zoom?.(zoom, options.duration ?? 260);
}

function mountMiniGraph(graphData, selectedId) {
  destroyMiniGraph();
  const container = els.viewerFrame.querySelector(".mini-graph");
  if (!container || typeof window.ForceGraph !== "function") return;
  let miniHoverId = "";
  state.miniGraph = window.ForceGraph()(container)
    .backgroundColor("#111827")
    .nodeId("id")
    .nodeLabel("")
    .nodeVal((node) => node.selected ? 5.5 : node.depth === 1 ? 3.6 : 2.3)
    .nodePointerAreaPaint((node, color, ctx) => {
      const radius = node.selected ? 18 : 14;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fill();
    })
    .enableZoomInteraction(false)
    .enablePanInteraction(false)
    .enableNodeDrag(false)
    .linkCurvature(0.06)
    .linkWidth((link) => link.selected ? 1.25 : Math.max(0.18, Number(link.value || 0) * 1.1))
    .linkColor((link) => link.selected ? "rgba(148,196,255,0.48)" : "rgba(148,163,184,0.13)")
    .linkDirectionalParticles(0)
    .d3AlphaMin(0.001)
    .d3AlphaDecay(0.018)
    .d3VelocityDecay(0.42)
    .nodeCanvasObject((node, ctx, globalScale) => {
      drawForceGraphNode(node, ctx, globalScale, {
        mode: "focused",
        selectedId,
        hoverId: miniHoverId,
        hideSelectedLabel: true,
        neighborLabelCount: 0,
        labelScaleThreshold: 0.35,
        maxLabelLength: 42,
        baseFontSize: 10,
        maxFontSize: 12,
        showDomainRing: true,
      });
    })
    .onNodeHover((node) => {
      miniHoverId = node?.id || "";
      container.style.cursor = node ? "pointer" : "";
      if (node && typeof state.miniGraph?.graph2ScreenCoords === "function") {
        showGraphTooltip(container, node, state.miniGraph.graph2ScreenCoords(node.x || 0, node.y || 0));
      } else {
        hideGraphTooltip(container, 700);
      }
      state.miniGraph?.refresh?.();
    })
    .onNodeClick((node) => {
      if (!node?.record) return;
      state.selectedId = node.id;
      renderResults();
      renderMap();
      renderViewer(node.record);
    })
    .width(container.clientWidth || 720)
    .height(container.clientHeight || 240)
    .graphData(graphData);
  state.miniGraph.d3Force("charge")?.strength((node) => node.selected ? -128 : -54);
  state.miniGraph.d3Force("link")?.distance((link) => link.selected ? 56 : 66);
  applyForceAnchors(state.miniGraph, 0.05);
  state.miniGraph.cooldownTime?.(3200);
  state.miniGraph.resumeAnimation?.();
  window.setTimeout(() => fitGraphToElement(state.miniGraph, graphData, container, { padding: 42, maxZoom: 2.8 }), 80);
  window.setTimeout(() => fitGraphToElement(state.miniGraph, graphData, container, { padding: 44, maxZoom: 2.8, duration: 220 }), 700);
}

function renderMiniMap(record) {
  const neighborhood = semanticNeighborhood(record);
  if (!neighborhood) return "";
  const { neighbors, topTags, maxScore, similarityPercent, sharedTags } = neighborhood;
  return `
    <section class="mini-map-panel" data-mini-graph-record="${escapeHtml(record.id)}">
      <div class="mini-map-heading">
        <h3>Semantic neighborhood</h3>
        <span>${neighbors.length} nearest mapped records</span>
      </div>
      <div class="mini-graph" aria-label="Semantic neighborhood graph using the same ForceGraph renderer as the main map">
        <div class="mini-graph-caption">
          <strong>${Number(maxScore || 0).toFixed(2)}</strong>
          <span>top similarity</span>
        </div>
      </div>
      <div class="mini-selected-title">${escapeHtml(plainMathTitle(record.title))}</div>
      <div class="mini-tag-summary">
        ${topTags.map(([tag, count]) => `<span><i style="background:${colorForValue(tag)}"></i>${escapeHtml(tag)} <b>${count}</b></span>`).join("")}
      </div>
      <div class="neighbor-list">
        ${neighbors.map((item) => {
          const strength = similarityPercent(item.score);
          const tags = sharedTags(item.record).slice(0, 3);
          return `
            <button type="button" class="neighbor-item semantic-neighbor" data-id="${escapeHtml(item.record.id)}">
              <span class="neighbor-rank">${item.rank}</span>
              <span class="neighbor-main">
                <strong>${escapeHtml(plainMathTitle(item.record.title))}</strong>
                <span>${Number(item.score || 0).toFixed(2)} similarity${tags.length ? ` · shared ${tags.map(escapeHtml).join(", ")}` : ""}</span>
                <i class="neighbor-score-bar"><b style="width:${Math.round(strength * 100)}%"></b></i>
              </span>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderViewer(record) {
  destroyMiniGraph();
  destroyPdfViewer();
  els.viewerFrame.scrollTop = 0;
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
  els.viewerMeta.innerHTML = uniqueChipValues([
    ...(record.presentationLabels || []),
    record.decision,
    paperPresentationKind(record),
    record.session,
    record.roomName,
    record.group,
    record.authors,
    record.availabilityLabel,
    statusLabel(record.status),
    record.failureReason,
  ])
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
    els.viewerFrame.innerHTML = renderPosterPreview(record, preferred);
  } else if (preferred && (record.bestAssetKind === "pdf" || record.bestAssetKind === "slide")) {
    els.viewerFrame.innerHTML = renderAssetOpenFallback(record, preferred);
    void mountPdfViewer(preferred);
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
  els.viewerFrame.querySelector(".poster-zoom-toggle")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const preview = button.closest(".poster-preview");
    const zoomed = !preview.classList.contains("is-zoomed");
    preview.classList.toggle("is-zoomed", zoomed);
    button.setAttribute("aria-pressed", String(zoomed));
    if (!zoomed) preview.scrollIntoView({ block: "start" });
  });
  const miniMap = renderMiniMap(record);
  if (miniMap) {
    els.viewerFrame.insertAdjacentHTML("beforeend", miniMap);
    const neighborhood = semanticNeighborhood(record);
    if (neighborhood) mountMiniGraph(neighborhood.graphData, record.id);
    els.viewerFrame.querySelectorAll(".neighbor-item").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = state.data.records.find((item) => item.id === button.dataset.id);
        state.selectedId = button.dataset.id;
        renderResults();
        renderMap();
        renderViewer(selected);
      });
    });
  }
  els.viewerFrame.scrollTop = 0;
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

function installMapDebugProbe() {
  if (!new URLSearchParams(window.location.search).has("verify")) return;
  window.__icmlMapDebug = {
    forceZoom() {
      return state.mapGraph?.zoom?.() || null;
    },
    forceProbePoints(limit = 80) {
      if (!state.mapGraph || typeof state.mapGraph.graph2ScreenCoords !== "function") return [];
      return (state.mapGraphData?.nodes || []).slice(0, limit).map((node) => {
        const point = state.mapGraph.graph2ScreenCoords(node.x || 0, node.y || 0);
        return {
          x: point.x,
          y: point.y,
          title: node.title,
        };
      });
    },
    cytoscapeZoom() {
      return state.cyGraph?.zoom?.() || null;
    },
    cytoscapeProbePoints(limit = 80) {
      if (!state.cyGraph) return [];
      return state.cyGraph.nodes().slice(0, limit).map((node) => {
        const point = node.renderedPosition();
        return {
          x: point.x,
          y: point.y,
          title: node.data("fullTitle") || "",
        };
      });
    },
  };
}

async function init() {
  installMapDebugProbe();
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
      const nextTab = button.dataset.tab;
      const tabChanged = nextTab !== state.tab;
      state.tab = nextTab;
      if (tabChanged) {
        state.query = "";
        els.search.value = "";
      }
      state.category = "all";
      state.group = "all";
      state.asset = "all";
      state.mapFilterValue = "";
      clearMapSelection();
      els.asset.value = "all";
      resetResultWindow();
      renderAll();
      window.scrollTo(0, 0);
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
