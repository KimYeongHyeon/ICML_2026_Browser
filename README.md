# ICML 2026 Materials Browser

Static browser for the locally archived ICML 2026 materials.

## Website

The GitHub Pages site is served from `docs/`.

It provides:

- Papers / Posters / Workshops tabs
- search by title, author, keyword
- field/category filters
- group/workshop filters
- asset filters for PDF, poster image, slide deck, or metadata-only records
- in-page viewer for collected PDF, slide PDF, and poster image files

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
python3 scripts/build_icml_site.py
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

The main-conference paper PDFs were not public in the collected official sources at the time of archiving, so the Papers tab is metadata-first until those files become publicly available. Poster images, slide decks, and workshop PDFs open directly when local files are present.
