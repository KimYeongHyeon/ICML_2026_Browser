# ICML 2026 Main Conference Paper Materials Status

Checked at: 2026-06-17T04:49:04Z

## Scope

This folder is for ICML 2026 main-conference accepted papers only. Workshop materials and poster files are out of scope. Presentation slides are also excluded because the request is limited to paper PDFs and official/OpenReview supplemental PDF/ZIP files.

## Sources Checked

- Official ICML papers page: https://icml.cc/virtual/2026/papers.html
- Official ICML downloads/list page: https://icml.cc/Downloads/2026
- Official ICML public JSON backing the papers page: https://icml.cc/static/virtual/data/icml-2026-orals-posters.json
- OpenReview venue page: https://openreview.net/group?id=ICML.cc/2026/Conference
- OpenReview sample forum/PDF/attachment endpoints as guest
- PMLR index: https://proceedings.mlr.press/
- ICML 2026 Author Instructions: https://icml.cc/Conferences/2026/AuthorInstructions

## Result

- Official ICML raw event records in JSON: 6799
- Main-conference ICML/OpenReview event records in JSON: 6502
- Main-conference poster paper records with OpenReview forum links: 6343
- Main-conference oral event rows excluded as presentation duplicates: 159
- Paper PDFs downloaded: 0
- Supplemental PDFs/ZIPs downloaded: 0
- Records skipped/blocked because paper files are not public: 6343
- Failed downloads after a public file URL was found: 0

## Blocker

The official ICML site publicly enumerates main-conference paper metadata and OpenReview forum links, but it does not expose paper PDF URLs in the public ICML JSON or detail pages. The OpenReview venue page indicates the venue exists, but sample guest access to note/PDF/attachment endpoints returned HTTP 403. PMLR does not yet list ICML 2026 proceedings; its public index was last compiled on 2026-06-03 and the latest ICML proceedings page available from ICML links is ICML 2025, PMLR volume 267.

ICML's Author Instructions say accepted-paper manuscripts and supplementary material will become publicly available on OpenReview, and the latest camera-ready version will later be published through PMLR after the post-conference revision deadline. As of this check, those paper files are not publicly obtainable without authentication.

## Exclusions

The official ICML JSON includes media that is outside this thread's scope:

- Poster image media on main-conference records: 2870
- Slide PDF media on main-conference records: 695

These were not downloaded because poster files are explicitly out of scope and slides are presentation materials, not paper PDFs or supplemental PDF/ZIP files.

## Files

- `manifest.jsonl`: one record per public ICML main-conference poster paper metadata record.
- `source_icml_2026_orals_posters.json`: official ICML JSON snapshot used to build the manifest.
- `research_plan.md`: collection plan and gatekeeping rule.

## Manifest Status Values

- `metadata_only_pdf_not_public`: official paper metadata was collected, but no public paper PDF or official supplemental PDF/ZIP was available from ICML, OpenReview, or PMLR at check time.
