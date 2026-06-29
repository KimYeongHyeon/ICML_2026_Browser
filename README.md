# ICML Atlas 2026

ICML Atlas 2026 is a study-oriented browser for ICML 2026 papers and workshops.

The goal is not to mirror a directory of files. The goal is to make the conference easier to explore: start from accepted records, filter by topic, inspect abstracts and source links, follow semantically related work, and keep track of papers worth reading later.

Live site: <https://kimyeonghyeon.github.io/ICML_2026_Browser/>

## Why This Exists

Large ML conferences are hard to study from a flat accepted-paper list. Titles, sessions, PDFs, workshop pages, and related papers are scattered across multiple sources. This project turns those scattered public records into one static, browser-based reading surface.

The browser is built around three questions:

- **What was accepted?**
- **What is this paper or workshop submission about?**
- **What should I read next if this one is relevant?**

## What It Contains

### Papers

The Papers view contains accepted ICML 2026 main-conference records collected from the official ICML virtual site.

ICML uses `/virtual/2026/poster/{id}` URLs as presentation pages for accepted main-conference papers. In this project, those entries are treated as **papers with poster-session metadata**, not as a separate top-level Poster category.

Paper records may include:

- title, authors, abstract, decision/status metadata,
- poster session, room, and presentation information,
- official ICML page links,
- OpenReview links or PDFs when publicly reachable,
- local PDFs or other assets when collected.

### Workshops

The Workshops view contains accepted-public workshop submissions from collected OpenReview workshop sources.

Generic workshop pages are intentionally excluded from the paper list. Homepage, call-for-paper, schedule, and program pages are source material, not accepted workshop papers.

### Semantic Map

The Map view is the main exploration layer. It places mapped papers and workshop records in a semantic space so that related work is near each other.

The map is meant to support quick conference study:

- zoom out to see broad topic regions,
- filter by research area or domain,
- search semantically rather than only by exact keyword,
- click a paper to inspect its nearest neighbors,
- use the semantic neighborhood to build a reading path.

In the map legend:

- fill color represents research area,
- node shape and ring represent domain,
- the shape legend labels the actual domain names, not generic shape names.

### References

The References view is a separate top-level tab for citation-overlap analysis. It summarizes clean bibliography titles, shows records that share prior work, and renders a small citation-overlap graph for the selected record.

It is deliberately separate from the Map view: Map answers “what is semantically nearby?”, while References answers “what cites similar prior work?”

## Reading Workflow

A typical use case is:

1. Search for a topic, method, or author.
2. Open a relevant paper or workshop record.
3. Read the abstract and source metadata.
4. Use the semantic neighborhood to find related work.
5. Open local PDFs or official source pages when available.

The interface is designed for conference preparation: fast scanning first, deep reading second.

## Data Principles

The project keeps record identity separate from asset availability.

- A main-conference paper can appear even if the public PDF is not yet available.
- A poster-session page does not make a separate Poster top-level record.
- A workshop submission must be accepted/public to appear as a workshop paper.
- Blocked PDFs or pages are not embedded as broken iframes.
- OpenReview, ICML, Google Drive, and similar sources are linked directly when they block framing.
- Local PDFs and slide PDFs render through PDF.js when available.

This means some records are currently metadata-first. They are still useful for search, filtering, map exploration, and reading-path planning.

## Semantic Index

The semantic map and related-paper surfaces are built from paper metadata and abstracts.

The current index uses SPECTER2-level scientific-paper embeddings over title and abstract text for:

- map coordinates,
- HDBSCAN embedding clusters,
- nearest-neighbor links,
- semantic search,
- semantic neighborhood views.

When the browser-side query embedding model is still loading, the map can show an immediate lexical fallback and then rerender with semantic matches once the model is ready.

The embedding artifacts are generated offline and shipped as static JSON. They are kept separate from the startup payload so the site can render the main browser before loading heavier map/search data.

## References

The References view analyzes citation overlap from locally available PDFs and optional public scholarly-graph lookups. It is not part of the first-page startup path and it does not require a backend.

A build step extracts bibliography sections with `pdftotext`, filters noisy citation fragments, normalizes reference titles, and computes overlap between papers that cite the same works. This is intentionally separate from the main index:

- startup data does not include references,
- reference metadata is stored in a small manifest plus lazy-loaded per-record shards,
- the References tab can show common citation titles, overlap lists, and a visual overlap graph without slowing the first page load.

Reference collection currently uses public local/OpenReview PDFs directly and extracts bibliography sections with `pdftotext`. It does not depend on OpenAlex/Crossref quotas for the main collection path, and downloaded PDFs are streamed through temporary files rather than committed.

The checked-in artifact may still be partial when a PDF is unavailable, blocked, malformed, or lacks a parseable bibliography. The scheduled `Collect references` workflow is the full-coverage path: it chunks the whole index, extracts references from PDFs, merges the shards, validates the result, and commits improved public reference data.

The safe collection, merge, validation, and publish flow is documented in [docs/reference-collection-workflow.md](docs/reference-collection-workflow.md).

## Current Limitations

ICML 2026 proceedings and public paper PDFs may not be uniformly available through stable public URLs yet. Some OpenReview PDF endpoints can also block unauthenticated or framed access.

The browser handles this by showing source links and availability states instead of pretending that every record has an embeddable PDF.

Domain and area labels are inferred from available title/abstract metadata. They are useful for exploration, but they should not be treated as official ICML subject-area labels unless the source metadata explicitly provides them.

## Repository Shape

- `docs/`: source for the static browser on `main`
- `gh-pages`: deployed GitHub Pages branch
- `icml_2026_materials/`: archived local materials
- `scripts/`: data collection, rebuild, verification, and workflow helpers
- `.github/workflows/`: regression, semantic rebuild, and workshop update workflows

The public site is static. No backend is required for browsing.
