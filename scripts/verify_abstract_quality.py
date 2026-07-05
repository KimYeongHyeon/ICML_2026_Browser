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
    parser.add_argument("--max-empty-workshops", type=int, default=0)
    args = parser.parse_args()

    failures: list[dict[str, Any]] = []
    empty_workshops: dict[str, dict[str, Any]] = {}
    skipped_empty_unavailable: dict[str, dict[str, Any]] = {}
    scanned = 0
    for path in args.paths:
        for record in read_records(path):
            abstract = str(record.get("abstract") or "")
            if not abstract:
                if record.get("type") == "workshop":
                    empty_record = {
                        "file": str(path.relative_to(ROOT)),
                        "id": record.get("id"),
                        "title": record.get("title"),
                    }
                    has_material = bool(record.get("hasPdf") or record.get("localPdfPath") or record.get("pdfUrl"))
                    is_blocked = record.get("availabilityStatus") == "blocked"
                    if has_material or not is_blocked:
                        empty_workshops[str(record.get("id") or record.get("title"))] = empty_record
                    else:
                        skipped_empty_unavailable[str(record.get("id") or record.get("title"))] = empty_record
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

    empty_workshop_values = list(empty_workshops.values())
    if len(empty_workshop_values) > args.max_empty_workshops:
        failures.append({
            "file": "workshop abstracts",
            "id": "empty_workshop_abstracts",
            "type": "workshop",
            "title": f"{len(empty_workshop_values)} workshop records have no abstract",
            "flags": ["empty_workshop_abstract"],
            "abstract": json.dumps(empty_workshop_values[: args.max_examples], ensure_ascii=False),
        })

    if failures:
        print(json.dumps({
            "status": "failed",
            "scanned": scanned,
            "failures": failures[: args.max_examples],
            "failureCount": len(failures),
        }, ensure_ascii=False, indent=2))
        return 1

    print(json.dumps({
        "status": "passed",
        "scanned": scanned,
        "failureCount": 0,
        "skippedEmptyUnavailable": len(skipped_empty_unavailable),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
