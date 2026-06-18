# ICML 2026 Paper Universe Map Specification

Last updated: 2026-06-18

## 1. Purpose

The Map is not a decorative scatter plot. It is the spatial navigation layer for the ICML 2026 materials browser.

The product goal is:

```text
Overview first -> zoom/filter -> select -> inspect -> open asset
```

Users should be able to understand the shape of the paper universe, find meaningful clusters, select one record, inspect its metadata and neighbors, and then open the official source or local asset.

The Map must support three material families without mixing their identity:

- `paper`: accepted main-conference metadata and public/local PDFs when available
- `poster`: official ICML virtual poster records
- `workshop`: accepted-public OpenReview workshop papers only

The UI must not imply that a poster page is a paper PDF. If a record has no public/local PDF, it remains metadata/source-link backed.

## 2. Map Surfaces

There are three graph surfaces in the project.

| Surface | File | Purpose | Engine |
| --- | --- | --- | --- |
| Main Map tab | `docs/index.html`, `docs/site/app.js` | Integrated exploration inside the materials browser | ForceGraph by default, Cytoscape.js optional |
| Sigma page | `docs/sigma.html`, `docs/site/sigma-page.js` | Separate graph-engine experiment | Sigma.js + Graphology, canvas fallback if needed |
| Cosmograph page | `docs/cosmograph.html`, `docs/site/cosmograph-page.js` | Separate Cosmograph-oriented cockpit page | Cosmograph attempted first, local canvas fallback when blocked |

The separate graph pages must remain separate pages. They should not become tabs inside the main Browser unless explicitly requested.

## 3. Data Contract

### 3.1 Input Files

The Map reads only local static JSON files:

```text
docs/site/data/icml2026_index.json
docs/site/data/icml2026_map.json
docs/site/data/icml2026_semantic_sidecar.json
```

`icml2026_index.json` is the metadata authority.

`icml2026_map.json` is the semantic-neighbor and coordinate authority.

The frontend must not infer acceptance status from arbitrary source pages. The accepted-only gate belongs in the data collection/build scripts.

### 3.2 Record Fields

Each displayed record should be treated as:

```ts
type MaterialRecord = {
  id: string;
  type: "paper" | "poster" | "workshop";
  title: string;
  authors?: string;

  group?: string;
  category?: string;
  categoryTags?: string[];
  areaTags?: string[];
  domainTags?: string[];

  clusterId?: string;
  clusterLabel?: string;
  embeddingTextQuality?: "title_abstract" | "title_topic" | "title_only" | "unavailable";

  mapAvailable?: boolean;
  status: "accepted_public" | "metadata_only" | "blocked" | "unavailable" | string;
  sourceType?: string;
  availabilityStatus?: "downloaded" | "blocked" | "metadata" | "unavailable" | string;
  availabilityLabel?: string;

  pageUrl?: string;
  openreviewUrl?: string;
  projectPageUrl?: string;
  pdfUrl?: string;

  localPdfPath?: string;
  localPosterPath?: string;
  localSlidePath?: string;
  bestAsset?: string;
  bestAssetKind?: "pdf" | "poster" | "slide" | string;
  hasPdf?: boolean;
  hasPoster?: boolean;
  hasSlide?: boolean;
};
```

### 3.3 Map Point Fields

Each map point should be treated as:

```ts
type MapPoint = {
  id: string;
  x: number;
  y: number;
  z?: number;
  clusterId?: string;
  nearestNeighbors: Array<{
    id: string;
    score: number;
  }>;
};
```

The frontend must join `MaterialRecord.id` to `MapPoint.id` exactly. It must not deduplicate by title, because paper/poster/workshop records may intentionally share similar titles.

## 4. Graph Payload

The shared graph loader should produce:

```ts
type PaperNode = {
  id: string;
  title: string;
  rawTitle?: string;
  authors?: string;
  type: "paper" | "poster" | "workshop" | string;
  typeLabel: string;

  area: string;
  domain: string;
  cluster?: string;
  group?: string;

  x: number;
  y: number;
  size: number;
  color: string;
  areaColor: string;
  domainColor: string;

  url?: string;
  record: MaterialRecord;
};

type PaperEdge = {
  source: string;
  target: string;
  score: number;
};
```

Default global graph density:

```text
nodes: all `mapAvailable` records that pass current filters
neighbors per node: 2-3
edge dedupe: undirected key sorted by source/target
self-links: forbidden
```

For 13k nodes, do not draw all 12 nearest-neighbor edges. It produces visual noise and slows hover/selection.

## 5. Product UX

### 5.1 Core Flow

