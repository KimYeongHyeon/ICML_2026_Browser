# Topic Explorer UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing ICML 2026 Map and People surfaces into an evidence-preserving path from a semantic landscape or reviewed Core-concept label to the matching papers, without inventing time-series claims or an unvalidated taxonomy.

**Architecture:** Keep the existing index, concept, people, and embedding-map artifacts unchanged. Add one small pure landscape-filter helper, store the selected embedding-cluster id separately from the existing colour legend filter, and inject a People-to-Map callback from `app.js`. The Map remains the paper-evidence surface; People remains corpus prevalence and authorship analysis; Author Map remains a clearly limited recurring-coauthor supplement.

**Tech Stack:** Browser-native ES modules, existing ForceGraph UI, Node 24 `node:test`, existing CSS tokens and responsive rules.

## Global Constraints

- Reuse the existing Map, People, Author Map, `author-map-insights`, `trend-card`, button, focus, and responsive CSS patterns; add no dependencies and no new top-level tab.
- Treat the corpus as a single ICML 2026 snapshot. New user-visible copy must not claim growth, rising/emerging topics, momentum, impact, or official ICML subject areas.
- Do not create a curated broad-topic taxonomy or new analytics artifact: exact reviewed Core labels are intentionally fine-grained and must not be misrepresented as conference-wide research areas.
- Preserve fail-closed artifact loading and all concept/index provenance checks. No raw email or affiliation/lab claim may be added.
- Keep the existing 20-result People pagination and keyboard-operable paper routes intact.
- Use the bundled Node runtime `/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` for Node tests; macOS system Node 18 cannot import this ESM graph reliably.

---

### Task 1: Exact semantic-landscape filtering in Map

**Files:**
- Create: `docs/site/map-landscape.mjs`
- Modify: `docs/site/state.js:39-49`
- Modify: `docs/site/browse.js:90-115`
- Modify: `docs/site/map-detail.js:75-126`
- Modify: `docs/site/app.js:126-171,1038-1050,1057-1074`
- Modify: `docs/site/styles.css:3154-3405`
- Test: `scripts/test_map_landscape.mjs`

**Interfaces:**
- Produces `matchesLandscapeCluster(record, landscapeClusterId): boolean` from `docs/site/map-landscape.mjs`.
- Produces `state.mapLandscapeFilterId: string` and `state.mapLandscapeFilterName: string`.
- Consumes Map trend objects with `id`, `clusterId`, `name`, and `size`.
- The Map detail event emits a `data-landscape-cluster-id` and `data-landscape-name` action; `app.js` owns state mutation and rerendering.

- [ ] **Step 1: Write the failing pure filter tests**

Create `scripts/test_map_landscape.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { matchesLandscapeCluster } from "../docs/site/map-landscape.mjs";

test("matchesLandscapeCluster keeps only the selected base embedding cluster", () => {
  const selected = { id: "a", embeddingClusterId: "cluster-7" };
  const other = { id: "b", embeddingClusterId: "cluster-8" };

  assert.equal(matchesLandscapeCluster(selected, "cluster-7"), true);
  assert.equal(matchesLandscapeCluster(other, "cluster-7"), false);
});

test("matchesLandscapeCluster does not filter when no landscape is selected", () => {
  assert.equal(matchesLandscapeCluster({ embeddingClusterId: "cluster-7" }, ""), true);
});
```

- [ ] **Step 2: Verify the test fails for the missing module**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_map_landscape.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `docs/site/map-landscape.mjs`.

- [ ] **Step 3: Implement the minimal pure filter**

Create `docs/site/map-landscape.mjs`:

```js
export function matchesLandscapeCluster(record, landscapeClusterId = "") {
  return !landscapeClusterId || record?.embeddingClusterId === landscapeClusterId;
}
```

In `docs/site/state.js`, add adjacent to `mapFilterValue`:

```js
  mapLandscapeFilterId: "",
  mapLandscapeFilterName: "",
```

In `docs/site/browse.js`, import `matchesLandscapeCluster`, and in `passesActiveFilters` after the existing map colour check add:

```js
  if (!ignoreMapFilter && state.tab === "map" && !matchesLandscapeCluster(record, state.mapLandscapeFilterId)) return false;
```

Do not overload `mapFilterValue`: it compares the current display-colour label and is intentionally independent of the base embedding cluster id.

- [ ] **Step 4: Render a clear, evidence-first Map action**

In `renderTrendCards()` in `docs/site/map-detail.js`:

1. Replace the panel copy with exactly:

```html
<p class="eyebrow">ICML 2026 research landscape</p>
<h3>Semantic concentrations</h3>
<p class="trend-basis-note">Single-conference snapshot from title+abstract embedding clusters. Sizes describe coverage in this corpus, not temporal growth, momentum, or official ICML areas.</p>
```

