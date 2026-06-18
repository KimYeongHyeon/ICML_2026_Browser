export const DATA_URL = "site/data/icml2026_index.json";
export const MAP_URL = "site/data/icml2026_map.json";

export const AREA_COLORS = {
  "LLMs": "#7db7ff",
  "Vision": "#4dd4e8",
  "Theory": "#a78bfa",
  "Optimization": "#f59e6b",
  "Reinforcement Learning": "#62d6a3",
  "Generative Models": "#f472b6",
  "Multimodal Learning": "#38bdf8",
  "Probabilistic Methods": "#c084fc",
  "Systems": "#f97316",
  "Safety": "#ef4444",
  "Agents": "#2dd4bf",
  "Evaluation": "#c084fc",
  "Other": "#94a3b8",
};

export const DOMAIN_COLORS = {
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

export const TYPE_COLORS = {
  paper: "#60a5fa",
  poster: "#22d3ee",
  workshop: "#f59e0b",
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

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function plainMathTitle(value) {
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

export function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(id, salt = 0) {
  let hash = stableHash(`${salt}:${id}`) || 1;
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return (hash >>> 0) / 4294967295;
}

function hashColor(value) {
  const hue = stableHash(value) % 360;
  return `hsl(${hue} 72% 58%)`;
}

function firstTag(values, fallback) {
  return Array.isArray(values) && values.length ? values[0] : fallback;
}

function colorFromPalette(value, palette) {
  return palette[value] || hashColor(value);
}

function seededGraphPosition(id, record) {
  const area = firstTag(record?.areaTags, firstTag(record?.categoryTags, "Other"));
  const anchor = AREA_LAYOUT_ANCHORS[area] || AREA_LAYOUT_ANCHORS.Other;
  const spread = record?.type === "workshop" ? 92 : 138;
  return {
    x: anchor.x + (seededUnit(id, 1) - 0.5) * spread * 2 + (seededUnit(id, 3) - 0.5) * spread * 0.45,
    y: anchor.y + (seededUnit(id, 2) - 0.5) * spread * 2 + (seededUnit(id, 4) - 0.5) * spread * 0.45,
  };
}

// Match the main Map tab (app.js projectedGraphPosition): use the real semantic
// projection from icml2026_map.json when present, falling back to the seeded
// area-cloud only for records with no/zero coordinates. Without this the
// standalone Sigma/Cosmograph pages discarded the projection and rendered a
// different layout than the main tab.
function projectedGraphPosition(mapRecord, id, record) {
  const x = Number(mapRecord?.x);
  const y = Number(mapRecord?.y);
  const hasProjection = Number.isFinite(x) && Number.isFinite(y)
    && (Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9);
  if (!hasProjection) return seededGraphPosition(id, record);
  return { x: x * 1500, y: -y * 1500 };
}

function typeLabel(type) {
  return {
    paper: "Paper",
    poster: "Poster",
    workshop: "Workshop",
  }[type] || "Record";
}

function nodeColor(record, mode) {
  if (mode === "domain") return colorFromPalette(firstTag(record.domainTags, "General"), DOMAIN_COLORS);
  if (mode === "type") return TYPE_COLORS[record.type] || TYPE_COLORS.poster;
  return colorFromPalette(firstTag(record.areaTags, firstTag(record.categoryTags, "Other")), AREA_COLORS);
}

function recordMatches(record, mapById, query, areaFilter, domainFilter, typeFilter) {
  if (!record.mapAvailable || !mapById.has(record.id)) return false;
  if (areaFilter !== "all" && !(record.areaTags || record.categoryTags || []).includes(areaFilter)) return false;
  if (domainFilter !== "all" && !(record.domainTags || []).includes(domainFilter)) return false;
  if (typeFilter !== "all" && record.type !== typeFilter) return false;
  if (!query) return true;
  const haystack = [
    record.title,
    plainMathTitle(record.title),
    record.authors,
    record.group,
    ...(record.areaTags || []),
    ...(record.domainTags || []),
    record.clusterLabel,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

export async function loadGraphBundle(options = {}) {
  const [indexResponse, mapResponse] = await Promise.all([
    fetch(DATA_URL),
    fetch(MAP_URL),
  ]);
  if (!indexResponse.ok) throw new Error(`Failed to load ${DATA_URL}`);
  if (!mapResponse.ok) throw new Error(`Failed to load ${MAP_URL}`);
  const index = await indexResponse.json();
  const map = await mapResponse.json();
  return buildSemanticGraph(index, map, options);
}

export function buildSemanticGraph(index, map, options = {}) {
  const neighborLimit = options.neighborLimit ?? 3;
  const colorMode = options.colorMode || "area";
  const query = String(options.query || "").trim().toLowerCase();
  const areaFilter = options.areaFilter || "all";
  const domainFilter = options.domainFilter || "all";
  const typeFilter = options.typeFilter || "all";
  const recordsById = new Map((index.records || []).map((record) => [record.id, record]));
  const mapById = new Map((map.records || []).map((record) => [record.id, record]));
  const graphRecords = (index.records || []).filter((record) => record.mapAvailable && mapById.has(record.id));
  const matchedIds = new Set();
  const nodes = graphRecords.map((record) => {
    const isMatch = recordMatches(record, mapById, query, areaFilter, domainFilter, typeFilter);
    if (isMatch) matchedIds.add(record.id);
    const position = projectedGraphPosition(mapById.get(record.id), record.id, record);
    const area = firstTag(record.areaTags, firstTag(record.categoryTags, "Other"));
    const domain = firstTag(record.domainTags, "General");
    return {
      id: record.id,
      label: plainMathTitle(record.title),
      title: plainMathTitle(record.title),
      rawTitle: record.title,
      authors: record.authors || "",
      type: record.type || "record",
      typeLabel: typeLabel(record.type),
      group: record.group || "",
      area,
      domain,
      cluster: record.clusterLabel || "",
      url: record.pageUrl || record.openreviewUrl || record.projectPageUrl || "",
      x: position.x,
      y: position.y,
      size: record.type === "workshop" ? 1.5 : record.type === "paper" ? 1.42 : 1.28,
      color: nodeColor(record, colorMode),
      areaColor: colorFromPalette(area, AREA_COLORS),
      domainColor: colorFromPalette(domain, DOMAIN_COLORS),
      isMatch,
      record,
    };
  });
  const ids = new Set(nodes.map((record) => record.id));
  const links = [];
  const seen = new Set();
  for (const node of nodes) {
    const mapRecord = mapById.get(node.id);
    for (const neighbor of (mapRecord?.nearestNeighbors || []).slice(0, neighborLimit)) {
      if (!ids.has(neighbor.id) || neighbor.id === node.id) continue;
      const key = [node.id, neighbor.id].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        source: node.id,
        target: neighbor.id,
        sourceTitle: node.title,
        targetTitle: plainMathTitle(recordsById.get(neighbor.id)?.title || neighbor.title || neighbor.id),
        score: Number(neighbor.score || 0),
        isMatch: node.isMatch && matchedIds.has(neighbor.id),
      });
    }
  }
  const areas = countBy(nodes.map((node) => node.area));
  const domains = countBy(nodes.map((node) => node.domain));
  const types = countBy(nodes.map((node) => node.typeLabel));
  return {
    nodes,
    links,
    recordsById,
    mapById,
    areas,
    domains,
    types,
    matchedCount: matchedIds.size,
    isFiltered: Boolean(query || areaFilter !== "all" || domainFilter !== "all" || typeFilter !== "all"),
    summary: index.summary || {},
  };
}

export function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export function graphTooltip(node) {
  if (!node) return "";
  return `${node.title}\nArea: ${node.area} · Domain: ${node.domain} · Type: ${node.typeLabel}`;
}

export function renderDetailHtml(node, links = []) {
  if (!node) {
    return `<div class="graph-empty"><strong>Select a paper from the map</strong><span>Hover to preview, click to inspect metadata and similar records.</span></div>`;
  }
  const linkNode = (link) => {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    return source === node.id ? target : source;
  };
  const connected = links
    .filter((link) => link.source === node.id || link.target === node.id || link.source?.id === node.id || link.target?.id === node.id)
    .slice(0, 8);
  return `
    <div class="record-detail">
      <p>${escapeHtml(node.typeLabel)} · ${escapeHtml(node.area)}</p>
      <h2>${escapeHtml(node.title)}</h2>
      <div class="graph-badges">
        <span style="--badge-color:${node.areaColor}">${escapeHtml(node.area)}</span>
        <span style="--badge-color:${node.domainColor}">${escapeHtml(node.domain)}</span>
        ${node.cluster ? `<span>${escapeHtml(node.cluster)}</span>` : ""}
      </div>
      ${node.authors ? `<small>${escapeHtml(node.authors)}</small>` : ""}
      ${node.url ? `<a class="graph-action" href="${escapeHtml(node.url)}" target="_blank" rel="noreferrer">Open in viewer</a>` : ""}
      <div class="record-links">
        <strong>Similar papers</strong>
        ${connected.map((link) => {
          const otherId = linkNode(link);
          const otherTitle = otherId === link.source ? link.sourceTitle : link.targetTitle;
          return `<div class="similar-card"><span class="similar-title">${escapeHtml(otherTitle || otherId)}</span><span class="similarity-score">${Number(link.score || link.attributes?.score || 0).toFixed(2)} similarity</span></div>`;
        }).join("") || "<span>No visible neighbors in current k-nearest set.</span>"}
      </div>
    </div>
  `;
}
