# ICML Atlas Study Features Implementation Spec

Last updated: 2026-06-28

## Goal

Add embedding-based study features to ICML Atlas 2026 without expanding the top-level product surface.

The browser remains organized around exactly these tabs:

```text
Papers / Workshops / Map / References
```

The new features should help a user answer one practical question:

```text
Given this paper, topic, trend, or neighboring region, what should I read next?
```

## Non-Negotiable Constraints

- Do not add a new top-level Study, Compare, Novelty, or Citations tab.
- Do not resume PDF mass collection. These features use existing record metadata, existing map/embedding artifacts, and existing per-record reference shards.
- References stay per-record: selecting a References record must show that record's extracted references and overlap records.
- Startup stays fast: no study artifact, reference shard, search embedding payload, or heavy map payload may be part of first-page startup JSON.
- No LLM calls in the static browser. All summaries are deterministic, generated offline from title, abstract, embedding clusters, nearest neighbors, trends, and reference overlap.
- Novelty language must be careful: use "outliers" or "unusual directions", not "novel papers".

## Current Surfaces To Reuse

- `docs/site/viewer.js`: selected paper/workshop record viewer. Best home for Reading Path / Study Trail and record-level Semantic Compare controls.
- `docs/site/map-detail.js`: selected map record panel and empty-state trend panel. Best home for study trail preview, improved trend cards, compare bridge results, and outlier affordances.
- `docs/site/semantic-insights.js`: query-active map insight panel. Best home for Topic Lens.
- `docs/site/app.js`: orchestration, lazy loading, tab routing, References rendering.
- `docs/site/references.js`: existing lazy manifest and per-record shard loading.
- `docs/site/data/icml2026_map.json`: existing coordinate, cluster, and nearest-neighbor authority.
- `docs/site/data/icml2026_trends.json`: existing static trend-card data.
- `docs/site/data/references/manifest.json` and `docs/site/data/references/records/*.json`: existing lazy per-record citation overlap data.

## Proposed Data Artifacts

### 1. Study Feature Artifact

Create a lazy artifact:

```text
docs/site/data/icml2026_study_features.json
```

It should be fetched only after one of these happens:

- a record with map metadata is selected in the viewer,
- a map record is selected,
- a map search query is active and the Topic Lens is visible,
- the user opens a compare control.

Suggested shape:

```json
{
  "generatedAt": "ISO timestamp",
  "source": {
    "indexGeneratedAt": "ISO timestamp",
    "mapGeneratedAt": "ISO timestamp",
    "trendsGeneratedAt": "ISO timestamp"
  },
  "records": {
    "record-id": {
      "studyTrail": [
        {
          "recordId": "record-id",
          "stage": "intro",
          "reason": "shared area and central representative"
        }
      ],
      "compareCandidates": [
        {
          "recordId": "record-id",
          "reason": "same cluster, different domain"
        }
      ]
    }
  },
  "topics": {
    "embedding-cluster-id": {
      "dominantArea": "LLMs",
      "dominantDomain": "Biology",
      "nearbyTrendId": "embedding-cluster-001",
      "representativeRecordIds": ["record-id"]
    }
  },
  "outliers": [
    {
      "recordId": "record-id",
      "clusterId": "embedding-cluster-001",
      "score": 0.73,
      "reason": "far from cluster center with title+abstract text"
    }
  ]
}
```

This artifact should not duplicate full abstracts, references, raw vectors, or full nearest-neighbor lists. Store IDs and short deterministic reasons only.

### 2. Trend Card Enrichment

Extend `docs/site/data/icml2026_trends.json` during static build with deterministic study fields:

```json
{
  "coreQuestion": "What problem this trend is mostly asking",
  "representativeMethodology": "Common method family inferred from keywords",
  "subBranches": ["branch label"],
  "firstReadRecordIds": ["record-id", "record-id", "record-id"]
}
```

Keep this in the trends artifact because trend cards already lazy-load when the Map detail surface needs them. Do not move trend data into startup.

## Algorithms

### Reading Path / Study Trail

For a selected paper/workshop, generate 5-10 records in four stages:

```text
intro -> core -> applied -> broader extension
```

Use a greedy deterministic ranker, not raw nearest neighbors:

1. Candidate pool: selected record's nearest neighbors, neighbors-of-neighbors, same embedding cluster representatives, and nearby trend representatives.
2. Score: cosine similarity plus bonuses for shared area, shared cluster, high text quality, and available abstract.
3. Diversity: penalize duplicate domains, duplicate groups, and near-identical titles.
4. Stage assignment:
   - `intro`: central, readable records with high text quality and broad overlap.
   - `core`: closest semantic neighbors in the same area/cluster.
   - `applied`: same method area but different domain.
   - `broader extension`: lower similarity but meaningful bridge across area/domain.

Each trail item should show stage, title, type, area/domain chips, and one reason. Clicking opens the existing viewer.

### Improved Trend Cards

For each trend:

- `coreQuestion`: derive from top title/abstract phrases and representative records.
- `representativeMethodology`: choose the highest-confidence method phrase among keywords and central papers.
- `subBranches`: cluster or keyword subgroups from central members, limited to 3-5 labels.
- `firstReadRecordIds`: choose 3 central, high-text-quality representatives with title/domain diversity.

