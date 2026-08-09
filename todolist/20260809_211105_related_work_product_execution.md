# Related-work product execution - 2026-08-09

## Requirements Analysis

- [x] Confirm the scope is product implementation and product review, not academic novelty research.
- [x] Record HDBSCAN as topic grouping/exploration only, not a hard filter for related-work ranking.
- [x] Record the required milestone order: artifact safety -> Work/Appearance identity -> clustering -> text-first related shards -> UX -> citation shadow/canary.
- [x] Identify the implementation owner as Codex task `019fe668-0a90-7c02-8e60-18dc8f85d181`.
- [x] Identify the read-only product monitor as Codex task `019fe668-a7dd-7ca1-848d-b17d6c82753b`.

## Implementation Plan

### Task orchestration

- [x] Create an isolated implementation worktree task.
- [x] Create an isolated product-monitor worktree task.
- [x] Cross-link the implementation and monitor task IDs.
- [x] Verify both tasks entered active state.
- [x] Verify the implementation task created an atomic `todolist/*.md` in its worktree (`20260809_211340_related_work_product_implementation.md`).
- [x] Verify the monitor task created an atomic `todolist/*.md` in its worktree (`20260809_211247_related_work_product_monitor.md`).
- [x] Give the monitor autonomous skill-selection rules and a world-class product-advisor operating brief.
- [x] Verify the monitor incorporated the new operating brief into its own checklist and active review behavior.
- [x] Create a root active goal that remains open until the implementation and monitor todos reach evidence-backed 100%.
- [x] Reactivate both related-work tasks and verify that each registered its own active goal instead of ending after one turn.

### Todo dashboard

- [x] Define the dashboard source contract from the canonical, implementation, and monitor todo files.
- [x] Implement a self-contained dashboard builder that derives every progress value from checkbox state.
- [x] Add a local server mode that rebuilds the dashboard from the todo files on every refresh.
- [x] Generate the initial dashboard and verify its counts match the source todo files (implementation 16/77, monitor 25/73, canonical 16/74 at 22:02 KST).
- [x] Verify the rendered dashboard in Codex in-app Browser: tabs/theme/filter work, filter state survives refresh, the toolbar precedes Milestone cards, console warnings/errors are empty, and desktop/exact-390px overflow is zero.
- [x] Start the local dashboard with durable command, PID, stdout/stderr, and structured status records (tmux `codex-todo-dashboard`, PID 87054, port 8765).

### Milestone 0 - stale and mixed artifact safety

- [x] Prove active-edition main IDs equal the official archive queue exactly (6,343; duplicates/missing/extra all zero) and that public-OA 4,252 plus explicit lawful-access gaps 2,091 partition the scope.
- [x] Read the configured NAS over SFTP and prove all 4,252 uploaded state entries have a matching remote PDF and byte size, with zero missing, extra, or size-mismatched files.
- [ ] Reproduce the current `sourceManifestGeneratedAt` mismatch in the implementation worktree.
- [ ] Add the reference-insights freshness verifier to CI.
- [ ] Define explicit browser states for network failure, no data, and stale/mixed release.
- [ ] Disable References when manifest and insights belong to different releases.
- [ ] Render a user-visible reason when References is disabled by artifact freshness.
- [ ] Add automated coverage for every artifact-state branch.
- [ ] Run the focused verifier and frontend regression checks.
- [ ] Obtain the monitor task's Milestone 0 review and resolve every `[BLOCKER]`.

### Milestone 1 - Work and Appearance identity

- [ ] Define one authoritative Work/Appearance identity contract.
- [ ] Implement deterministic work-family keys in DOI -> external ID -> provisional title/year/first-author order.
- [ ] Keep uncertain identities separate instead of silently merging them.
- [ ] Collapse same-family appearances before emitting related-work results.
- [ ] Add a hard test proving top-20 same-family duplicate count is zero.
- [ ] Measure identity merge precision and record whether its lower bound reaches 98%.
- [ ] Obtain the monitor task's Milestone 1 review and resolve every `[BLOCKER]`.

