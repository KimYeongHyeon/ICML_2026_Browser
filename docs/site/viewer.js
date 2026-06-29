import { LOCAL_ASSET_PREFIX, REPO_CDN_BASE } from "./config.js";
import { els } from "./dom.js";
import {
  assetLabel,
  displayAvailabilityLabel,
  openReviewPdfUrl,
  paperPresentationKind,
  paperPresentationMode,
  statusLabel,
  typeLabel,
  viewerKindLabel,
} from "./records.js";
import { state } from "./state.js";
import { escapeHtml, plainMathTitle, queueMathTypeset } from "./utils.js";
import { loadReferenceRecord } from "./references.js";
import {
  destroyPdfViewer,
  isPdfAsset,
  mountPdfViewer,
  renderAssetOpenFallback,
} from "./pdf-viewer.js";
import { recordStudy } from "./study-features.js";
import { renderStudyPanel } from "./study-ui.js";

let viewerDeps = {};

export function configureViewer(deps) {
  viewerDeps = deps;
}

export function uniqueChipValues(values) {
  const seen = new Set();
  return values.filter(Boolean).filter((value) => {
    const key = String(value).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  if (window.location.hostname.endsWith("github.io")) return `${REPO_CDN_BASE}${path}`;
  if (!isLocalHost && String(path).startsWith("icml_2026_materials/") && !window.location.pathname.includes("/docs/")) return `${REPO_CDN_BASE}${path}`;
  return new URL(`${LOCAL_ASSET_PREFIX}${path}`, window.location.href).href;
}

function fallbackPageUrl(record) {
  if (record.type === "workshop" && record.pdfUrl) return record.pdfUrl;
  return record.pageUrl || record.openreviewUrl || record.projectPageUrl || record.pdfUrl || "";
}

function fallbackPageLabel(record) {
  if (record.type === "paper" && /\/poster\//.test(record.pageUrl || "")) return "Official paper presentation page";
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
  if (!canEmbed) {
    return renderViewerStatusRow(record, fallbackPageLabel(record), message);
  }

  return `
    <div class="source-page-shell">
      <div class="source-page-note">
        <strong>${escapeHtml(fallbackPageLabel(record))}</strong>
        <span>${escapeHtml(message)}</span>
      </div>
      <iframe src="${escapeHtml(sourceUrl)}" title="${escapeHtml(record.title)} source page"></iframe>
    </div>
  `;
}

function renderViewerStatusRow(record, title, message) {
  return `
    <div class="viewer-status-row status-${escapeHtml(record.availabilityStatus || "metadata")}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
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

function cleanAbstractLatex(value) {
  return String(value || "")
    .replace(/\[cite:\s*\d+(?:\s*,\s*\d+)*\]/gi, "")
    .replace(/\\cite(?:t|p)?\{[^{}]*\}/g, "")
    .replace(/\\(?:textit|texttt|textbf|textrm|textsc|emph|text)\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:mathbb|mathbf|mathrm|mathsf|mathcal)\{([^{}]*)\}/g, "$1")
    .replace(/\$([^$]+)\$/g, (_, content) => {
      const text = String(content || "").trim();
      if (/^[A-Za-z0-9][A-Za-z0-9\s.,;:'"!?+\-/]*(?:\^[0-9]+)?$/.test(text)) return text;
      return `$${text}$`;
    })
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  return html;
}

function renderSafeTextBlocks(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^[-*]\s+/m.test(block)) {
        const items = block.split(/\n/).map((line) => line.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
        return `<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`;
      }
      return `<p>${renderInlineMarkdown(block)}</p>`;
    })
    .join("");
}

function renderAbstractBlock(record) {
  const abstract = cleanAbstractLatex(record.abstract).trim();
  if (!abstract) return "";
  return `<div class="viewer-abstract"><h3>Abstract</h3><div class="viewer-abstract-body">${renderSafeTextBlocks(abstract)}</div></div>`;
}

function openStudyRecord(recordId) {
  const selected = viewerDeps.findDisplayRecord(recordId);
  if (!selected) return;
  state.selectedId = recordId;
  state.viewerMapRequested = true;
  state.studyCompareSourceId = "";
  state.studyCompareTargetId = "";
  viewerDeps.renderResults();
  viewerDeps.renderMap();
  renderViewer(selected);
}

function mountStudyPanelActions(record) {
  els.viewerFrame.querySelectorAll("[data-study-id]").forEach((button) => {
    button.addEventListener("click", () => openStudyRecord(button.dataset.studyId));
  });
  els.viewerFrame.querySelectorAll(".compare-candidate").forEach((button) => {
    button.addEventListener("click", () => {
      state.studyCompareSourceId = record.id;
      state.studyCompareTargetId = button.dataset.compareId || "";
      renderViewer(record);
    });
  });
}

function referenceDisplayTitle(item = {}) {
  return plainMathTitle(item.title || item.raw || item.key || "Untitled reference");
}

function openReferenceRecord(recordId) {
  const selected = viewerDeps.findDisplayRecord(recordId);
  if (!selected) return;
  state.tab = selected.type === "workshop" ? "workshop" : "paper";
  state.selectedId = recordId;
  state.viewerMapRequested = true;
  viewerDeps.renderResults();
  viewerDeps.renderMap();
  renderViewer(selected);
}

function renderViewerReferencePanel(payload = {}) {
  const references = (payload.references || []).slice(0, 4);
  const overlaps = (payload.overlaps || []).slice(0, 5);
  if (!references.length && !overlaps.length) return "";
  const topShared = Math.max(0, ...overlaps.map((item) => Number(item.sharedCount || 0)));
  const hasOverlaps = overlaps.length > 0;
  return `
    <section class="viewer-reference-panel">
      <div class="viewer-section-head">
        <div>
          <p class="eyebrow">Citation overlap</p>
          <h3>${hasOverlaps ? "Strongest reference links" : "Extracted references"}</h3>
        </div>
        <span>${Number(payload.referenceCount || 0).toLocaleString()} extracted refs</span>
      </div>
      <div class="selection-stat-grid viewer-reference-stats">
        <span><b>${Number(payload.referenceCount || 0).toLocaleString()}</b><small>refs</small></span>
        <span><b>${Number(overlaps.length || 0).toLocaleString()}</b><small>shown links</small></span>
        <span><b>${Number(topShared || 0).toLocaleString()}</b><small>top shared refs</small></span>
      </div>
      ${hasOverlaps ? `
        <div class="viewer-reference-links">
          ${overlaps.map((item, index) => {
            const linked = viewerDeps.findDisplayRecord(item.recordId);
            const sharedTitles = (item.references || []).slice(0, 2).map(referenceDisplayTitle).filter(Boolean).join(" · ");
            return `
              <button class="viewer-reference-link" type="button" data-reference-id="${escapeHtml(item.recordId)}">
                <span class="neighbor-rank">${index + 1}</span>
                <span>
                  <strong>${escapeHtml(plainMathTitle(linked?.title || item.title || item.recordId))}</strong>
                  <small>${Number(item.sharedCount || 0).toLocaleString()} shared refs · ${Number(item.score || 0).toFixed(2)} overlap${sharedTitles ? ` · ${escapeHtml(sharedTitles)}` : ""}</small>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      ` : "<p class=\"viewer-reference-empty\">References were extracted, but no strong shared-reference links were found yet.</p>"}
      <div class="viewer-reference-samples">
        ${references.map((item) => `<span>${escapeHtml(referenceDisplayTitle(item))}</span>`).join("")}
      </div>
    </section>
  `;
}

function mountReferencePanelActions() {
  els.viewerFrame.querySelectorAll("[data-reference-id]").forEach((button) => {
    button.addEventListener("click", () => openReferenceRecord(button.dataset.referenceId));
  });
}

function mountReferencePanel(record) {
  const marker = els.viewerFrame.querySelector("[data-viewer-reference-panel]");
  if (!marker) return;
  void loadReferenceRecord(record.id).then((payload) => {
    if (state.selectedId !== record.id || !marker.isConnected) return;
    const html = renderViewerReferencePanel(payload || {});
    if (!html) {
      marker.remove();
      return;
    }
    marker.innerHTML = html;
    mountReferencePanelActions();
  });
}

export function renderViewer(record) {
  viewerDeps.destroyMiniGraph();
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
  const primaryMeta = [
    ["Authors", record.authors || "Authors unavailable"],
    ["Session", uniqueChipValues([record.session, record.roomName, paperPresentationMode(record)]).join(" · ")],
    ["Type", uniqueChipValues([paperPresentationKind(record), record.group]).join(" · ")],
  ].filter(([, value]) => value);
  const secondaryMeta = uniqueChipValues([
    ...(record.presentationLabels || []),
    record.decision,
    displayAvailabilityLabel(record),
    statusLabel(record.status),
    record.type === "paper" && openReviewPdfUrl(record) ? "" : record.failureReason,
  ]);
  els.viewerMeta.innerHTML = [
    ...primaryMeta.map(([label, value]) => `<span class="viewer-meta-line">${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`),
    ...secondaryMeta.map((value) => `<span class="chip">${escapeHtml(value)}</span>`),
  ].join("");

  const preferred = record.bestAsset || "";
  const localAsset = record.localPdfPath || record.localSlidePath || record.localPosterPath;
  const actions = [
    actionLink(assetActionHref(record, localAsset), assetActionLabel(record), true),
    actionLink(openReviewPdfUrl(record), record.type === "paper" && !record.localPdfPath ? "OpenReview PDF" : "Open PDF", record.type === "paper" && !localAsset),
    actionLink(record.pageUrl, "Official page"),
    actionLink(record.openreviewUrl, "OpenReview"),
    actionLink(record.projectPageUrl, "Project"),
  ].join("");
  els.viewerActions.innerHTML = actions;

  if (preferred && record.bestAssetKind === "poster") {
    els.viewerFrame.innerHTML = renderPosterPreview(record, preferred);
  } else if (preferred && (record.bestAssetKind === "pdf" || record.bestAssetKind === "slide")) {
    els.viewerFrame.innerHTML = renderAssetOpenFallback(record, preferred, assetUrl(preferred));
    void mountPdfViewer(preferred);
  } else if (fallbackPageUrl(record)) {
    const sourceUrl = fallbackPageUrl(record);
    const message = record.type === "paper" && openReviewPdfUrl(record)
      ? "OpenReview PDF may open in your browser session. It cannot be embedded here because OpenReview blocks framing and cross-origin preview."
      : record.type === "workshop" && record.pdfUrl
      ? "This workshop paper PDF is hosted on OpenReview and opens in a new tab — it can't be embedded here due to OpenReview's framing policy."
      : record.failureReason || "No local PDF, poster image, or slide deck was collected, so the source page is used instead.";
    els.viewerFrame.innerHTML = renderSourcePageFallback(record, sourceUrl, message);
  } else {
    let title = assetLabel(record);
    let message = "No public local media file was collected for this record.";
    if (record.availabilityStatus === "blocked") {
      title = record.type === "paper" ? "OpenReview PDF" : "Blocked";
      message = record.failureReason || (record.type === "paper"
        ? "The accepted paper metadata is public. OpenReview PDFs may open in a logged-in browser session, but cannot be embedded or downloaded by the static site."
        : "The source was checked, but the material is not publicly downloadable yet or blocked the download.");
    } else if (record.availabilityStatus === "metadata") {
      title = "Metadata only";
      message = record.type === "paper"
        ? "The main-conference paper PDFs are not public in the collected official sources yet."
        : "The source exposed metadata, but no downloadable media file.";
    } else if (record.availabilityStatus === "unavailable") {
      title = "Unavailable / skipped";
      message = record.failureReason || "The linked source was not a direct downloadable material.";
    }
    els.viewerFrame.innerHTML = renderViewerStatusRow(record, title, message);
  }
  const abstractBlock = renderAbstractBlock(record);
  if (abstractBlock) els.viewerFrame.insertAdjacentHTML("beforeend", abstractBlock);
  if (state.viewerMapRequested) {
    els.viewerFrame.insertAdjacentHTML("beforeend", `<div data-viewer-reference-panel></div>`);
    mountReferencePanel(record);
  }
  els.viewerFrame.querySelector(".poster-zoom-toggle")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const preview = button.closest(".poster-preview");
    const zoomed = !preview.classList.contains("is-zoomed");
    preview.classList.toggle("is-zoomed", zoomed);
    button.setAttribute("aria-pressed", String(zoomed));
    if (!zoomed) preview.scrollIntoView({ block: "start" });
  });
  if (state.viewerMapRequested && record.mapAvailable && !state.mapData?.records?.length && viewerDeps.ensureMapData) {
    void viewerDeps.ensureMapData().then((payload) => {
      if (payload?.records?.length && state.selectedId === record.id) renderViewer(record);
    });
  }
  const miniMap = viewerDeps.renderMiniMap(record);
  if (miniMap) {
    els.viewerFrame.insertAdjacentHTML("beforeend", miniMap);
    const neighborhood = viewerDeps.semanticNeighborhood(record);
    if (neighborhood) viewerDeps.mountMiniGraph(neighborhood.graphData, record.id);
    els.viewerFrame.querySelectorAll(".mini-graph-control").forEach((button) => {
      button.addEventListener("click", () => {
        viewerDeps.controlMiniGraph?.(button.dataset.miniAction, record);
      });
    });
    els.viewerFrame.querySelectorAll(".neighbor-item").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = viewerDeps.findDisplayRecord(button.dataset.id);
        state.selectedId = button.dataset.id;
        state.viewerMapRequested = true;
        viewerDeps.renderResults();
        viewerDeps.renderMap();
        renderViewer(selected);
      });
    });
  }
  if (record.mapAvailable && state.viewerMapRequested && !state.studyFeaturesLoaded && viewerDeps.ensureStudyFeatures) {
    void viewerDeps.ensureStudyFeatures().then(() => {
      if (state.selectedId === record.id) renderViewer(record);
    });
  }
  const studyPanel = renderStudyPanel(record, recordStudy(record.id), viewerDeps.findDisplayRecord);
  if (studyPanel) {
    els.viewerFrame.insertAdjacentHTML("beforeend", studyPanel);
    mountStudyPanelActions(record);
  }
  els.viewerFrame.scrollTop = 0;
  queueMathTypeset(document.body);
}
