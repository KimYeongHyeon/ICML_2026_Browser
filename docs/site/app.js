const DATA_URL = "site/data/icml2026_index.json";
const PAGE_SIZE = 80;
const REPO_RAW_BASE = "https://raw.githubusercontent.com/KimYeongHyeon/icml-2026-materials-browser/main/";
const LOCAL_ASSET_PREFIX = window.location.pathname.includes("/docs/") ? "../" : "";
const ASSET_BASE = window.location.hostname.endsWith("github.io") ? REPO_RAW_BASE : LOCAL_ASSET_PREFIX;
const MATHJAX_RETRY_LIMIT = 40;

const state = {
  tab: "paper",
  query: "",
  category: "all",
  group: "all",
  asset: "all",
  selectedId: "",
  visibleCount: PAGE_SIZE,
  data: null,
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
  viewerKind: document.querySelector("#viewerKind"),
  viewerTitle: document.querySelector("#viewerTitle"),
  viewerActions: document.querySelector("#viewerActions"),
  viewerMeta: document.querySelector("#viewerMeta"),
  viewerFrame: document.querySelector("#viewerFrame"),
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
  }[type] || type;
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

function getFilteredRecords() {
  const query = normalize(state.query);
  return state.data.records.filter((record) => {
    if (record.type !== state.tab) return false;
    if (state.category !== "all" && record.category !== state.category) return false;
    if (state.group !== "all" && record.group !== state.group) return false;
    if (state.asset === "local" && !(record.hasPdf || record.hasPoster || record.hasSlide)) return false;
    if (state.asset === "pdf" && !record.hasPdf) return false;
    if (state.asset === "poster" && !record.hasPoster) return false;
    if (state.asset === "slide" && !record.hasSlide) return false;
    if (state.asset === "blocked" && record.availabilityStatus !== "blocked") return false;
    if (state.asset === "metadata" && record.availabilityStatus !== "metadata") return false;
    if (state.asset === "unavailable" && record.availabilityStatus !== "unavailable") return false;
    if (!query) return true;
    const haystack = normalize(`${record.title} ${plainMathTitle(record.title)} ${record.authors} ${record.group} ${record.category}`);
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
  ]
    .map(([label, value]) => `<span class="stat-pill"><strong>${value.toLocaleString()}</strong> ${label}</span>`)
    .join("");
}

function option(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function updateSelects() {
  const recordsForTab = state.data.records.filter((record) => record.type === state.tab);
  const categories = [...new Set(recordsForTab.map((record) => record.category))].sort();
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
            <span class="badge">${escapeHtml(record.category)}</span>
            <span class="badge">${escapeHtml(record.group)}</span>
            <span class="badge">${assetLabel(record)}</span>
            <span class="badge ${statusClass(record)}">${escapeHtml(record.availabilityLabel || "Metadata only")}</span>
          </span>
          <span class="result-details">${escapeHtml(record.status || record.availabilityLabel || "available")} ${record.failureReason ? "· " + escapeHtml(record.failureReason) : ""}</span>
        </button>
      `;
    })
    .join("");

  els.results.querySelectorAll(".result-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      const selected = state.data.records.find((record) => record.id === state.selectedId);
      renderResults();
      renderViewer(selected);
    });
  });

  if (!state.selectedId && filtered[0]) {
    state.selectedId = filtered[0].id;
    renderViewer(filtered[0]);
  }
  queueMathTypeset(els.results);
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

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}${path}`;
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
    actionLink(assetUrl(localAsset), "Open asset", true),
    actionLink(record.pageUrl, "Official page"),
    actionLink(record.openreviewUrl, "OpenReview"),
    actionLink(record.projectPageUrl, "Project"),
    actionLink(record.pdfUrl && !record.localPdfPath ? record.pdfUrl : "", "Remote PDF"),
  ].join("");
  els.viewerActions.innerHTML = actions;

  if (preferred && (record.bestAssetKind === "pdf" || record.bestAssetKind === "slide")) {
    els.viewerFrame.innerHTML = `<iframe src="${escapeHtml(assetUrl(preferred))}" title="${escapeHtml(record.title)}"></iframe>`;
  } else if (preferred && record.bestAssetKind === "poster") {
    els.viewerFrame.innerHTML = `<img src="${escapeHtml(assetUrl(preferred))}" alt="${escapeHtml(record.title)} poster" />`;
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
  queueMathTypeset(document.body);
}

function renderAll() {
  els.tabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.tab);
  });
  updateSelects();
  state.selectedId = "";
  resetResultWindow();
  renderResults();
}

async function init() {
  els.results.innerHTML = `<div class="empty-state"><strong>Loading index</strong><span>Reading the local ICML 2026 manifest.</span></div>`;
  const response = await fetch(DATA_URL);
  state.data = await response.json();
  updateHeader();
  renderAll();

  els.tabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.category = "all";
      state.group = "all";
      state.asset = "all";
      els.asset.value = "all";
      resetResultWindow();
      renderAll();
    });
  });

  els.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedId = "";
    resetResultWindow();
    renderResults();
  });
  els.category.addEventListener("change", (event) => {
    state.category = event.target.value;
    state.selectedId = "";
    resetResultWindow();
    renderResults();
  });
  els.group.addEventListener("change", (event) => {
    state.group = event.target.value;
    state.selectedId = "";
    resetResultWindow();
    renderResults();
  });
  els.asset.addEventListener("change", (event) => {
    state.asset = event.target.value;
    state.selectedId = "";
    resetResultWindow();
    renderResults();
  });
  els.results.addEventListener("scroll", () => {
    const distanceFromBottom = els.results.scrollHeight - els.results.scrollTop - els.results.clientHeight;
    if (distanceFromBottom < 320) {
      loadMoreResultsIfNeeded();
    }
  });
}

init().catch((error) => {
  els.results.innerHTML = `<div class="empty-state"><strong>Could not load data</strong><span>${escapeHtml(error.message)}</span></div>`;
});
