# People, Community, and Topic Analysis Handoff

## Status

Implementation is ready in the active `/tmp/icml-concept-extraction` worktree. It has not been deployed, and the ongoing concept extraction artifacts were not modified.

The checked-in `docs/site/data/analysis/icml2026_people_topics.json` is a pending sentinel only. `scripts/build_people_topics.mjs` atomically replaces it after the concept artifact is complete.

## Publication prerequisite

`docs/site/data/concepts/icml2026_concepts.json` must satisfy all of the following before analysis is generated:

- `schemaVersion` is `icml-concepts/v1`.
- `summary.candidateRecordCount === 7065`.
- `summary.publishedRecordCount === summary.candidateRecordCount`.
- `summary.excludedRecordCount === 0`.
- `summary.exclusionCounts` is empty.

Run either:

```bash
node scripts/build_people_topics.mjs
```

or the normal site build. `scripts/build_site.sh` calls the builder with `--if-ready`; it skips safely while extraction is incomplete and generates the analysis as soon as the finalized concept JSON is present.

## Artifact contract

The generated `icml-people-topics/v1` artifact contains three scopes: `all`, `main`, and `workshop`.

- Authors are resolved with normalized email first. Without email, a normalized name is merged only when coauthor context overlaps.
- Raw email addresses are not published. Each author exposes only `identityEvidence`.
- `paperCount`, primary reviewed Core-concept counts, aliases, and linked record IDs are included per author.
- Institutional affiliation is not inferred. Repeated collaboration components are labelled `coauthor-community-proxy`, include their exact two-or-more-shared-works rule, and set `verifiedAffiliation: false`.
- `topicTrends.claimScope` is `single-year-corpus-prevalence`; there are no growth or change fields.
- The browser rejects an analysis artifact whose concept fingerprint does not match the loaded concept artifact.

## UI integration

The existing People ranked-list/detail components and Author Map network/detail components are reused. People adds a corpus topic-prevalence row using the existing conference-overview card pattern. Map Detail continues to show reviewed Detail concepts from the same finalized concept artifact.

When the finalized pair is unavailable or stale, People and Author Map show a compact pending state and make no incomplete corpus claims.

## Verification

```bash
NODE=/Users/kyh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --test \
  scripts/test_data_loader.mjs \
  scripts/test_people_topics_artifact.mjs \
  scripts/test_people_concepts.mjs \
  scripts/test_people_analytics.mjs
scripts/verify_site_contract.sh docs/site/data/icml2026_index.json
python3 scripts/verify_abstract_quality.py
git diff --check
```

Browser QA covered pending and populated artifact states, Authors and Collaboration groups, search, Author Map, and 1366x900 plus 390x844 viewports. Observed console errors: 0; same-origin request failures: 0; horizontal overflow: 0. Fresh captures are under `/tmp/icml-people-*-fresh.png` and `/tmp/icml-author-map-wide-fresh.png` for this session only.

The legacy full `verify_ui_smoke.mjs` run reached an unrelated existing local-PDF scenario and timed out at line 398 while waiting for PDF.js page status. The changed People/Author Map flows were separately exercised successfully in Chrome Stable.

## Runtime audit hypotheses

1. **Partial extraction could leak incomplete rankings.** Evidence: the current 102/7,065 concept artifact makes `node scripts/build_people_topics.mjs` fail closed, while `--if-ready` returns `{"status":"skipped","reason":"concept-artifact-not-finalized"}` and the browser renders the pending state.
2. **A stale people artifact could be combined with newer concepts.** Evidence: `loadPeopleTopics accepts only the matching concept revision` and `parsePeopleTopicsArtifact rejects stale concept provenance` pass; both reject a mismatched fingerprint.
3. **Email alias merging could collapse or split unrelated same-name authors.** Evidence: the analytics suite passes both `merges renamed authors by email` and `separates same-name authors without shared context`, plus the full fixture resolves Ada/A. Lovelace to one two-work identity without publishing the email.

## Files owned by this handoff

- `docs/site/people-artifact.mjs`
- `docs/site/data/analysis/icml2026_people_topics.json`
- `scripts/build_people_topics.mjs`
- `scripts/test_people_topics_artifact.mjs`
- `docs/people-topics-handoff.md`

Integration edits are in `docs/site/app.js`, `config.js`, `data-loader.js`, `state.js`, `people-analytics.mjs`, `people-dashboard.mjs`, `author-map.mjs`, `scripts/build_site.sh`, `scripts/test_data_loader.mjs`, and `scripts/verify_ui_smoke.mjs`. These files also contain concurrent concept-extraction changes; preserve and review them together rather than reverting wholesale.
