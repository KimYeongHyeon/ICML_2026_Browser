import { els } from "./dom.js";
import { typeLabel } from "./records.js";
import { state } from "./state.js";
import { escapeHtml, plainMathTitle } from "./utils.js";
import { countLabels } from "./map-layout.js";
import { colorForValue } from "./map-tooltip.js";
import {
  focusDepth,
  focusedGraphPosition,
  focusedLayoutContext,
  mapColorValue,
  mapRecordById,
  nearestDisplayNeighbors,
  selectedNeighborIds,
  sharedSemanticTags,
} from "./map-core.js";
import {
  applyForceAnchors,
  drawForceGraphNode,
} from "./map-engine.js";

let detailDeps = {};

export function configureMapDetail(deps) {
  detailDeps = deps;
}

export function renderMapDetail(record) {
  if (!record) {
    els.mapDetail.innerHTML = `<div class="empty-state compact"><strong>Select a paper from the map</strong><span>Hover to preview, click to inspect metadata and similar records.</span></div>`;
    return;
  }
  const mapById = mapRecordById();
  const neighbors = nearestDisplayNeighbors(record, mapById, 8);
  const neighborScores = neighbors.map((item) => Number(item.score || 0));
  const neighborMin = neighborScores.length ? Math.min(...neighborScores) : 0;
  const neighborRange = (neighborScores.length ? Math.max(...neighborScores) : 1) - neighborMin || 1;
  const topScore = neighborScores.length ? Math.max(...neighborScores) : 0;
  const areaLabel = (record.areaTags || record.categoryTags || ["Other"]).slice(0, 2).join(", ") || "Other";
  const domainLabel = (record.domainTags || ["General"]).slice(0, 2).join(", ") || "General";
  const neighborStrength = (score) => Math.max(0.08, Math.min(1, (Number(score || 0) - neighborMin) / neighborRange));
  els.mapDetail.innerHTML = `
    <div class="map-detail-card">
      <p class="eyebrow">${escapeHtml(typeLabel(record.type))} · ${escapeHtml(record.clusterLabel || "Mapped record")}</p>
      <h3>${escapeHtml(plainMathTitle(record.title))}</h3>
      ${record.authors ? `<p class="result-authors">${escapeHtml(record.authors)}</p>` : ""}
      <div class="badges">
        ${(record.areaTags || []).slice(0, 3).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        ${(record.domainTags || []).slice(0, 2).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        <span class="badge">${escapeHtml(record.embeddingTextQuality || "unavailable")}</span>
      </div>
      <div class="selection-stat-grid">
        <span><strong>${neighbors.length.toLocaleString()}</strong>neighbors</span>
        <span><strong>${Number(topScore || 0).toFixed(2)}</strong>top similarity</span>
        <span><strong>${escapeHtml(domainLabel)}</strong>domain</span>
      </div>
      <div class="selection-stat-block">
        <strong>Area / domain</strong>
        <span><em>${escapeHtml(areaLabel)}</em><b>${escapeHtml(domainLabel)}</b></span>
      </div>
      <button class="action primary map-open-record" type="button">Open in viewer</button>
      <div class="neighbor-list">
        ${neighbors.map((item) => {
          const strength = neighborStrength(item.score);
          const tags = sharedSemanticTags(record, item.record);
          return `<button type="button" class="neighbor-item semantic-neighbor" data-id="${escapeHtml(item.record.id)}"><span class="neighbor-rank">${item.rank}</span><span class="neighbor-main"><strong>${escapeHtml(plainMathTitle(item.record.title))}</strong><span>${Number(item.score || 0).toFixed(2)} similarity${tags.length ? ` · shared ${tags.map(escapeHtml).join(", ")}` : ""}</span><i class="neighbor-score-bar"><b style="width:${Math.round(strength * 100)}%"></b></i></span></button>`;
        }).join("") || "<small>No mapped neighbors found for this record.</small>"}
      </div>
    </div>
  `;
  els.mapDetail.querySelector(".map-open-record")?.addEventListener("click", () => {
    state.tab = record.type;
    state.category = "all";
    state.group = "all";
    state.asset = "all";
    els.asset.value = "all";
    detailDeps.renderAll?.();
    state.selectedId = record.id;
    detailDeps.renderResults?.();
    detailDeps.renderViewer?.(record);
  });
  els.mapDetail.querySelectorAll(".neighbor-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      const selected = detailDeps.findDisplayRecord?.(state.selectedId);
      detailDeps.renderMap?.();
      renderMapDetail(selected);
      detailDeps.renderViewer?.(selected);
    });
  });
}

export function semanticNeighborhood(record) {
  if (!record?.mapAvailable || !state.mapData?.records?.length) return "";
  const mapById = mapRecordById();
  const center = mapById.get(record.id);
  if (!center) return null;
  const neighbors = nearestDisplayNeighbors(record, mapById, 8)
    .filter((item) => mapById.has(item.record.id));
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
  const sharedTags = (neighborRecord) => sharedSemanticTags(record, neighborRecord);
  const topTags = countLabels(neighbors.map((item) => item.record.areaTags || [])).slice(0, 4);
  return { neighbors, topTags, maxScore, similarityPercent, sharedTags, graphData: { nodes, links } };
}

export function destroyMiniGraph() {
  state.miniGraph?.pauseAnimation?.();
  state.miniGraph = null;
  detailDeps.hideGraphTooltip?.(els.viewerFrame.querySelector(".mini-graph"));
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

export function mountMiniGraph(graphData, selectedId) {
  destroyMiniGraph();
  const container = els.viewerFrame.querySelector(".mini-graph");
  if (!container || typeof window.ForceGraph !== "function") return;
  let miniHoverId = "";
  state.miniGraph = window.ForceGraph()(container)
    .backgroundColor("rgba(0,0,0,0)")
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
    .linkColor((link) => link.selected ? "rgba(106,165,147,0.38)" : "rgba(148,163,184,0.18)")
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
        detailDeps.showGraphTooltip?.(container, node, state.miniGraph.graph2ScreenCoords(node.x || 0, node.y || 0));
      } else {
        detailDeps.hideGraphTooltip?.(container, 90);
      }
      state.miniGraph?.refresh?.();
    })
    .onNodeClick((node) => {
      if (!node?.record) return;
      state.selectedId = node.id;
      detailDeps.renderResults?.();
      detailDeps.renderMap?.();
      detailDeps.renderViewer?.(node.record);
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

export function renderMiniMap(record) {
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