```text
1. User opens Map.
2. User sees global distribution and rough cluster islands.
3. User filters or searches.
4. Matching nodes are highlighted or non-matching nodes are dimmed.
5. User hovers one node.
6. Tooltip shows title and semantic decoder.
7. User clicks one node.
8. Detail panel updates with metadata, assets, and nearest records.
9. User opens the record in the main viewer or official source.
```

### 5.2 Empty State

Before selection:

```text
Select a paper from the map
Hover to preview, click to inspect metadata and similar records.
```

Do not show a fake selected paper. Do not auto-open random records in the detail panel unless the user has selected one.

### 5.3 Tooltip

Tooltip content:

```text
{title}
Area: {area} · Domain: {domain} · Type: {typeLabel}
```

Tooltip rules:

- appears within 100 ms of hover
- follows pointer without blocking pointer events
- max width around 320-420 px
- hides on pointer leave
- never duplicates with a second native browser title tooltip

### 5.4 Click Selection

Clicking a node should:

- store selected node id
- visually mark selected node
- emphasize first-hop neighbors
- dim unrelated nodes when feasible
- update the right detail panel immediately
- keep the graph interactive

For the main Map tab, click may also zoom in. For the separate cockpit pages, click should prioritize inspect/detail first.

## 6. Layout Specification

### 6.1 Cockpit Layout

Target layout for separate map pages:

```text
Top bar: 64px
Left filter panel: 280px
Graph stage: flex, minimum 720px where possible
Right detail panel: 360px
```

Desktop grid:

```css
.archive-main {
  height: calc(100vh - 64px);
  display: grid;
  grid-template-columns: 280px minmax(720px, 1fr) 360px;
}
```

Responsive rule:

| Width | Layout |
| --- | --- |
| >= 1440px | left panel + graph + right panel |
| 1024-1439px | graph remains primary; panels can shrink or become collapsible |
| < 1024px | graph first; panels should become drawers or stacked sections |

Mobile is not currently a priority, but the page must not become blank or unusable.

### 6.2 Top Bar

Top bar content:

```text
ICML 2026 Archive
Paper Universe Map / Cosmograph Map / Sigma.js Graphology Map

[13,409 Records] [19,080 Links] [PDFs] [Poster Images] [Slides]
```

Top bar visual:

- dark background
- compact metric badges
- no marketing hero
- no large explanatory copy

### 6.3 Left Filter Panel

The left panel should look like a control console, not a white admin form.

Required controls:

- Search
- Area
- Domain
- Type
- Color by
- Similarity or edge threshold, if implemented
- Display options, if implemented
- Reset filters

Default control style:

```css
background: rgba(15, 23, 42, 0.85);
border: 1px solid rgba(148, 163, 184, 0.22);
color: #e2e8f0;
border-radius: 10px;
```

### 6.4 Graph Stage

The graph stage is the primary visual area.

Background should be a dark scientific gradient:

```css
background:
  radial-gradient(circle at 28% 32%, rgba(59, 130, 246, 0.16), transparent 34%),
  radial-gradient(circle at 72% 55%, rgba(168, 85, 247, 0.10), transparent 32%),
  radial-gradient(circle at 54% 80%, rgba(20, 184, 166, 0.08), transparent 30%),
  linear-gradient(135deg, #050711 0%, #0b1020 50%, #020617 100%);
```

Graph HUD:

```text
13,409 points · 19,080 links · Area color · Global scope
```

The HUD must not cover important controls or consume much visual attention.

### 6.5 Right Detail Panel

Right panel should be readable. A light panel is acceptable because long titles and metadata need contrast.

Required selected-paper sections:

- type and area line
- title
- area/domain/quality badges
- authors
- asset/source actions
- metadata
- similar papers or visible neighbors
- selected-neighborhood summary, if available

## 7. Visual Encoding

### 7.1 Color

Default color mode: Area.

Alternative color modes:

- Domain
- Type
- Cluster, if useful
- Availability, if useful

Area and Domain are not the same concept:

- Area = ML research area such as LLMs, Vision, Optimization
- Domain = application or external domain such as Biology, Medical, Climate, General

If both are shown simultaneously:

- fill = Area
- ring or secondary mark = Domain

### 7.2 Node Style

For 13k records:

```text
default radius: 1.2-1.5 visual px target
default opacity: 0.62-0.78
hover radius: 4.0
selected radius: 5.5
ring: hover/selected only by default
labels: off by default
```

Current canvas fallback uses larger logical radii because it scales world coordinates. Visual tuning should be judged by screenshot, not raw radius constants.

### 7.3 Edge Style

Edges are background texture, not the main mark.

