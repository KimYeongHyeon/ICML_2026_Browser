from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


SCHEMA_VERSION = 1


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def build_embedding_text(record: dict[str, Any]) -> dict[str, str]:
    parts: list[str] = []
    title = normalize_text(record.get("title"))
    abstract = normalize_text(record.get("abstract"))
    group = normalize_text(record.get("group"))
    category = normalize_text(record.get("category"))
    item_type = normalize_text(record.get("type"))

    if title:
        parts.append(f"Title: {title}")
    if abstract:
        parts.append(f"Abstract: {abstract}")
        quality = "title_abstract"
    elif group or category:
        fallback = " ".join(part for part in [category, group] if part)
        parts.append(f"Context: {fallback}")
        quality = "title_topic"
    elif title:
        quality = "title_only"
    else:
        quality = "unavailable"
    if item_type:
        parts.append(f"Record type: {item_type}")

    return {"text": "\n".join(parts), "quality": quality}


def embedding_fingerprint(records: list[dict[str, Any]]) -> str:
    rows: list[dict[str, Any]] = []
    for record in records:
        payload = build_embedding_text(record)
        rows.append({
            "id": str(record.get("id") or ""),
            "type": str(record.get("type") or ""),
            "text": payload["text"],
            "quality": payload["quality"],
        })
    encoded = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def embedding_source_metadata(
    records: list[dict[str, Any]],
    *,
    searchable_record_count: int | None = None,
    index_generated_at: str = "",
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sourceFingerprint": embedding_fingerprint(records),
        "recordCount": len(records),
        "searchableRecordCount": len(records) if searchable_record_count is None else searchable_record_count,
        "indexGeneratedAt": index_generated_at,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