2. Keep the existing representative-paper button unchanged.
3. Add after `trend-study-section`:

```html
<button class="trend-explore-cluster" type="button"
  data-landscape-cluster-id="${escapeHtml(trend.clusterId || "")}"
  data-landscape-name="${escapeHtml(trend.name || trend.clusterLabel || "Semantic concentration")}">
  Explore this cluster <span>${Number(trend.size || 0).toLocaleString()} mapped records</span>
</button>
```

4. Add a compact selected-state section at the top of the panel when `state.mapLandscapeFilterId` is set:

```html
<div class="landscape-filter-state" role="status">
  <span>Landscape: <b>${escapeHtml(state.mapLandscapeFilterName)}</b></span>
  <button type="button" data-clear-landscape>Clear landscape</button>
</div>
```

Use the existing `escapeHtml` and `state` imports; do not interpolate unescaped artifact content.

- [ ] **Step 5: Wire state and clear behavior in `app.js`**

Extend the existing `els.mapDetail` click delegation so it handles both existing representative selectors and the new controls:

```js
const landscapeButton = event.target.closest("[data-landscape-cluster-id]");
if (landscapeButton) {
  state.mapLandscapeFilterId = landscapeButton.dataset.landscapeClusterId || "";
  state.mapLandscapeFilterName = landscapeButton.dataset.landscapeName || "Semantic concentration";
  state.selectedId = "";
  clearMapSelection();
  resetResultWindow();
  renderMap();
  return;
}
if (event.target.closest("[data-clear-landscape]")) {
  state.mapLandscapeFilterId = "";
  state.mapLandscapeFilterName = "";
  state.selectedId = "";
  clearMapSelection();
  resetResultWindow();
  renderMap();
  return;
}
```

In `renderMap()`, include `state.mapLandscapeFilterName` in `activeFilterSummary` after `state.mapFilterValue`. On ordinary tab changes, clear both landscape fields with the other Map-only controls. Do not clear them from `applyFilterChange()` or map-colour/cluster-level controls; the selected base cluster remains valid while the visual colouring changes.

- [ ] **Step 6: Add minimal visual styling using existing tokens**

Add `.trend-explore-cluster` and `.landscape-filter-state` rules next to existing `.trend-card` styles. The action must use the project button border/radius/focus treatment, wrap at 390px, and show the record count as muted secondary text. Do not add a new colour palette or fixed widths.

- [ ] **Step 7: Verify green and commit**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_map_landscape.mjs scripts/test_research_concepts.mjs scripts/test_people_concepts.mjs scripts/test_people_analytics.mjs scripts/test_people_topics_artifact.mjs scripts/test_data_loader.mjs
git diff --check
git add docs/site/map-landscape.mjs docs/site/state.js docs/site/browse.js docs/site/map-detail.js docs/site/app.js docs/site/styles.css scripts/test_map_landscape.mjs
git commit -m "feat: add exact map landscape filter"
```

Expected: all Node tests pass, `git diff --check` has no output, and one focused commit exists.

### Task 2: Convert passive Core-concept prevalence into a People-to-Map handoff

**Files:**
- Modify: `docs/site/people-dashboard.mjs:49-67,107-218`
- Modify: `docs/site/app.js:863-872`
- Modify: `docs/site/styles.css:1286-1630,4239-4305`
- Test: `scripts/test_people_topic_handoff.mjs`

**Interfaces:**
- `renderPeopleDashboard(target, records, analysisArtifact, onOpenRecord, onExploreTopic)` accepts optional `onExploreTopic(topicLabel)`.
- `app.js` supplies an `openPeopleTopicOnMap(topicLabel)` callback that sets `state.tab = "map"`, sets the Map query, and calls `renderAll()`.
- People topic cards contain `data-people-topic` and use native buttons with `aria-label`.

- [ ] **Step 1: Write the failing topic-card markup test**

Export `renderTopicTrends` from `docs/site/people-dashboard.mjs` and create `scripts/test_people_topic_handoff.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { renderTopicTrends } from "../docs/site/people-dashboard.mjs";

test("renderTopicTrends exposes reviewed Core concepts as keyboard-operable map actions", () => {
  const html = renderTopicTrends({
    note: "Single-year prevalence; no temporal growth claim.",
    topics: [{ label: "Concept erasure", workCount: 3, workShare: 0.25 }],
  });

  assert.match(html, /Topics in this 2026 corpus/);
  assert.match(html, /data-people-topic="Concept erasure"/);
  assert.match(html, /type="button"/);
  assert.match(html, /Explore related papers on Map/);
  assert.doesNotMatch(html, /trend|growth|rising|momentum/i);
});
```

- [ ] **Step 2: Verify the test fails for missing export and existing copy**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_people_topic_handoff.mjs
```

