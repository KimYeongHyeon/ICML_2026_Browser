# ICML 2026 Materials Browser

This repository now has a static GitHub Pages entry point at `index.html`.

## Publish

In GitHub repository settings:

1. Open **Settings -> Pages**.
2. Set **Build and deployment** to **Deploy from a branch**.
3. Select the branch that contains this folder.
4. Set the folder/source to `/ (root)`.

The site expects the material files to remain at:

- `icml_2026_materials/papers/`
- `icml_2026_materials/posters/`
- `icml_2026_materials/workshops/`

## Refresh Data

After adding or updating manifests, rebuild the browser index:

```bash
python3 scripts/build_icml_site.py
```

This rewrites:

```text
site/data/icml2026_index.json
```

## Local Preview

```bash
python3 -m http.server 8787
```

Then open:

```text
http://localhost:8787/
```

## Current Limitation

Main-conference paper PDFs were not public in the collected official sources at build time. The Papers tab still indexes official metadata, and the viewer will show PDFs automatically if future rebuilds find local paper PDF paths.