Default:

```text
width: about 0.18
opacity: 0.035-0.05
color: rgba(148, 163, 184, 0.08)
```

Selected or hovered neighborhood:

```text
width: about 0.7
opacity: 0.42
color: rgba(186, 230, 253, 0.55)
```

Rule:

- default: show only subtle global edges
- hover: emphasize hovered node top-k edges
- click: emphasize selected node and 1-hop neighborhood
- filter: dim unmatched nodes and hide unmatched edges where possible

### 7.4 Labels

Labels must not be always visible.

Zoom rules:

| Zoom | Labels |
| --- | --- |
| low zoom | no labels |
| medium zoom | hover/selected labels only |
| high zoom | selected cluster labels |
| very high zoom | local labels |

If the engine does not expose zoom-level label control, keep labels disabled and rely on tooltip/detail panel.

## 8. Search and Filter Behavior

### 8.1 Search

Search fields:

- title
- normalized/plain title
- authors
- group
- area tags
- domain tags
- cluster label

Search behavior:

| Result count | Behavior |
| --- | --- |
| 0 | keep graph visible; show no-match state in detail/HUD |
| 1 | center or select the match if implemented |
| 2-100 | highlight matches and fit bounds if implemented |
| >100 | highlight broad region; encourage filter refinement |

Search should debounce around 200 ms once the graph supports style-only updates.

### 8.2 Filters

Required filters:

- Area
- Domain
- Type
- Color by

Planned filters:

- Asset availability
- Similarity threshold
- Has PDF / poster image / slide
- Accepted public only, though this should already be enforced by data

Default filtering mode should eventually be soft filtering:

```text
matched opacity: 0.82
unmatched opacity: 0.045
matched edge opacity: 0.06
unmatched edge opacity: 0.0
```

Current implementation rebuilds the graph from filtered records. That is acceptable for the MVP, but the target behavior is style-based dimming so users preserve spatial context.

## 9. Camera and Pointer Interactions

### 9.1 Main Map Tab

Main Map tab interaction rules:

- scroll on graph = zoom in/out
- middle click = fit graph
- click node = select and open detail/viewer
- shift click = zoom out if supported
- drag without space = draw selection box
- click selection box = zoom to selected box
- drag with space = pan

These rules should be tested because they are easy to regress.

### 9.2 Separate Graph Pages

Separate page interaction rules:

- wheel = zoom
- drag = pan
- hover = tooltip
- click = inspect in right detail panel
- Fit graph button = reset camera
- Reset filters = clear search/filter/color mode

The separate pages should not require keyboard gestures for basic exploration.

## 10. Layout Generation

Target long-term preprocessing pipeline:

```text
metadata
-> construct embedding text
-> embedding model
-> kNN graph
-> UMAP 2D
-> optional ForceAtlas2 refinement
-> normalize/scale coordinates
-> write icml2026_map.json or graph payload
```

Embedding text:

```text
Title: {title}
Abstract: {abstract}
Keywords: {keywords}
Area: {area}
Domain: {domain}
Authors: {authors}
```

Recommended kNN:

```text
k = 5-8
threshold = 0.68-0.75
default target: k = 6, threshold = 0.72
```

Recommended UMAP balanced parameters:

```python
umap.UMAP(
    n_neighbors=25,
    min_dist=0.10,
    spread=2.4,
    metric="cosine",
    random_state=42,
)
```

Coordinate scaling:

```python
xy[:, 0] = (xy[:, 0] - xy[:, 0].mean()) / xy[:, 0].std()
xy[:, 1] = (xy[:, 1] - xy[:, 1].mean()) / xy[:, 1].std()
xy *= 850
```

Current limitation:

Many current `icml2026_map.json` records have zero coordinates, so separate graph pages use deterministic area-cloud fallback positions. This is a product fallback, not the final semantic layout. The next data improvement should regenerate real 2D coordinates for all map-available records.

## 11. Performance Targets

For about 13k nodes and 20k edges:

| Metric | Target |
| --- | --- |
| Initial render | <= 2 seconds after JSON loaded |
| Hover latency | <= 50 ms |
| Filter update | <= 200 ms target after style-based filtering |
| Search debounce | 200 ms |
| Console errors | none |
| Same-origin failed requests | none |

If a graph engine cannot satisfy hover performance at 13k nodes, reduce edge count before reducing node count.

## 12. Engine-Specific Requirements

### 12.1 ForceGraph

Used by main Map tab.

Requirements:

- no always-on labels
- custom canvas node renderer
- area/domain decoder in tooltip
- controlled wheel zoom
- middle-click fit
- box selection
- selected-neighborhood mini graph in viewer

