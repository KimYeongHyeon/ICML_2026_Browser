#!/usr/bin/env python3
"""Validate the static ICML semantic-map data contract."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_path", nargs="?", type=Path, default=config.INDEX_PATH)
    parser.add_argument("map_path", nargs="?", type=Path, default=config.MAP_PATH)
    parser.add_argument("--require-fresh", action="store_true")
    args = parser.parse_args()
    index_path = args.index_path
    map_path = args.map_path
    index = load(index_path)
    map_data = load(map_path)
    search_data = load(config.SEARCH_EMBEDDINGS_PATH) if config.SEARCH_EMBEDDINGS_PATH.exists() else None
    sidecar_data = load(config.SEMANTIC_SIDECAR_PATH) if config.SEMANTIC_SIDECAR_PATH.exists() else None
    index_records = index.get("records", [])
    visible_ids = {str(record["id"]) for record in index_records}
    map_records = map_data.get("records", [])
    map_ids = {str(record["id"]) for record in map_records}
    errors: list[str] = []

    for record in map_records:
        record_id = str(record.get("id"))
        if record_id not in visible_ids:
            errors.append(f"map record does not exist in index: {record_id}")
        for key in ("x", "y", "z"):
            value = record.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                errors.append(f"invalid coordinate {key} for {record_id}: {value}")
        for neighbor in record.get("nearestNeighbors", []):
            neighbor_id = str(neighbor.get("id"))
            if neighbor_id not in visible_ids:
                errors.append(f"neighbor target missing for {record_id}: {neighbor_id}")
            score = neighbor.get("score")
            if not isinstance(score, (int, float)) or not math.isfinite(float(score)) or not 0 <= float(score) <= 1:
                errors.append(f"invalid neighbor score for {record_id}->{neighbor_id}: {score}")

    for record in index_records:
        record_id = str(record["id"])
        if record.get("mapAvailable"):
            if record_id not in map_ids:
                errors.append(f"index says mapAvailable but map record is missing: {record_id}")
            errors.extend(f"unknown area tag for {record_id}: {tag}" for tag in config.validate_area_tags(record.get("areaTags") or []))
            errors.extend(f"unknown domain tag for {record_id}: {tag}" for tag in config.validate_domain_tags(record.get("domainTags") or []))
            if record.get("embeddingTextQuality") not in {"title_abstract", "title_topic", "title_only"}:
                errors.append(f"invalid embeddingTextQuality for {record_id}: {record.get('embeddingTextQuality')}")

    if search_data:
        search_ids = {str(record.get("id")) for record in search_data.get("records", [])}
        searchable_ids = {str(record["id"]) for record in index_records if record.get("type") != "poster" and record.get("mapAvailable")}
        missing_search = sorted(searchable_ids - search_ids)
        extra_search = sorted(search_ids - visible_ids)
        if missing_search:
            errors.append(f"search embeddings missing {len(missing_search)} mapped non-poster records; first={missing_search[:3]}")
        if extra_search:
            errors.append(f"search embeddings contain unknown records; first={extra_search[:3]}")
        dimension = int(search_data.get("model", {}).get("dimension") or 0)
        expected_bytes = math.ceil(dimension * 4 / 3) if dimension else 0
        for record in search_data.get("records", [])[:20]:
            vector = record.get("vector")
            if not isinstance(vector, str) or (expected_bytes and len(vector) < expected_bytes - 4):
                errors.append(f"invalid search vector encoding for {record.get('id')}")
    embedding_summary = index.get("summary", {}).get("embedding") or {}
    expected = embedding_summary.get("expectedFingerprint")
    map_actual = (map_data.get("embeddingSource") or {}).get("sourceFingerprint")
    search_actual = (search_data.get("embeddingSource") or {}).get("sourceFingerprint") if search_data else ""
    sidecar_actual = (sidecar_data.get("embeddingSource") or {}).get("sourceFingerprint") if sidecar_data else ""
    stale = [
        name
        for name, actual in {"map": map_actual, "search": search_actual, "sidecar": sidecar_actual}.items()
        if expected and actual != expected
    ]
    if stale:
        message = f"semantic embedding artifacts are stale: {', '.join(stale)}"
        if args.require_fresh:
            errors.append(message)
        else:
            print(f"Warning: {message}", file=sys.stderr)

    if errors:
        print("ICML embedding map verification failed:", file=sys.stderr)
        for error in errors[:80]:
            print(f"- {error}", file=sys.stderr)
        if len(errors) > 80:
            print(f"- ... {len(errors) - 80} more", file=sys.stderr)
        raise SystemExit(1)

    print("ICML embedding map verification passed")
    print(f"- index records: {len(index_records):,}")
    print(f"- map records: {len(map_records):,}")
    print(f"- clusters: {len(map_data.get('clusters', [])):,}")
    if search_data:
        print(f"- search embeddings: {len(search_data.get('records', [])):,}")


if __name__ == "__main__":
    main()
