# Ponytail Audit

Scope: over-engineering and complexity only.

## Resolved

- Removed standalone Sigma/Cosmograph experiment pages and their fallback graph bundle. The main Map tab is the canonical graph surface.
- Removed duplicate map preload state; `mapDataPromise` owns fetch de-duplication.

## Remaining Candidates

native: Cut the custom PDF.js preview shell only if browser-native PDF embedding becomes acceptable again. Current custom viewer exists because downloads/framing were user-visible problems. [docs/site/pdf-viewer.js]

shrink: Split the large stylesheet only when CSS changes become hard to review. No build step needed. [docs/site/styles.css]

net: resolved about -1,700 lines and -2 CDN graph engines.
