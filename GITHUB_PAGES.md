# ICML 2026 Materials Browser

This repository has a static GitHub Pages entry point at `docs/index.html` on `main`, deployed as root files on the `gh-pages` branch.

## Publish

In GitHub repository settings:

1. Open **Settings -> Pages**.
2. Set **Build and deployment** to **Deploy from a branch**.
3. Select the `gh-pages` branch.
4. Set the folder/source to `/ (root)`.

The site expects the material files to remain at:

- `icml_2026_materials/papers/`
- `icml_2026_materials/posters/`
- `icml_2026_materials/workshops/`

## Refresh Data

After adding or updating manifests, rebuild the browser index:

```bash
scripts/build_site.sh
```

This rewrites:

```text
docs/site/data/icml2026_index.json
docs/site/data/icml2026_map.json
```

## Semantic Map

The Map tab is static. Generate semantic data before deploying:

```bash
scripts/build_site.sh
```

For a full scientific embedding build, install the semantic dependencies listed in `README.md` and run:

```bash
ICML_SEMANTIC_ARGS="" scripts/build_site.sh
```

## Local Preview

```bash
python3 -m http.server 8787
```

Then open:

```text
http://localhost:8787/docs/
```

## Current Limitation

Main-conference paper PDFs were not public in the collected official sources at build time. The Papers tab is hidden until future rebuilds find public paper PDF paths. OpenReview and ICML source pages are linked instead of embedded when they block framing.
