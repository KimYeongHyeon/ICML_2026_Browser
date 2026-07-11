import { buildAuthorNetworkFromAnalytics } from "./people-analytics.mjs";
import { researchConceptTags } from "./research-concepts.mjs";
import { colorForValue } from "./map-tooltip.js";
import { escapeHtml, plainMathTitle } from "./utils.js";

const authorMapState = {
  scope: "all",
  query: "",
  selectedId: "",
  hoverId: "",
  records: null,
  analysisArtifact: null,
  cache: new Map(),
  graph: null,
  graphTarget: null,
  renderToken: 0,
};

export function clearAuthorMapCache() {
  authorMapState.cache.clear();
}

function scopeRecords(records, scope) {
  if (scope === "workshop") return records.filter((record) => record.type === "workshop");
  if (scope === "main") return records.filter((record) => record.type === "paper" || record.type === "poster");
  return records;
}

function recordById(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function searchText(node) {
  return [node.title, node.group, ...(node.topics || []).map((topic) => topic.label)].join(" ").toLocaleLowerCase();
}

function linkEndpointId(endpoint) {
  return typeof endpoint === "object" ? endpoint?.id : endpoint;
}

export function filterAuthorGraph(network, query = "") {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (!normalizedQuery) return network;
  const matching = network.nodes.filter((node) => searchText(node).includes(normalizedQuery));
  const visibleIds = new Set(matching.map((node) => node.id));
  matching.forEach((node) => (network.neighborsById.get(node.id) || []).forEach((neighbor) => visibleIds.add(neighbor.id)));
  const nodes = network.nodes.filter((node) => visibleIds.has(node.id));
  const links = network.links.filter((link) => (
    visibleIds.has(linkEndpointId(link.source)) && visibleIds.has(linkEndpointId(link.target))
  ));
  return {
    ...network,
    summary: {
      ...network.summary,
      authorCount: nodes.length,
      linkCount: links.length,
    },
    nodes,
    links,
  };
}

function filteredGraph(network) {
  return filterAuthorGraph(network, authorMapState.query);
}

function selectedLink(link) {
  const source = linkEndpointId(link.source);
  const target = linkEndpointId(link.target);
  return source === authorMapState.selectedId || target === authorMapState.selectedId;
}

function nodeRadius(node, scale) {
  return Math.max(3.8 / Math.max(scale, 0.001), Math.min(11, 2.8 + Math.sqrt(node.paperCount || 1) * 1.7));
}

function drawAuthorNode(node, context, scale) {
  const radius = nodeRadius(node, scale);
  const selected = node.id === authorMapState.selectedId;
  const hovered = node.id === authorMapState.hoverId;
  const adjacent = selected && node.adjacent;
  if (selected || hovered) {
    context.save();
    context.beginPath();
    context.arc(node.x, node.y, radius + 5.5, 0, Math.PI * 2);
    context.fillStyle = selected ? "rgba(106,165,147,0.18)" : "rgba(255,255,255,0.78)";
    context.fill();
    context.restore();
  }
  context.beginPath();
  context.arc(node.x, node.y, radius, 0, Math.PI * 2);
  context.fillStyle = colorForValue(node.group);
  context.globalAlpha = selected || hovered ? 1 : adjacent ? 0.86 : 0.68;
  context.fill();
  context.globalAlpha = 1;
  if (selected || hovered) {
    context.lineWidth = selected ? 1.7 : 1.1;
    context.strokeStyle = selected ? "rgba(79,133,118,0.95)" : "rgba(255,255,255,0.94)";
    context.stroke();
  }
  if (!selected && !hovered) return;
  const maxLength = 34;
  const label = node.title.length > maxLength ? `${node.title.slice(0, maxLength - 1)}…` : node.title;
  const fontSize = Math.max(9, Math.min(13, 11 / Math.max(scale, 0.7)));
  context.font = `700 ${fontSize}px "Hanken Grotesk", system-ui, sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  const labelX = node.x + radius + 5;
  const width = context.measureText(label).width;
  context.fillStyle = "rgba(255,255,255,0.88)";
  context.fillRect(labelX - 3, node.y - fontSize * 0.72, width + 6, fontSize * 1.42);
  context.fillStyle = "rgba(37,40,43,0.92)";
  context.fillText(label, labelX, node.y);
}

function renderDetail(target, network, records, onOpenRecord) {
  const node = network.nodes.find((item) => item.id === authorMapState.selectedId);
  if (!node) {
    target.innerHTML = `
      <div class="author-map-empty">
        <p class="eyebrow">Coauthorship network</p>
        <h3>Choose an author</h3>
        <p>Nodes represent conservatively resolved authors with at least two unique accepted works. Links represent coauthored works.</p>
      </div>
    `;
    return;
  }
  const nodeById = new Map(network.nodes.map((item) => [item.id, item]));
  const collaborators = (network.neighborsById.get(node.id) || [])
    .map((neighbor) => ({ ...neighbor, node: nodeById.get(neighbor.id) }))
    .filter((neighbor) => neighbor.node)
    .slice(0, 10);
  const recordsById = recordById(records);
  const papers = node.recordIds.map((id) => recordsById.get(id)).filter(Boolean).slice(0, 10);
  target.innerHTML = `
    <article class="author-map-detail-card">
      <p class="eyebrow">Resolved author</p>
      <h3>${escapeHtml(node.title)}</h3>
      <p class="author-map-detail-summary"><b>${Number(node.paperCount).toLocaleString()}</b> unique accepted works</p>
      <div class="author-map-topic-list">
        ${(node.topics || []).slice(0, 1).map((topic) => `<span><b>${escapeHtml(topic.label)}</b><em>${Number(topic.count).toLocaleString()}</em></span>`).join("") || "<small>No reviewed Core concept.</small>"}
      </div>
      <section>
        <h4>Frequent collaborators</h4>
        <div class="author-map-collaborators">
          ${collaborators.map((collaborator) => `
            <button type="button" data-author-id="${escapeHtml(collaborator.id)}">
              <span><i style="background:${escapeHtml(colorForValue(collaborator.node.group))}"></i>${escapeHtml(collaborator.node.title)}</span>
              <em>${Number(collaborator.workCount).toLocaleString()} works</em>
            </button>
          `).join("") || "<small>No mapped recurring collaborators.</small>"}
        </div>
      </section>
      <section>
        <h4>Accepted works</h4>
        <div class="author-map-paper-list">
          ${papers.map((record) => `
            <button type="button" data-record-id="${escapeHtml(record.id)}">
              <strong>${escapeHtml(plainMathTitle(record.title))}</strong>
              <small>${escapeHtml(researchConceptTags(record, "detail").join(" · ") || "No reviewed research concepts.")}</small>
            </button>
          `).join("") || "<small>No linked work in the loaded index.</small>"}
        </div>
      </section>
    </article>
  `;
  target.querySelectorAll("[data-author-id]").forEach((button) => button.addEventListener("click", () => selectAuthor(button.dataset.authorId, network, records, onOpenRecord)));
  target.querySelectorAll("[data-record-id]").forEach((button) => button.addEventListener("click", () => onOpenRecord(button.dataset.recordId)));
}

function selectAuthor(id, network, records, onOpenRecord) {
  authorMapState.selectedId = id;
  const selected = network.nodes.find((node) => node.id === id);
  network.nodes.forEach((node) => {
    node.adjacent = Boolean(selected && (network.neighborsById.get(selected.id) || []).some((neighbor) => neighbor.id === node.id));
  });
  authorMapState.graph?.refresh?.();
  renderDetail(document.querySelector("#authorMapDetail"), network, records, onOpenRecord);
  if (selected?.x !== undefined && selected?.y !== undefined) {
    authorMapState.graph?.centerAt?.(selected.x, selected.y, 360);
    authorMapState.graph?.zoom?.(2.6, 360);
  }
}

function mountGraph(target, network, records, onOpenRecord) {
  const canvas = target.querySelector("#authorMapCanvas");
  if (!canvas) return;
  if (typeof window.ForceGraph !== "function") {
    canvas.innerHTML = `<div class="empty-state"><strong>Author graph unavailable</strong><span>The graph library did not load.</span></div>`;
    return;
  }
  if (authorMapState.graphTarget !== canvas) {
    authorMapState.graph?.pauseAnimation?.();
    canvas.innerHTML = "";
    authorMapState.graphTarget = canvas;
    authorMapState.graph = window.ForceGraph()(canvas)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .nodeLabel("")
      .nodeRelSize(1)
      .nodeVal((node) => node.paperCount)
      .nodeCanvasObject(drawAuthorNode)
      .nodePointerAreaPaint((node, color, context, scale) => {
        context.fillStyle = color;
        context.beginPath();
        context.arc(node.x, node.y, nodeRadius(node, scale) + 4, 0, Math.PI * 2);
        context.fill();
      })
      .linkWidth((link) => selectedLink(link) ? 1.65 : Math.min(1.2, 0.32 + Math.log2(Number(link.value || 1)) * 0.34))
      .linkColor((link) => selectedLink(link) ? "rgba(79,133,118,0.7)" : "rgba(113,119,125,0.26)")
      .linkDirectionalParticles((link) => selectedLink(link) ? 1 : 0)
      .linkDirectionalParticleWidth(0.75)
      .linkDirectionalParticleSpeed(0.004)
      .d3AlphaDecay(0.018)
      .d3VelocityDecay(0.32)
      .onNodeHover((node) => {
        authorMapState.hoverId = node?.id || "";
        canvas.style.cursor = node ? "pointer" : "default";
        authorMapState.graph?.refresh?.();
      })
      .onNodeClick((node) => selectAuthor(node.id, network, records, onOpenRecord));
    authorMapState.graph.d3Force("charge")?.strength(-18);
    authorMapState.graph.d3Force("link")?.distance(32);
  }
  const width = canvas.clientWidth || 840;
  const height = canvas.clientHeight || 680;
  authorMapState.graph.width(width).height(height).graphData({ nodes: network.nodes, links: network.links });
}

function mountAuthorMap(target, network, records, onOpenRecord) {
  const visible = filteredGraph(network);
  if (authorMapState.selectedId && !visible.nodes.some((node) => node.id === authorMapState.selectedId)) authorMapState.selectedId = "";
  target.innerHTML = `
    <section class="author-map-dashboard">
      <header class="author-map-head">
        <div>
          <p class="eyebrow">Authorship intelligence</p>
          <h2>Author map</h2>
        </div>
        <div class="author-map-controls">
          <label><span>Scope</span><select id="authorMapScope"><option value="all">All accepted works</option><option value="main">Main conference</option><option value="workshop">Workshops</option></select></label>
          <label><span>Find</span><input id="authorMapSearch" type="search" value="${escapeHtml(authorMapState.query)}" placeholder="Author or topic" autocomplete="off" /></label>
        </div>
      </header>
      <div class="author-map-method-note" role="note"><strong>Reading the graph</strong><span>Only authors with at least two unique accepted works are shown. Node size = work count; colour = primary reviewed Core concept; link width = repeated coauthorship strength.${authorMapState.query ? ` Search currently shows ${Number(visible.nodes.length).toLocaleString()} matching or adjacent identities; same-name identities stay separate without email or shared-coauthor evidence.` : ""}</span></div>
      <section class="author-map-insights" aria-label="Conference-wide author insights">
        <div class="author-map-insights-head"><p class="eyebrow">Conference overview</p><span>Computed from ${Number(network.summary.uniqueWorks).toLocaleString()} unique accepted works in this scope</span></div>
        <div class="author-map-insight-grid">
          ${network.insights.prolificAuthor ? `<button type="button" data-insight-author-id="${escapeHtml(network.insights.prolificAuthor.id)}"><em>Most prolific mapped author</em><strong>${escapeHtml(network.insights.prolificAuthor.name)}</strong><span>${Number(network.insights.prolificAuthor.workCount).toLocaleString()} works · ${escapeHtml(network.insights.prolificAuthor.topic)}</span></button>` : ""}
          ${network.insights.strongestPair ? `<article><em>Strongest recurring collaboration</em><strong>${escapeHtml(network.insights.strongestPair.source)} × ${escapeHtml(network.insights.strongestPair.target)}</strong><span>${Number(network.insights.strongestPair.workCount).toLocaleString()} shared accepted works</span></article>` : ""}
          ${network.insights.connector ? `<button type="button" data-insight-author-id="${escapeHtml(network.insights.connector.id)}"><em>Broadest mapped connector</em><strong>${escapeHtml(network.insights.connector.name)}</strong><span>${Number(network.insights.connector.collaboratorCount).toLocaleString()} direct mapped collaborators · ${Number(network.insights.connector.workCount).toLocaleString()} works</span></button>` : ""}
          <article><em>Leading mapped topic</em><strong>${escapeHtml(network.insights.leadingTopic.label)}</strong><span>Primary topic for ${Number(network.insights.leadingTopic.authorCount).toLocaleString()} mapped authors</span></article>
        </div>
      </section>
      <div class="selection-stat-grid author-map-stat-grid">
        <span><strong>${Number(visible.summary.authorCount).toLocaleString()}</strong><small>mapped authors</small></span>
        <span><strong>${Number(visible.summary.linkCount).toLocaleString()}</strong><small>coauthor links</small></span>
        <span><strong>${Number(visible.summary.uniqueWorks).toLocaleString()}</strong><small>unique works in scope</small></span>
        <span><strong>≥${Number(visible.summary.minWorks)}</strong><small>works per author</small></span>
      </div>
      <div class="author-map-body">
        <div class="author-map-stage"><div id="authorMapCanvas" aria-label="Author coauthorship graph"></div><p>Click an author to inspect their topics, works, and frequent collaborators.</p></div>
        <aside id="authorMapDetail" class="author-map-detail" aria-label="Selected author"></aside>
      </div>
    </section>
  `;
  target.querySelector("#authorMapScope").value = authorMapState.scope;
  target.querySelector("#authorMapScope").addEventListener("change", (event) => {
    authorMapState.scope = event.target.value;
    authorMapState.selectedId = "";
    void renderAuthorMap(target, authorMapState.records, authorMapState.analysisArtifact, onOpenRecord);
  });
  target.querySelector("#authorMapSearch").addEventListener("input", (event) => {
    authorMapState.query = event.target.value;
    authorMapState.selectedId = "";
    mountAuthorMap(target, network, records, onOpenRecord);
    target.querySelector("#authorMapSearch")?.focus();
  });
  mountGraph(target, visible, records, onOpenRecord);
  renderDetail(target.querySelector("#authorMapDetail"), visible, records, onOpenRecord);
  target.querySelectorAll("[data-insight-author-id]").forEach((button) => button.addEventListener("click", () => {
    authorMapState.query = "";
    mountAuthorMap(target, network, records, onOpenRecord);
    selectAuthor(button.dataset.insightAuthorId, network, records, onOpenRecord);
  }));
}

export async function renderAuthorMap(target, records, analysisArtifact, onOpenRecord) {
  if (!target || !records) return;
  if (authorMapState.records !== records || authorMapState.analysisArtifact !== analysisArtifact) {
    authorMapState.records = records;
    authorMapState.analysisArtifact = analysisArtifact;
    authorMapState.cache.clear();
  }
  const token = ++authorMapState.renderToken;
  let network = authorMapState.cache.get(authorMapState.scope);
  if (!network) {
    const analytics = analysisArtifact?.scopes?.[authorMapState.scope];
    if (!analytics) {
      target.innerHTML = `<div class="empty-state"><strong>Finalized author map pending</strong><span>This graph activates after the complete reviewed-concept artifact and its matching author/topic analysis artifact are published.</span></div>`;
      return;
    }
    network = buildAuthorNetworkFromAnalytics(analytics);
    authorMapState.cache.set(authorMapState.scope, network);
  }
  if (token !== authorMapState.renderToken || !target.isConnected) return;
  mountAuthorMap(target, network, scopeRecords(records, authorMapState.scope), onOpenRecord);
}

export function destroyAuthorMap() {
  authorMapState.graph?.pauseAnimation?.();
  authorMapState.graph = null;
  authorMapState.graphTarget = null;
}
