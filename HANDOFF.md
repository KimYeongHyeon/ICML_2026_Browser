# Handoff — Semantic Search + Related-Paper Navigation (2026-06-22)

Branch: `feat/semantic-search-related-papers` (6 commits on top of `2bb05dd`)
Status: **not pushed, not merged** — `main` is untouched. Safe to revert.

## Goal

Turn the ICML 2026 browser into a researcher tool: find papers of interest by
topic, read the abstract, then follow semantically related papers. Plus: make the
"paper universe" map use real embeddings, and fix asset/PDF availability.

## What shipped (commit by commit)

| Commit | What |
|--------|------|
| `e9d66ec` feat(data) | SPECTER2 (`allenai/specter2_base`, 768d) embeddings + real UMAP 2D coordinates (was lexical-hash fallback with collapsed 0,0 points). Abstract collection pipeline (`scripts/collect_icml_2026_abstracts.py`) + join into the index. |
| `65a21c3` feat(ui) | Fold posters into papers as presentation badges (no Posters tab). Search includes abstract (full-text) + "X match" field badge. Result abstract preview, viewer abstract block, session reading list (save + saved filter). |
| `89f3374` chore | gitignore tool caches + the large raw `abstracts.jsonl`. |
| `f0574c8` style(ui) | Search result hierarchy, hover micro-interactions, card density. |
| `7913a43` fix(ui) | UIUX-audit fixes: Cytoscape empty-canvas (coordinate normalization), engine parity, node visibility, badge declutter, muted contrast, stat-pill false affordance. |
| `ba92529` feat(map) | Force-directed cohesive map layout + workshop PDF 404 fix. |

## Key findings (the non-obvious stuff)

- **paper == poster, 1:1.** All 6,343 main-conference papers exist twice in raw
  data: a `paper` record (OpenReview metadata) and a `poster` record (ICML virtual).
  Same papers. Posters are now a "Poster session" badge on the paper, not a tab.
- **No ICML 2026 PDFs are public yet.** OpenReview returns **403 (permission gate,
  not a bot block)** for main-conference notes; ICML virtual exposes metadata only.
  PDFs typically go public around the conference (July 2026). `blocked` is correct.
- **Abstracts are scrapeable without auth/JS.** ICML virtual `/poster/{id}` pages
  are server-rendered with the abstract in `<div class="abstract-section">`; plain
  `curl` works. Static metadata list: `icml.cc/static/virtual/data/icml-2026-orals-posters.json`
  (6,796 = 6,628 Poster + 168 Oral).
- **Workshop PDFs ARE public** (OpenReview `pdf/{hash}.pdf`, HTTP 200) but block
  framing (`x-frame-options: SAMEORIGIN`) → cannot embed, only "Open PDF" new tab.
- **Local assets are not deployed.** `icml_2026_materials/` (PDFs 348MB, poster
  images) is NOT on gh-pages → embedding local paths 404s. Workshop falls back to
  the remote OpenReview PDF; other local assets (poster images) have no remote URL.
- **SPECTER2 env:** `.venv-embed` (gitignored), uv + python 3.12 (system 3.14 has
  no torch wheel). Rebuild: `build_icml_site.py` → `.venv-embed/bin/python build_icml_embedding_map.py` (no `--lexical`) → `build_icml_site.py` → `verify_embedding_map.py`.

## Verification

- Regression smoke (`scripts/verify_ui_smoke.mjs`) passes (0 console errors).
- Full all-button headed verify passes (tabs, search, selects, viewer, save,
  saved filter, map controls, group filter, engine switch, focused scope).
- UIUX sub-agent audit (2 reviewers) → P0=0, P1=0 on search/viewer + map engine
  parity. Map node visibility and Cytoscape empty-canvas confirmed fixed.
- Workshop viewer shows abstract + "Open PDF", 0 local-asset 404s.

## Open issues (deferred / need a decision)

1. **Map layout is the weak spot.** 7,066 nodes in 2D is a hard trade-off: UMAP
   coordinates are cramped/elongated; pure force-directed scatters. Current state
   is force-directed seeded from normalized UMAP with anchor cohesion — a
   compromise, not loved. Possible next directions: pre-split by research area
   (small per-area subgraphs), only show a selected paper's local neighborhood,
   or a different layout/library.
2. **Disconnected nodes in the focused neighborhood view.** `focusedGraphIds`
   includes up to 10 first-hop neighbors but `buildGraphData` only draws links for
   the top `neighborLimit` (6) — and kNN is only ~46% reciprocal, so some shown
   nodes have no visible edge. Fix: align the link count with the id selection, or
   draw an explicit center→neighbor edge for every shown neighbor.
3. **Poster images (1,529) and main-conference PDFs** are not viewable on the
   deployed site (no remote URL / not yet public). Needs an asset-deploy strategy
   if in-page preview is wanted.
4. **P2 polish (deferred):** "Metadata" asset badge, Groups list scroll cue, dark
   select affordance, map empty-state line wrap.
5. **Debug probe left in:** `window.__icmlMapDebug.cyInfo()` (verify-mode only) was
   added for diagnosis; harmless but can be removed.

## How to revert

- Map changes only: `git revert ba92529 7913a43`
- Everything: `git checkout main && git branch -D feat/semantic-search-related-papers`
- Keep as-is: do nothing (nothing is pushed)

## Local dev

- Serve: `python3 -m http.server 8000 --directory docs` → http://127.0.0.1:8000/
- Stop: `pkill -f "http.server"`
- Note: local PDF/poster assets won't load under `--directory docs` (they live in
  `icml_2026_materials/`, outside docs/). This mirrors the gh-pages limitation.