The UI should replace vague trend prose with compact study sections:

```text
Core question
Representative methodology
Sub-branches
First 3 papers to read
```

### Semantic Compare

Keep compare lightweight and record-scoped.

UI placement:

- Viewer: add a compact "Compare" affordance near the semantic neighborhood or study trail.
- Map detail: allow comparing the selected map record with one neighbor or one suggested compare candidate.
- No modal stack. Use an inline compare block that can be dismissed.

Output:

- Common topic: shared area/domain/tags/cluster keywords.
- Differences: strongest differing area/domain/method keywords.
- Bridging papers: 2-4 records found by nearest-neighbor paths or shared neighbor intersections.

Algorithm:

1. For records A and B, compute shared tags and shared embedding cluster/level labels.
2. Compute different tags and top keywords from title/abstract/trend metadata.
3. Bridge candidates are records appearing in A's neighbors and B's neighbors, then records on A neighbor -> B neighbor paths.
4. Sort by combined similarity to both records, text quality, and diversity.

### Topic Lens

When a Map search query is active, extend the existing semantic insight panel.

Show:

- dominant area,
- dominant domain,
- nearby trend,
- 3 representative papers/workshops,
- whether matches came from query-vector, SPECTER2 query, or lexical fallback.

The map should keep the related embedding region highlighted using the existing `mapSearchSeedIds` and `mapSearchSemanticIds` mechanics. Topic Lens should summarize that highlighted region, not run a separate search model.

### Outlier / Unusual Directions Finder

Generate a small list of unusual directions from existing map geometry.

Definition:

- record has `embeddingTextQuality === "title_abstract"`,
- record belongs to a non-trivial embedding cluster,
- distance from cluster centroid is high,
- not an obvious metadata-only or title-only artifact,
- optional: has enough neighbors to avoid isolated data errors.

UI placement:

- Map empty-state trend panel: small "Unusual directions" section below trend cards.
- Map selected-record detail: badge if the selected record is in the outlier list.
- Trend card: optional small count of outliers in that trend.

Label:

```text
Unusual directions
```

Avoid:

```text
Novel / breakthrough / first / SOTA
```

## References Tab Correction

Keep the References tab as a top-level tab, but make the selected-record nature explicit.

Required behavior:

- The dashboard may show aggregate stats, but the primary interaction is selecting a record.
- Selecting a record lazy-loads exactly that shard from `docs/site/data/references/records/*.json`.
- The selected panel shows:
  - record title,
  - extracted reference count,
  - sample extracted references,
  - overlap records,
  - shared-reference counts.
- Clicking an overlap opens the existing paper/workshop viewer.

Do not make references a Map-only feature and do not load reference shards before the References tab is opened.

## Rollout Order

1. Trend card enrichment
   - Lowest UI risk.
   - Extends an existing static artifact and existing Map trend surface.
2. Reading Path / Study Trail
   - Main user value.
   - Add inside viewer and selected map detail.
3. Topic Lens
   - Reuses existing semantic insight panel and active map search state.
4. Semantic Compare
   - Add only after study trails provide enough candidate records.
5. Outlier / Unusual Directions
   - Add last because labeling and false positives need careful visual treatment.
6. References tab correction
   - Can ship independently if current UI still over-emphasizes aggregate stats.

## Verification Gates

Run after implementation:

```bash
ICML_BUILD_SEMANTIC_MAP=auto scripts/build_site.sh
scripts/verify_site_contract.sh docs/site/data/icml2026_index.json
```

Run UI smoke against a repo-root local server URL:

```bash
python3 -m http.server 57995
node scripts/verify_ui_smoke.mjs http://127.0.0.1:57995/docs/
```

Add or extend smoke checks for:

- Top-level tabs are exactly Papers, Workshops, Map, References.
- No reference data request occurs before opening References.
- No study feature artifact request occurs on initial page load.
- Map/search/trend data remains lazy and does not enter startup JSON.
- Selecting a study-trail item opens the existing viewer.
- Trend cards show core question, methodology, sub-branches, and first 3 reads.
- Semantic Compare renders common topic, differences, and bridge papers inline.
- Topic Lens appears only when a map query is active.
- Outlier labels use "outlier" or "unusual direction", never "novelty" as a claim.
- No PDF mass-download artifacts or scripts are introduced.

## Risks

- Study trails can look authoritative while being heuristic. Mitigation: show deterministic reasons and keep labels practical.
- Outliers can be artifacts from weak text or projection noise. Mitigation: require title+abstract quality and careful labeling.
- Compare can become a separate product surface. Mitigation: inline block only, no modal or new tab.
- Artifact size can creep. Mitigation: store IDs and short reasons, not full records or vectors.

## Success Criteria

- A user can select a paper/workshop and get an actionable 5-10 item reading trail.
- Trend cards answer what to study first, not only what cluster exists.
- A user can compare two records without leaving the current viewer/map context.
- A map search query produces a compact summary of the highlighted topic region.
- Outlier affordances point to unusual directions without overclaiming novelty.
- References remain lazy, per-record, and visibly separate from semantic map proximity.
