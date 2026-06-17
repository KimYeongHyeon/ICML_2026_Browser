# ICML 2026 Materials Browser

Static browser for the locally archived ICML 2026 materials.

## Website

The public GitHub Pages site is served from the `gh-pages` branch. The source files on `main` live under `docs/`.

It provides:

- Papers / Posters / Workshops tabs
- search by title, author, keyword
- field/category filters
- group/workshop filters
- asset filters for PDF, poster image, slide deck, or metadata-only records
- in-page viewer for collected PDF, slide PDF, and poster image files

The Papers tab is hidden when no public main-conference paper PDF is available. ICML virtual poster pages are not treated as paper records.

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

The Map tab is generated offline and served as static JSON. The default build uses deterministic smoke embeddings so the site remains rebuildable without model downloads:

```bash
scripts/build_site.sh
```

For real local scientific embeddings, install:

```bash
python3 -m pip install sentence-transformers umap-learn scikit-learn numpy
```

Then run:

```bash
ICML_SEMANTIC_ARGS="" scripts/build_site.sh
```

The semantic verifier checks map/index consistency:

```bash
python3 scripts/verify_embedding_map.py
```

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
