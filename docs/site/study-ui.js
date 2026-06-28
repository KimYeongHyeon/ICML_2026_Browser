import { mapRecordById } from "./map-core.js";
import { state } from "./state.js";
import { escapeHtml, plainMathTitle } from "./utils.js";

const STAGE_LABELS = {
  intro: "Intro",
  core: "Core",
  applied: "Applied",
  broader: "Broader",
};

function tagList(record) {
  return [...new Set([...(record?.areaTags || []), ...(record?.domainTags || [])])];
}

function sharedTags(left, right) {
  const leftTags = new Set(tagList(left));
  return tagList(right).filter((tag) => leftTags.has(tag)).slice(0, 4);
}

function differentTags(left, right) {
  const leftTags = new Set(tagList(left));
  return tagList(right).filter((tag) => !leftTags.has(tag)).slice(0, 4);
}

function bridgeRecords(left, right, findRecord) {
  const mapById = mapRecordById();
  const leftNeighbors = mapById.get(left.id)?.nearestNeighbors || [];
  const rightNeighborIds = new Set((mapById.get(right.id)?.nearestNeighbors || []).map((item) => item.id));
  const shared = leftNeighbors
    .filter((item) => rightNeighborIds.has(item.id))
    .map((item) => findRecord(item.id))
    .filter(Boolean);
  if (shared.length) return shared.slice(0, 4);
  const nearest = leftNeighbors.concat(mapById.get(right.id)?.nearestNeighbors || [])
    .map((item) => findRecord(item.id))
    .filter((record, index, records) => record && record.id !== left.id && record.id !== right.id && records.findIndex((candidate) => candidate.id === record.id) === index)
    .slice(0, 4);
  if (nearest.length) return nearest;
  return (state.studyFeatures?.records?.[left.id]?.studyTrail || [])
    .map((item) => findRecord(item.recordId))
    .filter((record) => record && record.id !== left.id && record.id !== right.id)
    .slice(0, 4);
}

export function renderStudyTrail(record, study, findRecord) {
  const trail = (study?.studyTrail || []).map((item) => ({ ...item, record: findRecord(item.recordId) })).filter((item) => item.record);
  if (!trail.length) return "";
  return `
    <section class="study-trail selection-stat-block">
      <strong>Study Trail</strong>
      <div class="study-trail-list">
        ${trail.map((item, index) => `
          <button type="button" class="neighbor-item study-trail-item" data-study-id="${escapeHtml(item.record.id)}">
            <span class="neighbor-rank">${index + 1}</span>
            <span class="neighbor-main">
              <em>${escapeHtml(STAGE_LABELS[item.stage] || item.stage)}</em>
              <strong>${escapeHtml(plainMathTitle(item.record.title))}</strong>
              <small class="why-line">${escapeHtml(item.reason || "related reading step")}</small>
            </span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

export function renderSemanticCompare(record, study, findRecord) {
  const candidates = (study?.compareCandidates || []).map((item) => ({ ...item, record: findRecord(item.recordId) })).filter((item) => item.record);
  if (!candidates.length) return "";
  const targetId = state.studyCompareSourceId === record.id ? state.studyCompareTargetId : "";
  const target = findRecord(targetId);
  return `
    <section class="semantic-compare selection-stat-block">
      <strong>Semantic Compare</strong>
      <div class="trend-representatives semantic-compare-controls">
        ${candidates.slice(0, 3).map((item) => `
          <button type="button" class="compare-candidate" data-compare-id="${escapeHtml(item.record.id)}">
            ${escapeHtml(plainMathTitle(item.record.title))}
          </button>
        `).join("")}
      </div>
      ${target ? renderCompareResult(record, target, findRecord) : "<small>Pick a candidate for common topic, differences, and bridging papers.</small>"}
    </section>
  `;
}

function renderCompareResult(record, target, findRecord) {
  const common = sharedTags(record, target);
  const differences = differentTags(record, target);
  const bridges = bridgeRecords(record, target, findRecord);
  return `
    <div class="semantic-compare-result">
      <span><em>Common topic</em><b>${escapeHtml(common.join(", ") || record.embeddingClusterLabel || record.clusterLabel || "nearby embedding region")}</b></span>
      <span><em>Differences</em><b>${escapeHtml(differences.join(", ") || "different emphasis inside the same area")}</b></span>
      <div class="semantic-bridge-list">
        <em>Bridging papers</em>
        ${bridges.map((bridge) => `<button type="button" class="semantic-bridge" data-study-id="${escapeHtml(bridge.id)}">${escapeHtml(plainMathTitle(bridge.title))}</button>`).join("") || "<small>No bridge paper found in the current neighbor lists.</small>"}
      </div>
    </div>
  `;
}

export function renderStudyPanel(record, study, findRecord) {
  if (!study) return "";
  return `${renderStudyTrail(record, study, findRecord)}${renderSemanticCompare(record, study, findRecord)}`;
}

export function renderUnusualDirections(studyFeatures, findRecord, limit = 4) {
  const items = (studyFeatures?.outliers || []).map((item) => ({ ...item, record: findRecord(item.recordId) })).filter((item) => item.record).slice(0, limit);
  if (!items.length) return "";
  return `
    <section class="unusual-directions selection-stat-block">
      <strong>Unusual directions</strong>
      ${items.map((item) => `
        <button type="button" class="neighbor-item study-trail-item" data-study-id="${escapeHtml(item.record.id)}">
          <span class="neighbor-main">
            <strong>${escapeHtml(plainMathTitle(item.record.title))}</strong>
            <small class="why-line">${escapeHtml(item.reason || "far from its cluster center")}</small>
          </span>
        </button>
      `).join("")}
    </section>
  `;
}
