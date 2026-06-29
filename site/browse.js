import { PAGE_SIZE } from "./config.js";
import { els } from "./dom.js";
import {
  MATCH_FIELD_LABEL,
  assetLabel,
  categoryTags,
  matchedField,
  presentationBadges,
  recordHaystack,
  resultDetails,
  typeLabel,
} from "./records.js";
import { state } from "./state.js";
import { escapeHtml, normalize, plainMathTitle, queueMathTypeset } from "./utils.js";
import { renderViewer, uniqueChipValues } from "./viewer.js";
import {
  mapColorValue,
  mapSemanticSearchIds,
} from "./map-core.js";
import { browseRecordColor } from "./map-tooltip.js";

let browseDeps = {};
let searchWorkerIndexed = false;

export function configureBrowse(deps) {
  browseDeps = deps;
}

export function displayRecords() {
  return (state.data?.records || []).filter((record) => record.type !== "poster");
}

function recordsForCurrentTab() {
  return state.tab === "map"
    ? displayRecords()
    : displayRecords().filter((record) => record.type === state.tab);
}

export function findDisplayRecord(id) {
  return displayRecords().find((record) => record.id === id);
}

function ensureSearchWorker() {
  if (state.searchWorker || typeof Worker !== "function") return state.searchWorker;
  try {
    state.searchWorker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
    state.searchWorker.addEventListener("message", (event) => {
      if (event.data?.type === "ready") {
        searchWorkerIndexed = true;
        return;
      }
      const { requestId, query, ids } = event.data || {};
      if (requestId !== state.searchWorkerRequestId) return;
      state.searchWorkerQuery = query || "";
      state.searchWorkerIds = new Set(ids || []);
      state.searchWorkerPending = false;
      browseDeps.renderAfterWorkerSearch?.();
    });
  } catch {
    state.searchWorker = null;
  }
  return state.searchWorker;
}

export function refreshSearchWorkerIndex() {
  const worker = ensureSearchWorker();
  if (!worker) return;
  searchWorkerIndexed = false;
  const records = displayRecords().map((record) => ({
    id: record.id,
    title: record.title || "",
    haystack: recordHaystack(record),
  }));
  worker.postMessage({ type: "index", records });
}

export function queueWorkerSearch() {
  const query = normalize(state.query);
  state.searchWorkerQuery = "";
  state.searchWorkerIds = null;
  state.searchWorkerPending = false;
  if (!query) return;
  const worker = ensureSearchWorker();
  if (!worker) return;
  if (!searchWorkerIndexed) refreshSearchWorkerIndex();
  const requestId = state.searchWorkerRequestId + 1;
  state.searchWorkerRequestId = requestId;
  state.searchWorkerPending = true;
  const candidateIds = recordsForCurrentTab()
    .filter((record) => passesActiveFilters(record, true))
    .map((record) => record.id);
  worker.postMessage({ type: "search", requestId, query, candidateIds });
}

function passesActiveFilters(record, ignoreMapFilter) {
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
  return true;
}

export function getFilteredRecords(options = {}) {
  const query = normalize(state.query);
  const ignoreMapFilter = Boolean(options.ignoreMapFilter);
  const filtered = recordsForCurrentTab().filter((record) => passesActiveFilters(record, ignoreMapFilter));
  if (!query) {
    state.mapSearchSeedIds = new Set();
    state.mapSearchSemanticIds = new Set();
    state.mapSearchKind = "";
    state.mapSearchTopScore = 0;
    state.mapSearchPending = false;
    state.mapSearchMessage = "";
    return filtered;
  }
  const semanticIds = mapSemanticSearchIds(query, filtered);
  if (semanticIds) return filtered.filter((record) => semanticIds.has(record.id));
  if (state.searchWorkerQuery === query && state.searchWorkerIds) {
    return filtered.filter((record) => state.searchWorkerIds.has(record.id));
  }
  return filtered.filter((record) => recordHaystack(record).includes(query));
}

export function updateHeader() {
  const records = displayRecords();
  const papers = records.filter((record) => record.type === "paper");
  const workshops = records.filter((record) => record.type === "workshop");
  const areaGroups = new Set(records.map((record) => record.clusterLabel || record.clusterId).filter(Boolean)).size;
  const mapClusters = Math.max(
    0,
    ...(state.mapData?.embeddingClusterLevels || []).map((level) => (level.clusters || []).length),
  );
  els.headerStats.innerHTML = [
    ["records", papers.length + workshops.length],
    ["area groups", areaGroups],
    ["map clusters", mapClusters],
    ["workshops", workshops.length],
  ].filter(([, value]) => value > 0)
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
    ["blocked", recordsForTab.every((record) => record.type === "paper") ? "OpenReview PDF" : "OpenReview PDF / blocked"],
    ["metadata", "Metadata only"],
    ["unavailable", "Unavailable / skipped"],
  ];
  els.asset.innerHTML = options
    .map(([value, label]) => assetOption(value, label, counts[value] || 0, value !== "all" && !counts[value]))
    .join("");
  if (!counts[state.asset] && state.asset !== "all") state.asset = "all";
  els.asset.value = state.asset;
  renderAssetPills(counts);
}

