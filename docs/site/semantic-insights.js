import { state } from "./state.js";
import { escapeHtml, normalize, plainMathTitle } from "./utils.js";

const STOPWORDS = new Set([
  "about", "across", "after", "against", "also", "among", "based", "because", "between", "can", "data",
  "different", "during", "each", "from", "have", "into", "large", "learn", "learning", "method", "methods",
  "model", "models", "more", "most", "using", "with", "without", "paper", "present", "propose", "provide",
  "show", "such", "than", "that", "their", "these", "this", "through", "towards", "training", "which",
]);

function topCounts(records, readValues, limit = 3) {
  const counts = new Map();
  for (const record of records) {
    for (const value of readValues(record)) {
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function topKeywords(records, limit = 6) {
  const counts = new Map();
  for (const record of records.slice(0, 160)) {
    const text = `${plainMathTitle(record.title || "")} ${(record.abstract || "").slice(0, 1200)}`.toLowerCase();
    for (const word of text.match(/[a-z][a-z0-9-]{2,}/g) || []) {
      const key = word.replace(/^-+|-+$/g, "");
      if (key.length < 4 || STOPWORDS.has(key) || normalize(key) === normalize(state.query)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function searchModeLabel() {
  if (state.mapSearchKind === "specter2-query") return "SPECTER2 query";
  if (state.mapSearchKind === "specter2-loading") return "lexical fallback";
  if (state.mapSearchKind === "keyword-neighbor") return "keyword neighbors";
  return "query-vector";
}

export function renderSemanticInsightPanel(records, query) {
  const host = document.querySelector("#mapCanvas")?.parentElement;
  if (!host) return;
  let panel = host.querySelector(".semantic-insight");
  if (!query || state.tab !== "map") {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement("aside");
    panel.className = "semantic-insight";
    panel.setAttribute("aria-label", "Semantic search insight");
    host.appendChild(panel);
  }
  const areas = topCounts(records, (record) => record.areaTags || record.categoryTags || []);
  const domains = topCounts(records, (record) => record.domainTags || []);
  const keywords = topKeywords(records);
  panel.innerHTML = `
    <div class="semantic-insight-head">
      <strong>${records.length.toLocaleString()} highlighted</strong>
      <span>${escapeHtml(searchModeLabel())}</span>
    </div>
    <div class="semantic-insight-grid">
      <span><em>Area</em>${areas.map(([name, count]) => `<b>${escapeHtml(name)} <i>${count}</i></b>`).join("") || "<b>Mixed</b>"}</span>
      <span><em>Domain</em>${domains.map(([name, count]) => `<b>${escapeHtml(name)} <i>${count}</i></b>`).join("") || "<b>General</b>"}</span>
    </div>
    <div class="semantic-insight-keywords">
      ${keywords.map((word) => `<b>${escapeHtml(word)}</b>`).join("") || "<b>title-only</b>"}
    </div>
  `;
}
