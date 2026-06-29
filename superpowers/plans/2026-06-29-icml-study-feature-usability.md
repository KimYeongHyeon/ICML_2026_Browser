# ICML Study Feature Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each embedding study feature clear enough that a conference-reading user can discover it, understand what it means, and act on it without guessing.

**Architecture:** Keep the existing four top-level tabs: Papers / Workshops / Map / References. Improve feature-specific labels, deterministic explanations, clickable paths, and smoke coverage inside the existing viewer/map surfaces. Do not add a Study tab or new heavy artifact.

**Tech Stack:** Static browser app in vanilla JavaScript/CSS, offline JSON artifacts, Playwright smoke checks via `scripts/verify_ui_smoke.mjs`.

---

## Shared Constraints

- Do not touch unrelated files, especially `scripts/build_icml_references.py`.
- Preserve lazy loading of `docs/site/data/icml2026_study_features.json`.
- Avoid user-facing words that sound broken: `fallback`, bare `loading`, `novel`, `breakthrough`, `SOTA`.
- Prefer deletion/native HTML over custom controls.
- Verify with at least:
  - `bash scripts/verify_site_contract.sh`
  - `python3 scripts/test_study_features_units.py`
  - a focused browser smoke for the feature you changed

## Task 1: Reading Path / Study Trail

**Owner thread:** Study Trail usability.

**Files:**
- Modify: `docs/site/study-ui.js`
- Modify if needed: `docs/site/styles.css`
- Modify if needed: `scripts/verify_ui_smoke.mjs`

- [ ] Confirm a selected paper shows a collapsed `Study Trail` disclosure.
- [ ] Make the collapsed header self-explanatory without extra help icons.
- [ ] Ensure each item shows stage, title, and reason in a scannable order.
- [ ] Ensure clicking a trail item opens the existing viewer.
- [ ] Add or update smoke assertions that prove 5-10 items and all four stages appear.

Expected focused browser check:

```js
{
  tag: "DETAILS",
  countRange: "5..10",
  stages: ["Intro", "Core", "Applied", "Broader"],
  clickNavigatesViewer: true
}
```

## Task 2: Trend Cards

**Owner thread:** Trend Cards usability.

**Files:**
- Modify: `docs/site/map-detail.js`
- Modify if needed: `docs/site/styles.css`
- Modify if needed: `scripts/build_icml_trends.py`
- Modify if needed: `scripts/verify_ui_smoke.mjs`

- [ ] Make trend cards read as study guidance, not generic cluster prose.
- [ ] Surface these fields clearly: Core question, Method, Branches, First reads.
- [ ] Keep deterministic wording honest; do not imply LLM synthesis.
- [ ] Ensure first-read buttons open existing records.
- [ ] Add or update smoke assertions for all four study fields.

Expected focused browser check:

```js
{
  trendCardsVisible: true,
  hasCoreQuestion: true,
  hasMethod: true,
  hasBranches: true,
  firstReadButtons: ">=3"
}
```

## Task 3: Semantic Compare

**Owner thread:** Semantic Compare usability.

**Files:**
- Modify: `docs/site/study-ui.js`
- Modify if needed: `docs/site/styles.css`
- Modify if needed: `scripts/verify_ui_smoke.mjs`

- [ ] Make compare candidates obviously selectable.
- [ ] Keep result inline, not a modal.
- [ ] Show Common topic, Differences, and Bridging papers with clear labels.
- [ ] Ensure bridge paper clicks open the existing viewer.
- [ ] Add or update smoke assertions for result labels and bridge navigation.

Expected focused browser check:

```js
{
  compareCandidateButtons: ">=1",
  commonTopicVisible: true,
  differencesVisible: true,
  bridgeCount: ">=1",
  bridgeClickNavigatesViewer: true
}
```

## Task 4: Topic Lens

**Owner thread:** Topic Lens usability.

**Files:**
- Modify: `docs/site/semantic-insights.js`
- Modify if needed: `docs/site/map-core.js`
- Modify if needed: `docs/site/styles.css`
- Modify if needed: `scripts/verify_ui_smoke.mjs`

- [ ] When a map query is active, show Topic Lens near the highlighted region.
- [ ] Display area, domain, nearby trend, search mode, keywords, and 3 representative records.
- [ ] Do not show user-facing `fallback` or bare `loading`.
- [ ] Ensure representative record buttons open existing records.
- [ ] Add or update smoke assertions that search for `retrieval` and confirm no broken copy appears.

Expected focused browser check:

```js
{
  topicLensVisible: true,
  representativeButtons: 3,
  nearbyTrendNotLoading: true,
  noFallbackCopy: true,
  mapRegionHighlighted: true
}
```

## Task 5: Unusual Directions / Outliers

**Owner thread:** Unusual Directions usability.

**Files:**
- Modify: `docs/site/study-ui.js`
- Modify: `docs/site/map-detail.js`
- Modify if needed: `scripts/build_icml_study_features.py`
- Modify if needed: `scripts/verify_ui_smoke.mjs`

- [ ] Keep language careful: use `Unusual directions`, not novelty claims.
- [ ] Show the section on the map trend surface without crowding the first trend card.
- [ ] Show selected-record badge only when the record is in the outlier list.
- [ ] Ensure unusual direction items open existing records.
- [ ] Add or update smoke assertions that outlier language is careful and clickable.

Expected focused browser check:

```js
{
  unusualDirectionsVisible: true,
  bannedNoveltyWordsAbsent: true,
  itemClickNavigatesViewer: true
}
```

## Integration Gate

After feature threads return:

- [ ] Merge or port the smallest useful changes only.
- [ ] Run `git diff --check`.
- [ ] Run `bash scripts/verify_site_contract.sh`.
- [ ] Run `python3 scripts/test_study_features_units.py`.
- [ ] Run focused Playwright smoke for all five feature paths.
- [ ] Capture one current screenshot set under `audit-output/study-features/`.
- [ ] Keep `scripts/build_icml_references.py` untouched unless the user explicitly asks otherwise.

## Self-Review

Spec coverage:
- Study Trail, Trend Cards, Semantic Compare, Topic Lens, and Unusual Directions each have one scoped task.
- Each task has file boundaries and a focused browser proof.

Placeholder scan:
- No task contains TBD/TODO/fill-in-later instructions.

Type consistency:
- Existing feature names and DOM concepts match current code: `Study Trail`, `Semantic Compare`, `Topic lens`, `Unusual directions`.