Expected: failure because `renderTopicTrends` is not exported or because the static markup does not contain the required action.

- [ ] **Step 3: Make every current concept card a real Map action**

Change `renderTopicTrends` to export it and to render:

```html
<section class="author-map-insights people-topic-trends" aria-label="Topics in this 2026 corpus">
  <div class="author-map-insights-head">
    <p class="eyebrow">Topics in this 2026 corpus</p>
    <span>${escaped note}</span>
  </div>
  <div class="author-map-insight-grid">
    <button type="button" data-people-topic="${escaped label}" aria-label="Explore ${escaped label} related papers on Map">
      <em>Reviewed Core concept · Rank ${rank}</em>
      <strong>${escaped label}</strong>
      <span>${workCount} unique works · ${share} of this scope</span>
      <small>Explore related papers on Map →</small>
    </button>
  </div>
</section>
```

Keep the existing pending card as a non-interactive `<article>`. Do not call the values a research area, field, or trend; the current provenance note remains visible.

- [ ] **Step 4: Inject and wire the handoff callback**

Update function signatures in `people-dashboard.mjs`:

```js
function mountDashboard(target, analytics, records, onOpenRecord, onExploreTopic) { /* existing body */ }
export async function renderPeopleDashboard(target, records, analysisArtifact, onOpenRecord, onExploreTopic) { /* pass through */ }
```

After the existing pagination listeners in `mountDashboard`, add:

```js
target.querySelectorAll("[data-people-topic]").forEach((button) => button.addEventListener("click", () => {
  onExploreTopic?.(button.dataset.peopleTopic || "");
}));
```

In `app.js`, define one helper before `renderAll()`:

```js
function openPeopleTopicOnMap(topicLabel) {
  const topic = String(topicLabel || "").trim();
  if (!topic) return;
  state.tab = "map";
  state.query = topic;
  state.selectedId = "";
  state.mapFilterValue = "";
  state.mapLandscapeFilterId = "";
  state.mapLandscapeFilterName = "";
  if (els.search) els.search.value = topic;
  if (els.mapSearch) els.mapSearch.value = topic;
  loadSearchEmbeddingsInBackground();
  renderAll();
}
```

Pass `openPeopleTopicOnMap` as the fifth argument in the People call within `renderAll()`. Preserve the existing semantic/lexical Map behavior rather than manufacturing an exact label-to-cluster relationship.

- [ ] **Step 5: Style and mobile-check the action**

Reuse `.author-map-insight-grid > button` styling. Add only a local `.people-topic-trends small` secondary-action rule. At the existing small-screen breakpoint, cards remain full-width and the action copy remains visible; do not rely on hover or colour alone. Existing global focus-visible styles must apply to the buttons.

- [ ] **Step 6: Verify green and commit**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_people_topic_handoff.mjs scripts/test_map_landscape.mjs scripts/test_research_concepts.mjs scripts/test_people_concepts.mjs scripts/test_people_analytics.mjs scripts/test_people_topics_artifact.mjs scripts/test_data_loader.mjs
git diff --check
git add docs/site/people-dashboard.mjs docs/site/app.js docs/site/styles.css scripts/test_people_topic_handoff.mjs
git commit -m "feat: connect people concepts to map exploration"
```

Expected: all Node tests pass and the handoff remains an isolated second commit.

### Task 3: Make the collaboration map an honest optional next step

**Files:**
- Modify: `docs/site/author-map.mjs:230-275`
- Modify: `docs/site/styles.css:1640-1820,4260-4315`
- Test: `scripts/test_author_map_disclosure.mjs`

**Interfaces:**
- `author-map.mjs` keeps `filterAuthorGraph()` behavior unchanged.
- The method note explicitly distinguishes selected topic matches from adjacent collaborator nodes when a search query is active.
- The static reading key declares that colours encode each author’s primary reviewed Core concept, not corpus prevalence.

- [ ] **Step 1: Write the failing disclosure test**

Create `scripts/test_author_map_disclosure.mjs` that reads `docs/site/author-map.mjs` as UTF-8 and asserts it includes all three exact visible disclosures:

```js
assert.match(source, /primary reviewed Core concept; this is an authorship view, not corpus prevalence/i);
assert.match(source, /topic matches plus their recurring mapped collaborators/i);
assert.match(source, /not verified institutional affiliations/i);
```

- [ ] **Step 2: Verify the disclosure test fails**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_author_map_disclosure.mjs
```

Expected: failure for the first two missing disclosures.

- [ ] **Step 3: Add concise honest copy without changing network membership**

In `renderTopicLegend`, add directly after `<strong>Topic colours</strong>`:

