#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config
from scripts.build_icml_study_features import STAGES, StudySources, build_study_features, read_json


def assert_no_vector_like_arrays(value: Any, path: str = "$") -> None:
    if isinstance(value, list):
        if len(value) > 12 and all(isinstance(item, int | float) for item in value):
            raise AssertionError(f"vector-like array at {path}")
        for index, item in enumerate(value):
            assert_no_vector_like_arrays(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            assert_no_vector_like_arrays(item, f"{path}.{key}")


def main() -> None:
    index = read_json(config.INDEX_PATH)
    payload = build_study_features(StudySources(
        index=index,
        map_data=read_json(config.MAP_PATH),
        trends=read_json(config.TRENDS_PATH),
    ))

    record_ids = {str(record.get("id")) for record in index.get("records", []) if record.get("type") != "poster"}
    assert set(payload) == {"generatedAt", "source", "records", "topics", "outliers"}
    assert payload["records"]
    assert payload["topics"]
    assert payload["outliers"]

    rich_trails = 0
    for record_id, entry in payload["records"].items():
        assert record_id in record_ids
        trail = entry.get("studyTrail") or []
        compare = entry.get("compareCandidates") or []
        if len(trail) >= 5:
            rich_trails += 1
            assert len(trail) <= 10
        for item in trail:
            assert item["recordId"] in record_ids
            assert item["stage"] in STAGES
            assert item["reason"]
        for item in compare:
            assert item["recordId"] in record_ids
            assert item["reason"]
    assert rich_trails >= 100

    for item in payload["outliers"]:
        assert item["recordId"] in record_ids
        assert item["clusterId"]
        assert isinstance(item["score"], int | float)
        assert not re.search(r"novel|breakthrough|sota|state-of-the-art|first", item["reason"], re.I)

    serialized = json.dumps(payload, ensure_ascii=False)
    assert '"abstract"' not in serialized
    assert '"nearestNeighbors"' not in serialized
    assert '"references"' not in serialized
    assert_no_vector_like_arrays(payload)
    print(json.dumps({
        "records": len(payload["records"]),
        "topics": len(payload["topics"]),
        "outliers": len(payload["outliers"]),
        "richTrails": rich_trails,
    }, indent=2))


if __name__ == "__main__":
    main()