### Milestone 2 - topic clustering

- [ ] Reuse the authoritative SPECTER2 embedding artifact and validate its paper-ID alignment.
- [ ] Implement L2 normalization followed by deterministic PCA to 50 dimensions.
- [ ] Evaluate the agreed HDBSCAN parameter grid without optimizing for a target cluster count.
- [ ] Select a configuration using persistence/stability, noise ratio, giant-cluster ratio, and sampled coherence evidence.
- [ ] Emit deterministic edition-scoped cluster artifacts and capability metadata.
- [ ] Keep 2D UMAP artifacts isolated to visualization concerns.
- [ ] Add a test proving clustering failure does not disable semantic related-work results.
- [ ] Obtain the monitor task's Milestone 2 review and resolve every `[BLOCKER]`.

### Milestone 3 - text-first related-work shards

- [ ] Generate build-time global cosine candidates from normalized embeddings.
- [ ] Exclude the selected work and collapse same-family appearances.
- [ ] Emit edition-scoped content-addressed per-work top-20 shards.
- [ ] Add evidence records whose source IDs resolve at 100%.
- [ ] Verify each shard is no larger than 50 KB gzip.
- [ ] Prove the browser loads no related-work bytes before the feature is used.
- [ ] Obtain the monitor task's Milestone 3 review and resolve every `[BLOCKER]`.

### Milestone 4 - product UX

- [ ] Render top five related works for the selected paper.
- [ ] Add `View all 20` and `Explore topic cluster` expansion paths.
- [ ] Show earlier/later relation, at most two strongest evidence items, and explicit missingness.
- [ ] Add PDF, save, dismiss, and unsure actions with keyboard and focus behavior.
- [ ] Add explicit loading, empty, unavailable, degraded, and error states.
- [ ] Verify related-work UI p95 rendering is at most one second under the agreed fixture.
- [ ] Verify the flow in a real headed browser at representative viewport sizes.
- [ ] Obtain the monitor task's Milestone 4 review and resolve every `[BLOCKER]`.

### Milestone 5 - citation enhancement

- [ ] Implement verified citation-entity ingestion in shadow mode.
- [ ] Compute IDF bibliographic-coupling ranks without removing text candidates on failure.
- [ ] Combine text and citation ranks through an explicit RRF contract.
- [ ] Sample evidence cards and verify semantic support reaches at least 95%.
- [ ] Keep citation capability unavailable/degraded when evidence gates fail.
- [ ] Enable a citation canary only after all activation gates pass.
- [ ] Obtain the monitor task's Milestone 5 review and resolve every `[BLOCKER]`.

### Multi-conference and release completion

- [ ] Verify all paths derive from conference/year edition configuration rather than ICML constants.
- [ ] Verify the capability contract independently represents semantic related work, topic clusters, and citation evidence.
- [ ] Run a second-edition smoke fixture proving generation and deep-link behavior.
- [ ] Run the complete site regression suite.
- [ ] Update `plan.md` with the implemented contracts, validation evidence, and operational instructions.
- [ ] Add the final verified status summary to this todo list.
- [ ] Record the completion time only after all required checks pass.

## Progress Tracking

- [x] Started at: 21:11 KST
- [x] Current status: Implementation and product-monitor tasks are running as active goals; the todo dashboard has passed final in-app Browser verification after its two P1 fixes.
- [x] Blockers: Milestone 0 still requires an ID-set-complete canonical NAS reference rebuild aligned to the active edition before the monitor can issue PASS.

## Execution Rules

- Check an item only after its stated behavior is implemented and verified.
- Add newly discovered work as a new unchecked atomic item.
- Keep dependent milestones sequential; do not start citation activation before text-first behavior and evidence gates are proven.
- The implementation task owns code changes. The monitor task is read-only and may send `[BLOCKER]`, `[SHOULD]`, or `[LATER]` feedback.
- Do not commit or push unless the user explicitly requests it.
