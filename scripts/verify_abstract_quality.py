#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.abstract_quality import abstract_quality_flags  # noqa: E402


DEFAULT_PATHS = [
    ROOT / "docs/site/data/icml2026_index.json",
    ROOT / "docs/site/data/shards/paper.json",
    ROOT / "docs/site/data/shards/poster.json",
    ROOT / "docs/site/data/shards/workshop.json",
]


def read_records(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    records = payload.get("records", [])
    return records if isinstance(records, list) else []


def main() -> int:
    parser = argparse.ArgumentParser(description="Reject obviously contaminated abstract text in site artifacts.")
    parser.add_argument("paths", nargs="*", type=Path, default=DEFAULT_PATHS)
    parser.add_argument("--max-examples", type=int, default=20)
    args = parser.parse_args()

    failures: list[dict[str, Any]] = []
    scanned = 0
    for path in args.paths:
        for record in read_records(path):
            abstract = str(record.get("abstract") or "")
            if not abstract:
                continue
            scanned += 1
            flags = [flag for flag in abstract_quality_flags(abstract) if flag != "empty"]
            if flags:
                failures.append({
                    "file": str(path.relative_to(ROOT)),
                    "id": record.get("id"),
                    "type": record.get("type"),
                    "title": record.get("title"),
                    "flags": flags,
                    "abstract": abstract[:220],
                })

    if failures:
        print(json.dumps({
            "status": "failed",
            "scanned": scanned,
            "failures": failures[: args.max_examples],
            "failureCount": len(failures),
        }, ensure_ascii=False, indent=2))
        return 1

    print(json.dumps({"status": "passed", "scanned": scanned, "failureCount": 0}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
