import { buildPeopleAnalytics } from "./people-analytics.mjs";
import { escapeHtml, plainMathTitle } from "./utils.js";

const dashboardState = {
  mode: "authors",
  scope: "all",
  query: "",
  selectedIndex: 0,
  records: null,
  cache: new Map(),
  renderToken: 0,
};

function scopeRecords(records, scope) {
  if (scope === "workshop") return records.filter((record) => record.type === "workshop");
  if (scope === "main") return records.filter((record) => record.type === "paper" || record.type === "poster");
  return records;
}

function topicBars(topics = []) {
  const max = Math.max(1, ...topics.map((topic) => topic.count));
  return topics.map((topic) => `
    <span class="people-topic-row">
      <span><b>${escapeHtml(topic.label)}</b><small>${Number(topic.count).toLocaleString()}</small></span>
      <i style="--topic-share:${Math.round((topic.count / max) * 100)}%"></i>
    </span>
  `).join("") || "<small>No topic tags available.</small>";
}

function entityLabel(entity, mode) {
  if (mode === "authors") return entity.name;
  return entity.members.slice(0, 3).join(" · ");
}

function entitySearchText(entity, mode) {
  const names = mode === "authors" ? [entity.name, ...(entity.aliases || [])] : entity.members;
  return [...names, ...(entity.topics || []).map((topic) => topic.label)].join(" ").toLocaleLowerCase();
}

function renderDetail(entity, mode, recordById) {
  if (!entity) return `<div class="empty-state"><strong>No matching entity</strong><span>Adjust the people search.</span></div>`;
  const label = entityLabel(entity, mode);
  const aliases = mode === "authors" && entity.aliases?.length > 1
    ? `<p class="people-aliases"><b>Name variants</b>${entity.aliases.map(escapeHtml).join(" · ")}</p>`
    : "";
  const members = mode === "groups"
    ? `<div class="people-members">${entity.members.map((member) => `<span>${escapeHtml(member)}</span>`).join("")}</div>`
    : "";
  const papers = entity.recordIds.map((id) => recordById.get(id)).filter(Boolean).slice(0, 16);
  return `
    <section class="people-detail-card">
      <p class="eyebrow">${mode === "authors" ? "Resolved author" : "Repeated coauthor community"}</p>
      <h3>${escapeHtml(label)}</h3>
      <p class="people-detail-summary"><b>${Number(entity.paperCount).toLocaleString()}</b> unique accepted works in this scope</p>
      ${aliases}
      ${members}
      <div class="people-detail-grid">
        <div>
          <h4>Topic concentration</h4>
          <div class="people-topic-bars">${topicBars(entity.topics)}</div>
        </div>
        <div>
          <h4>Accepted works</h4>
          <div class="people-paper-list">
            ${papers.map((record) => `
              <button type="button" data-record-id="${escapeHtml(record.id)}">
                <strong>${escapeHtml(plainMathTitle(record.title))}</strong>
                <small>${escapeHtml((record.areaTags || record.categoryTags || []).slice(0, 2).join(" · ") || record.group || "ICML 2026")}</small>
              </button>
            `).join("") || "<small>No linked work in the loaded index.</small>"}
          </div>
        </div>
      </div>
    </section>
  `;
}

