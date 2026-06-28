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
trend_path = path.with_name("icml2026_trends.json")
study_path = path.with_name("icml2026_study_features.json")
startup_path = path.with_name("icml2026_startup.json")

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

if not trend_path.exists():
    errors.append(f"missing trend cards artifact: {trend_path}")
else:
    trends = json.loads(trend_path.read_text(encoding="utf-8")).get("trends", [])
    record_ids = {str(record.get("id") or "") for record in records}
    if not trends:
        errors.append("trend cards artifact has no trends")
    for trend in trends:
        if not trend.get("id") or not trend.get("name") or not trend.get("keywords"):
            errors.append(f"incomplete trend card: {trend.get('id')}")
        representative_ids = trend.get("representativeRecordIds") or []
        if not representative_ids:
            errors.append(f"trend card has no representatives: {trend.get('id')}")
        missing_ids = [record_id for record_id in representative_ids if str(record_id) not in record_ids]
        if missing_ids:
            errors.append(f"trend card references missing records: {trend.get('id')} {missing_ids[:5]}")
        first_reads = trend.get("firstReadRecordIds") or []
        for key in ("coreQuestion", "representativeMethodology", "subBranches"):
            if not trend.get(key):
                errors.append(f"trend card missing study field {key}: {trend.get('id')}")
        if len(first_reads) < min(3, len(representative_ids)):
            errors.append(f"trend card has too few first reads: {trend.get('id')}")
        missing_first_reads = [record_id for record_id in first_reads if str(record_id) not in record_ids]
        if missing_first_reads:
            errors.append(f"trend card first reads missing records: {trend.get('id')} {missing_first_reads[:5]}")

if not study_path.exists():
    errors.append(f"missing study features artifact: {study_path}")
else:
    study = json.loads(study_path.read_text(encoding="utf-8"))
    if set(study) != {"generatedAt", "source", "records", "topics", "outliers"}:
        errors.append("study features artifact has unexpected top-level keys")
    if not study.get("records") or not study.get("topics"):
        errors.append("study features artifact has no records/topics")
    allowed_stages = {"intro", "core", "applied", "broader"}
    for record_id, entry in (study.get("records") or {}).items():
        if record_id not in record_ids:
            errors.append(f"study features include missing record: {record_id}")
            continue
        trail = entry.get("studyTrail") or []
        if len(trail) < 5 or len(trail) > 10:
            errors.append(f"study trail length outside bound: {record_id} {len(trail)}")
        for item in trail:
            if item.get("stage") not in allowed_stages:
                errors.append(f"study trail has invalid stage: {record_id} {item.get('stage')}")
            if str(item.get("recordId") or "") not in record_ids:
                errors.append(f"study trail references missing record: {record_id} {item.get('recordId')}")
        for item in entry.get("compareCandidates") or []:
            if str(item.get("recordId") or "") not in record_ids:
                errors.append(f"study compare references missing record: {record_id} {item.get('recordId')}")
    serialized_study = json.dumps(study, ensure_ascii=False).lower()
    for banned in ("\"abstract\"", "\"nearestneighbors\"", "\"references\"", "novel", "breakthrough", "sota"):
        if banned in serialized_study:
            errors.append(f"study features artifact contains banned payload/word: {banned}")
    if startup_path.exists():
        startup_text = startup_path.read_text(encoding="utf-8")
        if "icml2026_study_features" in startup_text or "studyTrail" in startup_text:
            errors.append("startup payload includes lazy study features")

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
if trend_path.exists():
    print(f"- trends: {len(json.loads(trend_path.read_text(encoding='utf-8')).get('trends', [])):,}")
if study_path.exists():
    print(f"- study records: {len(json.loads(study_path.read_text(encoding='utf-8')).get('records', {})):,}")
PY
