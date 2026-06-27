#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config
from scripts.build_icml_embedding_map import build_embedding_cluster_levels


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    index = read_json(config.INDEX_PATH)
    map_data = read_json(config.MAP_PATH)
    index_by_id = {str(record["id"]): record for record in index.get("records", [])}
    records = []
    points = []
    for map_record in map_data.get("records", []):
        record_id = str(map_record.get("id") or "")
        record = index_by_id.get(record_id)
        if not record:
            raise SystemExit(f"map record missing from index: {record_id}")
        records.append(record)
        points.append([
            float(map_record.get("x") or 0.0),
            float(map_record.get("y") or 0.0),
            float(map_record.get("z") or 0.0),
        ])
    map_data["embeddingClusterLevels"] = build_embedding_cluster_levels(records, points)
    write_json(config.MAP_PATH, map_data)
    print(
        "Wrote embeddingClusterLevels:",
        ", ".join(str(level["k"]) for level in map_data["embeddingClusterLevels"]),
    )


if __name__ == "__main__":
    main()
