# ICML 2026 Reference Collection Workflow

This workflow collects every reference that is publicly obtainable from the current ICML Atlas records by downloading local/OpenReview PDFs and extracting the bibliography with `pdftotext`.

It does not guarantee that every ICML paper has references. Some PDFs are unavailable, blocked, malformed, or do not expose a parseable bibliography section. Those records remain explicit zero-reference records, not guessed data.

## Safety Rules

- Do not depend on scholarly graph API quotas for the main collection path.
- Never commit downloaded PDFs or `.cache/`.
- Run bounded chunks into `/tmp` first.
- Merge chunks into another `/tmp` directory first.
- Validate the merged manifest before publishing.
- Publishing to `docs/site/data/references` requires `--publish`.

## Local Smoke Check

```bash
python3 scripts/build_icml_references.py --self-check

python3 scripts/build_icml_references.py \
  --source openreview-pdf \
  --offset 0 \
  --limit 25 \
  --out-root /tmp/icml_refs_smoke \
  --record-types paper,workshop

python3 scripts/build_icml_references.py --validate /tmp/icml_refs_smoke/manifest.json
```

## Full Online Collection

The repository includes a scheduled/manual GitHub Actions workflow named `Collect references`. It runs the same chunked flow below across the whole index, then merges, validates, and commits `docs/site/data/references`.

Use chunks so rate limits, network failures, or one bad title match cannot destroy the checked-in reference artifact.

```bash
mkdir -p /tmp/icml_refs_chunks

for offset in $(seq 0 500 13500); do
  python3 scripts/build_icml_references.py \
    --source openreview-pdf \
    --offset "$offset" \
    --limit 500 \
    --out-root "/tmp/icml_refs_chunks/chunk-$offset" \
    --sleep 0.15
done
```

If a chunk fails, rerun only that offset.

## Merge And Verify

```bash
python3 scripts/build_icml_references.py \
  --merge-chunks /tmp/icml_refs_chunks \
  --out-root /tmp/icml_refs_merged

python3 scripts/build_icml_references.py --validate /tmp/icml_refs_merged/manifest.json
scripts/verify_site_contract.sh docs/site/data/icml2026_index.json
```

Check the merged summary:

- `matchedRecords`: records with a parseable bibliography.
- `recordsWithReferences`: records with at least one public reference.
- `referenceStrings`: total collected reference entries.
- `recordsWithOverlaps`: records sharing references with another record.
- `errors`: request or parse failures that need reruns.

## PDF Extraction Quality

The PDF extraction is intentionally conservative. It drops short titles, author-only fragments, page ranges, URL-only fragments, and other broken `pdftotext` artifacts before writing shards. This can reduce the raw count, but it keeps the overlap graph from being driven by extraction noise. Remote PDFs are streamed to a temporary file for extraction and are not committed by this workflow.

## Publish

Only publish after the merged manifest validates and the summary improves the current checked-in artifact.

```bash
rm -rf docs/site/data/references.next
cp -R /tmp/icml_refs_merged docs/site/data/references.next

python3 scripts/build_icml_references.py --validate docs/site/data/references.next/manifest.json
rsync -a --delete docs/site/data/references.next/ docs/site/data/references/
rm -rf docs/site/data/references.next

python3 scripts/build_icml_references.py --validate docs/site/data/references/manifest.json
scripts/verify_site_contract.sh docs/site/data/icml2026_index.json
```

For direct chunk publishing, the script requires an explicit acknowledgement:

```bash
python3 scripts/build_icml_references.py \
  --merge-chunks /tmp/icml_refs_chunks \
  --out-root docs/site/data/references \
  --publish
```

Prefer the `.next` copy path above when preparing a commit, because it removes stale shards only after the new artifact validates.

## API Keys

No API key is required for the default reference collection workflow.
