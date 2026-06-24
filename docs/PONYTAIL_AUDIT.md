# Ponytail Audit

Scope: over-engineering and complexity only. No security, correctness, or performance claims.

## Biggest cuts first

shrink: Cut the 2,956-line `app.js` god module. Replace it with native ES modules imported by the existing `<script type="module">`: `state.js`, `records.js`, `filters.js`, `viewer.js`, `pdf-viewer.js`, `map-force.js`, `map-cytoscape.js`, `debug.js`; no bundler or build step. [docs/site/app.js]

delete: Cut the hidden alternate Cytoscape engine path and engine selector. Replace it with the current ForceGraph map as the one main engine; keep a fallback only if ForceGraph fails. [docs/index.html, docs/site/app.js, docs/site/styles.css]

delete: Cut standalone Sigma/Cosmograph experiment surfaces after the main Map tab is accepted as canonical. Replace them with links to the main Map tab and keep shared graph data helpers only. [docs/sigma.html, docs/cosmograph.html, docs/site/sigma-page.js, docs/site/cosmograph-page.js, docs/site/graph-pages.css, scripts/verify_graph_pages.mjs]

shrink: Cut duplicated graph palettes, title cleanup, hashing, seeded positions, and graph record shaping in `app.js`. Replace them with imports from `graph-data.js`, or make `graph-data.js` the single graph-data authority used by the main map too. [docs/site/app.js, docs/site/graph-data.js]

native: Cut the custom PDF.js preview shell, toolbar, page state, worker setup, and render loop. Replace it with native browser PDF embedding via `<iframe>` or `<object>` plus an "Open in new tab" link. [docs/site/app.js]

delete: Cut the verify-only global `window.__icmlMapDebug` probe from the shipped app. Replace it with Playwright-side DOM/canvas probing, or load a separate `debug.js` only under `?verify`. [docs/site/app.js, scripts/verify_ui_smoke.mjs]

shrink: Cut parallel main-map and mini-map neighborhood builders. Replace them with one `buildNeighborhoodGraph(record, limit, options)` helper that feeds both renderers. [docs/site/app.js]

shrink: Cut separate tooltip/detail HTML renderers between the main map and graph pages. Replace them with one exported renderer in `graph-data.js`. [docs/site/app.js, docs/site/graph-data.js]

yagni: Cut public "Live", "Reflow", and force-layout control UI unless researchers are actually tuning physics during normal browsing. Replace with Fit, Zoom, Search, and a dev-only query switch for force controls. [docs/index.html, docs/site/app.js, docs/site/styles.css]

shrink: Cut the 1,663-line all-purpose stylesheet as one review surface. Replace it with plain linked CSS files such as `base.css`, `browser.css`, `viewer.css`, and `map.css`; no build step. [docs/site/styles.css]

stdlib: Cut the `curl` subprocess wrapper in the abstract collector. Replace it with `urllib.request.urlopen` plus headers and timeout. [scripts/collect_icml_2026_abstracts.py]

shrink: Cut the inline Python summary heredoc from `build_site.sh`. Replace it by letting `build_icml_site.py` print the summary it already computes. [scripts/build_site.sh, scripts/build_icml_site.py]

delete: Cut the self-committing and self-pushing batch publisher script. Replace it with documented `git add` path batches or a dry-run file list; pushing belongs in the operator workflow, not a repo helper. [scripts/publish_batches.sh]

yagni: Cut the `--only-workshop-pages` recrawl mode unless it is still used. Replace it with the main collection path plus `--skip-workshop-pages`; add page-only recrawl back only when the workflow repeats. [scripts/collect_icml_2026_workshops.py]

net: -2100 lines, -5 deps possible.
