#!/usr/bin/env python3
"""Validate the static ICML semantic-map data contract."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    index_path = Path(sys.argv[1]) if len(sys.argv) > 1 else config.INDEX_PATH
    map_path = Path(sys.argv[2]) if len(sys.argv) > 2 else config.MAP_PATH
    index = load(index_path)
    map_data = load(map_path)
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

    for record in index_records:
        record_id = str(record["id"])
        if record.get("mapAvailable"):
            if record_id not in map_ids:
                errors.append(f"index says mapAvailable but map record is missing: {record_id}")
            errors.extend(f"unknown area tag for {record_id}: {tag}" for tag in config.validate_area_tags(record.get("areaTags") or []))
            errors.extend(f"unknown domain tag for {record_id}: {tag}" for tag in config.validate_domain_tags(record.get("domainTags") or []))
            if record.get("embeddingTextQuality") not in {"title_abstract", "title_topic", "title_only"}:
                errors.append(f"invalid embeddingTextQuality for {record_id}: {record.get('embeddingTextQuality')}")

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


if __name__ == "__main__":
    main()