function mountDashboard(target, analytics, records, onOpenRecord) {
  const entities = dashboardState.mode === "authors" ? analytics.authors : analytics.groups;
  const query = dashboardState.query.trim().toLocaleLowerCase();
  const matching = entities.filter((entity) => !query || entitySearchText(entity, dashboardState.mode).includes(query));
  const visible = matching.slice(0, 100);
  const selected = visible[dashboardState.selectedIndex] || visible[0];
  const recordById = new Map(records.map((record) => [record.id, record]));
  target.innerHTML = `
    <section class="people-dashboard">
      <header class="people-dashboard-head">
        <div>
          <p class="eyebrow">Authorship intelligence</p>
          <h2>People & research groups</h2>
        </div>
        <label class="people-scope">
          <span>Scope</span>
          <select id="peopleScope">
            <option value="all"${dashboardState.scope === "all" ? " selected" : ""}>All accepted works</option>
            <option value="main"${dashboardState.scope === "main" ? " selected" : ""}>Main conference</option>
            <option value="workshop"${dashboardState.scope === "workshop" ? " selected" : ""}>Workshops</option>
          </select>
        </label>
      </header>
      <div class="people-method-note" role="note">
        <strong>Identity method</strong>
        <span>Email is the primary key when present; otherwise normalized names are merged only when their coauthor context overlaps. Current public records contain ${Number(analytics.summary.emailIdentityCount).toLocaleString()} email-backed identities.</span>
      </div>
      <div class="selection-stat-grid people-stat-grid">
        <span><strong>${Number(analytics.summary.uniqueWorks).toLocaleString()}</strong><small>unique works</small></span>
        <span><strong>${Number(analytics.summary.authorCount).toLocaleString()}</strong><small>resolved identities</small></span>
        <span><strong>${Number(analytics.summary.groupCount).toLocaleString()}</strong><small>coauthor communities</small></span>
        <span><strong>${Number(analytics.summary.emailIdentityCount).toLocaleString()}</strong><small>email-backed</small></span>
      </div>
      <div class="people-toolbar">
        <div class="people-mode" role="group" aria-label="Analysis unit">
          <button type="button" data-mode="authors" class="${dashboardState.mode === "authors" ? "is-active" : ""}">Authors</button>
          <button type="button" data-mode="groups" class="${dashboardState.mode === "groups" ? "is-active" : ""}">Collaboration groups</button>
        </div>
        <label class="people-search">
          <span>Find</span>
          <input id="peopleSearch" type="search" value="${escapeHtml(dashboardState.query)}" placeholder="Name or topic" autocomplete="off" />
        </label>
      </div>
      ${dashboardState.mode === "groups" ? `
        <p class="people-proxy-note"><b>Research-lab proxy:</b> these are connected groups where author pairs appear together on at least two unique works. They are not verified institutional affiliations.</p>
      ` : ""}
      <div class="people-analysis-grid">
        <div class="people-ranking" aria-label="Ranked people analysis">
          ${visible.map((entity, index) => `
            <button type="button" data-entity-index="${index}" class="${entity === selected ? "is-active" : ""}">
              <span class="neighbor-rank">${index + 1}</span>
              <span>
                <strong>${escapeHtml(entityLabel(entity, dashboardState.mode))}</strong>
                <small>${Number(entity.paperCount).toLocaleString()} works · ${(entity.topics || []).slice(0, 2).map((topic) => escapeHtml(topic.label)).join(" · ") || "unclassified"}</small>
              </span>
              ${dashboardState.mode === "groups" ? `<em>${Number(entity.members.length).toLocaleString()} people</em>` : ""}
            </button>
          `).join("") || `<div class="empty-state compact"><strong>No matches</strong><span>Try another name or topic.</span></div>`}
          ${matching.length > visible.length ? `<small class="people-result-limit">Showing the first ${visible.length.toLocaleString()} of ${matching.length.toLocaleString()} matches.</small>` : ""}
        </div>
        <div id="peopleDetail">${renderDetail(selected, dashboardState.mode, recordById)}</div>
      </div>
    </section>
  `;

  target.querySelector("#peopleScope")?.addEventListener("change", (event) => {
    dashboardState.scope = event.target.value;
    dashboardState.selectedIndex = 0;
    void renderPeopleDashboard(target, dashboardState.records, onOpenRecord);
  });
  target.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    dashboardState.mode = button.dataset.mode;
    dashboardState.selectedIndex = 0;
    mountDashboard(target, analytics, records, onOpenRecord);
  }));
  target.querySelector("#peopleSearch")?.addEventListener("input", (event) => {
    dashboardState.query = event.target.value;
    dashboardState.selectedIndex = 0;
    mountDashboard(target, analytics, records, onOpenRecord);
    target.querySelector("#peopleSearch")?.focus();
  });
  target.querySelectorAll("[data-entity-index]").forEach((button) => button.addEventListener("click", () => {
    dashboardState.selectedIndex = Number(button.dataset.entityIndex);
    mountDashboard(target, analytics, records, onOpenRecord);
  }));
  target.querySelectorAll("[data-record-id]").forEach((button) => button.addEventListener("click", () => onOpenRecord(button.dataset.recordId)));
}

export async function renderPeopleDashboard(target, records, onOpenRecord) {
  if (!target || !records) return;
  if (dashboardState.records !== records) {
    dashboardState.records = records;
    dashboardState.cache.clear();
  }
  const token = ++dashboardState.renderToken;
  let analytics = dashboardState.cache.get(dashboardState.scope);
  const scoped = scopeRecords(records, dashboardState.scope);
  if (!analytics) {
    target.innerHTML = `<div class="empty-state"><strong>Resolving author identities</strong><span>Deduplicating works, email keys, and coauthor neighborhoods.</span></div>`;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    analytics = buildPeopleAnalytics(scoped);
    dashboardState.cache.set(dashboardState.scope, analytics);
  }
  if (token !== dashboardState.renderToken || !target.isConnected) return;
  mountDashboard(target, analytics, scoped, onOpenRecord);
}
