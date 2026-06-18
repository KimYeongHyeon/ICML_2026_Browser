#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INDEX_PATH="${1:-docs/site/data/icml2026_index.json}"

python3 - "$INDEX_PATH" <<'PY'
import json
import sys
from collections import Counter
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
records = data.get("records", [])

errors = []
allowed_status = {"accepted_public", "metadata_only", "metadata_only_pdf_not_public", "blocked", "unavailable", "downloaded", "failed", "skipped"}
generic_titles = {
    "call for papers",
    "official workshop page",
    "program",
    "schedule",
    "workshop program or schedule page",
}
target_title = "ℝ^{2k} is Theoretically Large Enough for Embedding-based Top-k Retrieval"

def plain_title(value: str) -> str:
    return (
        value.replace(r"$\mathbb{R}^{2k}$", "ℝ^{2k}")
        .replace(r"$k$", "k")
        .replace("$", "")
        .strip()
    )

for record in records:
    item_type = record.get("type")
    title = str(record.get("title") or "")
    source_type = record.get("sourceType")
    status = record.get("status")
    page_url = str(record.get("pageUrl") or "")
    category_tags = record.get("categoryTags")

    if item_type not in {"paper", "poster", "workshop"}:
        errors.append(f"invalid type for {record.get('id')}: {item_type}")
    if status and status not in allowed_status:
        errors.append(f"unexpected status for {record.get('id')}: {status}")
    if not isinstance(category_tags, list) or not category_tags:
        errors.append(f"missing categoryTags for {record.get('id')}: {title}")

    if item_type == "paper":
        if source_type != "official_icml_virtual_accepted_main_conference_metadata":
            errors.append(f"non-official main-conference paper source: {record.get('id')} {source_type} {title}")
        if status != "accepted_public":
            errors.append(f"non-accepted paper source: {record.get('id')} {status} {title}")

    if item_type == "poster" and source_type != "official_icml_virtual_poster":
        errors.append(f"non-official poster source: {record.get('id')} {source_type}")

    if item_type == "workshop":
        if source_type != "openreview_submission":
            errors.append(f"non-submission workshop source: {record.get('id')} {source_type} {title}")
        if status != "accepted_public":
            errors.append(f"non-accepted workshop source: {record.get('id')} {status} {title}")
        if title.strip().lower() in generic_titles:
            errors.append(f"generic workshop page leaked into results: {record.get('id')} {title}")

matches = [record for record in records if plain_title(str(record.get("title") or "")) == target_title]
if matches:
    match_types = {record.get("type") for record in matches}
    if "paper" not in match_types or "poster" not in match_types:
        errors.append(f"target title should appear as both accepted paper and poster presentation: {[(r.get('type'), r.get('id')) for r in matches]}")

counts = Counter(record.get("type") for record in records)
summary_counts = data.get("summary", {}).get("typeCounts", {})
for key in {"paper", "poster", "workshop"}:
    if counts.get(key, 0) != summary_counts.get(key, 0):
        errors.append(f"summary count mismatch for {key}: records={counts.get(key, 0)} summary={summary_counts.get(key, 0)}")

if errors:
    print("ICML site contract verification failed:", file=sys.stderr)
    for error in errors[:80]:
        print(f"- {error}", file=sys.stderr)
    if len(errors) > 80:
        print(f"- ... {len(errors) - 80} more", file=sys.stderr)
    raise SystemExit(1)

print("ICML site contract verification passed")
print(f"- records: {len(records):,}")
print(f"- papers: {counts.get('paper', 0):,}")
print(f"- posters: {counts.get('poster', 0):,}")
print(f"- workshops: {counts.get('workshop', 0):,}")
print(f"- multi-field records: {sum(1 for r in records if len(r.get('categoryTags') or []) > 1):,}")
PY
