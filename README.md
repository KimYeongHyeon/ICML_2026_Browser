# ICML 2026 Materials Browser

Static browser for the locally archived ICML 2026 materials.

## Website

The public GitHub Pages site is served from the `gh-pages` branch. The source files on `main` live under `docs/`.

It provides:

- Papers / Workshops / Map tabs
- Poster, Spotlight, and Oral presentation badges on paper records
- search by title, author, keyword
- field/category filters
- group/workshop filters
- asset filters for PDF, poster image, slide deck, or metadata-only records
- in-page viewer for collected PDF, slide PDF, and poster image files
- Obsidian-style semantic graph map with zoom, pan, drag, hover, focused scope, and neighbor navigation

The Papers tab shows accepted main-conference metadata even before public proceedings PDFs are available. ICML virtual `/poster/{id}` pages are treated as paper presentation pages, not as a separate top-level content type.

## Data Layout

The archived materials live under:

```text
icml_2026_materials/
```

The browser index is:

```text
docs/site/data/icml2026_index.json
```

Rebuild it after updating manifests or adding downloaded files:

```bash
scripts/build_site.sh
```

Validate the site data contract without rebuilding:

```bash
scripts/verify_site_contract.sh
```

## Semantic Map Build

The Map tab is generated offline and served as static JSON. The checked-in map/search data uses SPECTER2-style scientific paper embeddings:

- `docs/site/data/icml2026_map.json`: coordinates, clusters, and nearest neighbors
- `docs/site/data/icml2026_search_embeddings.json`: quantized 768-dim vectors for Map search

Install the scientific embedding dependencies:

```bash
python3 -m pip install sentence-transformers umap-learn scikit-learn numpy
```

Then run:

```bash
scripts/build_site.sh
```

For deterministic local-only fallback builds, use lexical mode:

```bash
ICML_SEMANTIC_ARGS="--lexical" scripts/build_site.sh
```

For a fast test-only map, use smoke mode:

```bash
ICML_SEMANTIC_ARGS="--smoke --limit 500" scripts/build_site.sh
```

The browser lazy-loads a Transformers.js-compatible SPECTER2 ONNX query model for Map search. While it loads, the page shows an immediate lexical fallback; once the query embedding is ready, the same search rerenders as SPECTER2 cosine matches.

The semantic verifier checks map/index/search consistency:

```bash
python3 scripts/verify_embedding_map.py docs/site/data/icml2026_index.json docs/site/data/icml2026_map.json
```

The browser uses `force-graph` for the Map tab. It renders the semantic-neighbor graph on Canvas with `d3-force` physics, zoom/pan, dragging, hover labels, and focused local-graph filtering.

## Local Preview

```bash
python3 -m http.server 8787
```

Then open:

```text
http://localhost:8787/docs/
```

## Notes

The main-conference paper PDFs were not public in the collected official sources at the time of archiving, so paper records are excluded until a public PDF is available. Poster images render directly. Local PDF and slide files render through PDF.js so GitHub Pages does not trigger browser downloads.
