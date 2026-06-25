# ICML Atlas 2026

Static GitHub Pages browser for accepted ICML 2026 papers, accepted-public workshop papers, local material assets, and a semantic paper map.

The project is designed for conference study, not as a generic file dump. It lets a reader move from the accepted paper/workshop list to abstracts, official source pages, local PDFs when available, and semantically related records.

## Live Site

- GitHub Pages: <https://kimyeonghyeon.github.io/ICML_2026_Browser/>
- Source on `main`: `docs/`
- Deployed static files: `gh-pages` branch root

## What The Browser Shows

- **Papers**: accepted ICML 2026 main-conference records from the official ICML virtual site.
- **Workshops**: OpenReview workshop submissions that are accepted/public in the collected workshop sources.
- **Map**: semantic atlas over mapped papers and workshops.

ICML uses `/virtual/2026/poster/{id}` pages as presentation pages for accepted main-conference papers. In this browser those records are treated as **papers with poster-session metadata**, not as a separate top-level Poster tab.

## Main Features

- Paper and Workshop tabs with search, filters, badges, and incremental result loading.
- Presentation badges such as Poster, Spotlight, and Oral when present in the accepted metadata.
- Asset-aware viewer:
  - local PDFs and slide PDFs render through PDF.js,
  - poster images render in-page,
  - OpenReview/ICML pages that block framing are shown as source links instead of broken iframes.
- Semantic Map:
  - SPECTER2-style offline embeddings for coordinates, nearest neighbors, and search,
  - immediate lexical fallback while the browser loads the query embedding model,
  - ForceGraph Canvas renderer with zoom, hover tooltips, focused scope, and neighbor navigation,
  - fill color for research area and node shape/ring for domain.
- Study Queue and topic study pack surfaces for collecting records and following nearest semantic neighbors.

## Data Policy

The browser intentionally separates record identity from available assets:

- A main-conference record can appear in **Papers** even if its public PDF is not yet available.
- A `/poster/{id}` ICML URL is an official paper presentation page, not proof of a separate poster-only record.
- Workshop homepage, CFP, schedule, and generic program pages are not displayed as workshop papers.
- Blocked or unavailable PDFs are not embedded. The viewer shows a small availability state and links to the official source.

Current paper PDFs may still be blocked by OpenReview, ICML, or proceedings availability. When a public/local PDF is collected in a future rebuild, the same record can render it through PDF.js.

## Data Layout

Archived materials live under:

```text
icml_2026_materials/
```

The primary browser index is:

```text
docs/site/data/icml2026_index.json
```

Sharded startup/full-load data is stored under:

```text
docs/site/data/icml2026_startup.json
docs/site/data/shards/
```

Semantic map/search artifacts are:

```text
docs/site/data/icml2026_map.json
docs/site/data/icml2026_search_embeddings.json
docs/site/data/icml2026_semantic_sidecar.json
```

## Rebuild And Verify

Rebuild the static site data after updating manifests or downloaded assets:

```bash
scripts/build_site.sh
```

Validate the data contract:

```bash
scripts/verify_site_contract.sh
```

Validate semantic artifact freshness and consistency:

```bash
python3 scripts/verify_embedding_map.py docs/site/data/icml2026_index.json docs/site/data/icml2026_map.json --require-fresh
```

Run the browser smoke test against a local server:

```bash
python3 -m http.server 8787 --directory docs
node scripts/verify_ui_smoke.mjs http://127.0.0.1:8787/
```

## Semantic Map Builds

The checked-in map/search data is built from scientific-paper text using SPECTER2-style embeddings.

Install local semantic build dependencies:

```bash
python3 -m pip install sentence-transformers umap-learn scikit-learn numpy
```

Then rebuild:

```bash
scripts/build_site.sh
```

For deterministic lexical fallback builds:

```bash
ICML_SEMANTIC_ARGS="--lexical" scripts/build_site.sh
```

For a fast smoke map:

```bash
ICML_SEMANTIC_ARGS="--smoke --limit 500" scripts/build_site.sh
```

The manual GitHub workflow `.github/workflows/semantic-map-rebuild.yml` can rebuild semantic artifacts. Smoke runs do not commit generated artifacts.

## GitHub Workflows

- `site-regression.yml`: verifies the data contract and UI smoke behavior on `main`.
- `semantic-map-rebuild.yml`: manually rebuilds semantic map/search artifacts.
- `workshop-abstracts.yml`: updates workshop PDFs/abstract-derived metadata when new public assets are collectable.

## Local Preview

```bash
python3 -m http.server 8787 --directory docs
```

Open:

```text
http://127.0.0.1:8787/
```