### 12.2 Cytoscape.js

Used as alternate main Map engine.

Requirements:

- same tooltip semantics as ForceGraph
- selected node styling
- area/domain colors preserved
- no download or navigation side effects

### 12.3 Sigma.js + Graphology

Used by separate Sigma page.

Requirements:

- Graphology graph model
- Sigma renderer when WebGL is available
- canvas fallback when Sigma renderer fails
- hover tooltip
- click detail panel
- fit graph control
- no blank page on WebGL failure

### 12.4 Cosmograph

Used by separate Cosmograph page.

Requirements:

- attempt official Cosmograph runtime first
- if Cosmograph/luma.gl/CDN runtime fails, switch to local canvas fallback
- report the fallback honestly in HUD
- do not leave the page stuck at loading

Current known issue:

```text
Cosmograph module can fail with luma.gl multiple-version conflicts.
The page must still render via fallback and show:
Cosmograph blocked, canvas fallback
```

## 13. Accessibility and Robustness

Minimum requirements:

- controls are keyboard reachable
- canvas has an accessible label or surrounding section label
- status/HUD text is readable
- tooltip is not the only way to inspect selected record; click must update detail panel
- source/action links use normal anchors
- page does not trap keyboard focus

Robustness requirements:

- no broken iframe for blocked PDFs or source pages
- no automatic file download on workshop/poster click
- OpenReview direct PDF URLs are opened as source links or rendered via local PDF.js only when downloaded
- graph page still works when third-party graph library fails, where possible

## 14. Acceptance Criteria

### 14.1 Visual

- First screen shows cluster islands or an interpretable distribution.
- Nodes look like particles, not large stickers.
- Edges read as subtle texture, not a white mesh.
- No always-visible title labels at global zoom.
- Selected or hovered record is visually dominant.
- Left panel looks like a dark control console, not a white admin form.
- Right panel is readable and action-oriented.

### 14.2 Interaction

- Hover shows tooltip within about 100 ms.
- Click updates detail panel immediately.
- Search affects graph and detail/search state.
- Filter changes do not blank the graph.
- Zoom and pan keep the graph under user control.
- Fit/reset controls work.

### 14.3 Data Integrity

- `ℝ^{2k} is Theoretically Large Enough for Embedding-based Top-k Retrieval` remains Poster-only if the source data says poster.
- Regular main-conference papers must not show `Paper · Poster`.
- LaTeX title commands such as `\texttt{Multi}^2` must render as readable plain text like `Multi^2`.
- Workshop generic schedule/program pages must not appear as accepted workshop papers.
- Area and Domain must remain separate concepts.

### 14.4 Verification

Required commands:

```bash
node scripts/verify_graph_pages.mjs http://127.0.0.1:57996/
node scripts/verify_ui_smoke.mjs http://127.0.0.1:57996/
scripts/verify_site_contract.sh docs/site/data/icml2026_index.json
python3 scripts/verify_embedding_map.py docs/site/data/icml2026_index.json docs/site/data/icml2026_map.json
python3 scripts/test_embedding_map_units.py
```

Screenshot verification:

- `docs/index.html` main Map tab at desktop size
- `docs/sigma.html`
- `docs/cosmograph.html`
- hover tooltip visible on graph
- click-selected detail panel visible

## 15. Minimum Redesign Task List

Priority order:

1. Make separate map pages a coherent dark research cockpit.
2. Convert left panel to dark control console.
3. Apply graph-stage gradient background.
4. Reduce node visual radius and opacity for 13k records.
5. Reduce edge opacity so edges become texture.
6. Keep labels off by default.
7. Add hover and selected rings.
8. Improve right detail panel into a real paper inspection panel.
9. Connect search/filter state to graph style without destroying spatial context.
10. Regenerate real semantic coordinates for all records.

The highest immediate visual impact comes from tasks 1-5.

## 16. Non-Goals

Do not do these unless explicitly requested:

- rebuild the whole site in React/Next.js
- turn separate graph pages into main-page tabs
- embed OpenReview PDFs directly in iframes
- show all labels at once
- add decorative hero sections
- treat workshop homepages or schedules as workshop papers
- hide blocked/unavailable state behind broken previews

## 17. Working Principle

The Map should feel like:

```text
A dark research cockpit for exploring a semantic universe of papers,
where the graph provides spatial overview and the side panels provide
judgment, filtering, and action.
```

In Korean:

```text
논문 목록을 보여주는 화면이 아니라,
연구자가 논문 공간을 탐색하고 선택하고 판단하는 지도형 cockpit.
```