function renderAssetPills(counts = {}) {
  if (!els.assetPills) return;
  const pills = [
    ["all", "All records"],
    ["pdf", "Has PDF"],
    ["poster", "Has poster"],
    ["local", "Downloaded"],
    ["blocked", "OpenReview PDF"],
  ];
  els.assetPills.innerHTML = `
    ${pills.map(([value, label]) => {
      const disabled = value !== "all" && !counts[value];
      const active = state.asset === value;
      return `<button class="filter-pill${active ? " is-active" : ""}" type="button" data-asset="${escapeHtml(value)}"${disabled ? " disabled" : ""}>${escapeHtml(label)}</button>`;
    }).join("")}
  `;
  els.assetPills.querySelectorAll(".filter-pill").forEach((button) => {
    button.addEventListener("click", () => {
      state.asset = button.dataset.asset || "all";
      els.asset.value = state.asset;
      browseDeps.applyFilterChange?.();
    });
  });
}

const ASSET_FILTER_LABELS = {
  all: "all assets",
  local: "downloaded locally",
  pdf: "has PDF",
  poster: "has poster image",
  slide: "has slide deck",
  blocked: "OpenReview PDF / blocked",
  metadata: "metadata only",
  unavailable: "unavailable / skipped",
};

export function activeFilterSummary(baseLabel, extraParts = []) {
  const parts = [baseLabel, state.category === "all" ? "all fields" : state.category];
  if (state.group !== "all") parts.push(state.group);
  if (state.asset !== "all") parts.push(ASSET_FILTER_LABELS[state.asset] || state.asset);
  if (state.query.trim()) {
    const query = state.query.trim();
    parts.push(`search: ${query.length > 32 ? query.slice(0, 31) + "..." : query}`);
  }
  return [...parts, ...extraParts.filter(Boolean)].join(" · ");
}

export function updateSelects() {
  const recordsForTab = recordsForCurrentTab();
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

export function renderResults() {
  const filtered = getFilteredRecords();
  const query = normalize(state.query);
  els.resultCount.textContent = `${filtered.length.toLocaleString()} results`;
  els.activeSummary.textContent = activeFilterSummary(typeLabel(state.tab));

  const visible = filtered.slice(0, state.visibleCount);
  els.results.innerHTML = visible
    .map((record) => {
      const selected = record.id === state.selectedId ? " is-selected" : "";
      const featured = (record.presentationLabels || []).includes("Spotlight") ? " is-spotlight" : (record.presentationLabels || []).includes("Oral") ? " is-oral" : "";
      const details = resultDetails(record);
      const matched = matchedField(record, query);
      const areaLabel = (record.areaTags || categoryTags(record)).slice(0, 1)[0] || "Other";
      const assetBadges = uniqueChipValues([
        assetLabel(record),
        record.hasPoster ? "Poster" : "",
        record.hasSlide ? "Slides" : "",
      ]);
      return `
        <button class="result-item${selected}${featured}" type="button" data-id="${escapeHtml(record.id)}" style="--record-color:${escapeHtml(browseRecordColor(record))}">
          <span class="result-kicker">
            ${matched ? `<span class="badge match">${escapeHtml(MATCH_FIELD_LABEL[matched])} match</span>` : ""}
            ${presentationBadges(record)}
            <span class="area-label"><i></i>${escapeHtml(areaLabel)}</span>
          </span>
          <span class="result-title">${escapeHtml(plainMathTitle(record.title))}</span>
          <span class="result-authors">${escapeHtml(record.authors || "Authors unavailable")}</span>
          <span class="badges">
            ${record.group && record.group !== "Main Conference" ? `<span class="badge">${escapeHtml(record.group)}</span>` : ""}
            ${assetBadges.map((label) => `<span class="badge">${escapeHtml(label)}</span>`).join("")}
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
      state.viewerMapRequested = true;
      const selected = findDisplayRecord(state.selectedId);
      renderResults();
      renderViewer(selected);
      browseDeps.hydrateSelectedRecord?.(state.selectedId);
    });
  });

  queueMathTypeset(els.results);
}

export function ensureVisibleSelection() {
  if (state.tab === "map") return findDisplayRecord(state.selectedId);
  const filtered = getFilteredRecords();
  if (!filtered.some((record) => record.id === state.selectedId)) {
    state.selectedId = filtered[0]?.id || "";
  }
  return findDisplayRecord(state.selectedId);
}

export function resetResultWindow() {
  state.visibleCount = PAGE_SIZE;
}

export function loadMoreResultsIfNeeded() {
  const remaining = getFilteredRecords().length - state.visibleCount;
  if (remaining <= 0) return;
  state.visibleCount += PAGE_SIZE;
  renderResults();
}