```html
<small>Primary reviewed Core concept; this is an authorship view, not corpus prevalence.</small>
```

In the `author-map-method-note`, replace the active-query suffix with:

```js
authorMapState.query ? ` Showing ${Number(visible.nodes.length).toLocaleString()} topic matches plus their recurring mapped collaborators; adjacent nodes are exploration context, not additional topic matches. Same-name identities stay separate without email or shared-coauthor evidence.` : ""
```

Retain the existing group/proxy sentence `They are not verified institutional affiliations.` exactly. Do not change `filterAuthorGraph`, graph limits, node encoding, or identity logic.

- [ ] **Step 4: Style the key for readable narrow layouts**

Add a `.author-map-reading-key small` rule beside the existing key styling: muted text, full available line width, readable 12px line-height, and wrapping without horizontal overflow at 390px. Do not change graph canvas size or make canvas interaction critical.

- [ ] **Step 5: Verify green and commit**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_author_map_disclosure.mjs scripts/test_people_topic_handoff.mjs scripts/test_map_landscape.mjs scripts/test_research_concepts.mjs scripts/test_people_concepts.mjs scripts/test_people_analytics.mjs scripts/test_people_topics_artifact.mjs scripts/test_data_loader.mjs
git diff --check
git add docs/site/author-map.mjs docs/site/styles.css scripts/test_author_map_disclosure.mjs
git commit -m "docs: clarify author map topic evidence"
```

Expected: all tests pass and the disclosure changes are independently reviewable.

### Task 4: Browser QA, regression gate, and review

**Files:**
- Modify: `scripts/verify_ui_smoke.mjs`
- Test: `scripts/verify_ui_smoke.mjs`, existing Node tests, site build output

**Interfaces:**
- Browser QA must use the generated site served locally, not source-only assertions.
- Map landscape filter and People-to-Map handoff must be exercised through their real buttons.

- [ ] **Step 1: Add browser assertions before implementation-specific changes**

Extend the existing smoke script with checks that:

```js
// Map: click [data-landscape-cluster-id], assert result count decreases or stays a valid nonzero subset,
// assert [data-clear-landscape] exists, click it, and assert the filter action disappears.
// People: click [data-people-topic], assert the active tab is Map and the map search value equals that topic label.
// Author Map: assert the reading key includes "not corpus prevalence".
```

The test must select visible controls by the new data attributes, not fragile card order or English text alone.

- [ ] **Step 2: Run the smoke command and fix only real regressions**

Run the repository’s documented local build and smoke commands:

```bash
./scripts/build_site.sh
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify_ui_smoke.mjs
```

Expected: the build completes and the smoke script exits `0`. If the local static server or browser prerequisite is absent, record the exact unavailable executable and run the remaining Node suite; do not weaken or delete the smoke assertions.

- [ ] **Step 3: Run full relevant regression suite and inspect changes**

Run:

```bash
/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/test_map_landscape.mjs scripts/test_people_topic_handoff.mjs scripts/test_author_map_disclosure.mjs scripts/test_research_concepts.mjs scripts/test_people_concepts.mjs scripts/test_people_analytics.mjs scripts/test_people_topics_artifact.mjs scripts/test_data_loader.mjs
python3 scripts/test_concept_review_status.py
git diff --check
git status --short
```

Expected: every command succeeds, no whitespace errors, and only Task 4 smoke-test files remain uncommitted.

- [ ] **Step 4: Commit QA coverage and request final review**

Run:

```bash
git add scripts/verify_ui_smoke.mjs
git commit -m "test: cover topic exploration handoffs"
git log --oneline origin/main..HEAD
```

Then dispatch a fresh reviewer with the base SHA `origin/main` and current `HEAD`, requiring it to check: no temporal claims, exact base-cluster filtering independent of Map colour level, keyboard-visible controls, no provenance/privacy regression, and 390px layout behavior.

## Self-Review

- **Spec coverage:** Task 1 gives a direct, exact landscape-to-paper route; Task 2 makes current concept prevalence actionable; Task 3 prevents the coauthor map from becoming a false topic/lab claim; Task 4 checks the real user flow. There is intentionally no time-series dashboard or new taxonomy because the data supports neither safely.
- **Placeholder scan:** no task says “TBD”, “appropriate”, or “similar to”; each has concrete selectors, command, and expected result.
- **Interface consistency:** `state.mapLandscapeFilterId` is introduced only in Task 1, `onExploreTopic` only in Task 2, and Task 3 has no network API change. Task 4 selects the same stable data attributes introduced in Tasks 1–2.

## Execution Handoff

The user selected Subagent-Driven execution. Implement one task at a time in `/tmp/icml-topic-explorer-ux`: a fresh implementer performs its TDD cycle and focused commit, then a fresh reviewer inspects that commit before the next task begins.
