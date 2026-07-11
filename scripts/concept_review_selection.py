from __future__ import annotations

import json
from pathlib import Path


def compact_text(value: str) -> str:
    return " ".join(value.replace("\x00", "").split())


def needs_review_result(record_id: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        "record_id": record_id,
        "core_concepts": [],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [],
        "confidence": 0.0,
        "review_status": "needs_review",
    }


def parse_records(path: Path, max_records: int, retry_ids: set[str] | None) -> list[dict[str, str]]:
    try:
        source = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read JSON from {path}: {exc}") from exc
    if not isinstance(source, dict) or not isinstance(source.get("records"), list):
        raise ValueError("candidate artifact must contain a records array")
    raw_records = source["records"]
    selected = raw_records[:max_records] if retry_ids is None else [
        item for item in raw_records
        if isinstance(item, dict) and compact_text(str(item.get("record_id") or item.get("id") or "")) in retry_ids
    ][:max_records]
    parsed: list[dict[str, str]] = []
    for index, raw_record in enumerate(selected):
        if not isinstance(raw_record, dict):
            raise ValueError(f"candidate record {index} is not an object")
        provenance = raw_record.get("provenance")
        source = provenance if isinstance(provenance, dict) else raw_record
        record_id = compact_text(str(raw_record.get("record_id") or raw_record.get("id") or ""))
        title = compact_text(str(source.get("title") or ""))
        abstract = compact_text(str(source.get("abstract") or ""))
        if not record_id or not title or not abstract:
            raise ValueError(f"candidate record {index} needs record_id and provenance title/abstract")
        candidates = raw_record.get("candidates")
        parsed.append({"id": record_id, "title": title, "abstract": abstract,
                       "candidates": json.dumps(candidates if isinstance(candidates, list) else [], ensure_ascii=False, separators=(",", ":"))})
    return parsed
