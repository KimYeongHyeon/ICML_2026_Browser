#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from contracts import (
    ARTIFACT_SCHEMA,
    MANIFEST_SCHEMA,
    SOURCE_SCHEMA,
    assert_public_safe,
    canonical_json_bytes,
    load_config,
    normalize_queue,
    parse_json_bytes,
    public_record,
    sha256_bytes,
    source_fingerprint,
    validate_state_snapshot,
    write_bytes_atomic,
    write_json_atomic,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "data" / "source"
OUT_ROOT = ROOT / "docs" / "data"


def load_source(config: dict) -> tuple[list[dict], dict[str, dict], dict]:
    manifest_path = SOURCE_ROOT / "manifest.json"
    queue_path = SOURCE_ROOT / "queue.jsonl"
    state_path = SOURCE_ROOT / "archive-state.json"
    manifest = parse_json_bytes(manifest_path.read_bytes(), str(manifest_path))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SOURCE_SCHEMA:
        raise ValueError("invalid source manifest schema")
    if manifest.get("conference") != {"slug": config["slug"], "year": config["year"]}:
        raise ValueError("source manifest conference does not match conference.json")
    queue_bytes = queue_path.read_bytes()
    state_bytes = state_path.read_bytes()
    if sha256_bytes(queue_bytes) != manifest.get("queueSnapshotSha256"):
        raise ValueError("queue snapshot fingerprint mismatch")
    if sha256_bytes(state_bytes) != manifest.get("stateSnapshotSha256"):
        raise ValueError("state snapshot fingerprint mismatch")
    if not isinstance(manifest.get("statePresent"), bool):
        raise ValueError("source manifest statePresent must be a boolean")
    queue = normalize_queue(queue_bytes, config)
    state = validate_state_snapshot(parse_json_bytes(state_bytes, str(state_path)))
    if (
        type(manifest.get("queueRecordCount")) is not int
        or type(manifest.get("stateRecordCount")) is not int
        or len(queue) != manifest["queueRecordCount"]
        or len(state) != manifest["stateRecordCount"]
    ):
        raise ValueError("source manifest record counts do not match snapshots")
    queue_ids = {row["id"] for row in queue}
    orphan_state = sorted(set(state) - queue_ids)
    if orphan_state:
        raise ValueError(f"archive state contains IDs absent from queue: {orphan_state[:5]}")
    return queue, state, manifest


def build() -> tuple[dict, dict]:
    config = load_config(ROOT / "conference.json")
    queue, state, source_manifest = load_source(config)
    records = [public_record(row, state.get(row["id"])) for row in queue]
    records.sort(key=lambda record: (record["title"].casefold(), record["id"]))
    summary = {
        "total": len(records),
        "archived": sum(record["archived"] for record in records),
        "publicPdf": sum(bool(record["publicPdfUrl"]) for record in records),
        "unavailablePublicAccess": sum(
            record["accessStatus"] == "unavailable_public_access" for record in records
        ),
        "notStarted": sum(record["archiveStatus"] == "not_started" for record in records),
        "statePresent": bool(source_manifest.get("statePresent")),
    }
    fingerprint = source_fingerprint(
        source_manifest["queueSnapshotSha256"],
        source_manifest["stateSnapshotSha256"],
        source_manifest["statePresent"],
    )
    artifact = {
        "schemaVersion": ARTIFACT_SCHEMA,
        "generatedAt": source_manifest["syncedAt"],
        "conference": {
            "name": config["name"],
            "slug": config["slug"],
            "year": config["year"],
            "title": config["title"],
        },
        "sourceFingerprint": f"sha256:{fingerprint}",
        "summary": summary,
        "records": records,
    }
    assert_public_safe(artifact)
    artifact_bytes = canonical_json_bytes(artifact)
    manifest = {
        "schemaVersion": MANIFEST_SCHEMA,
        "generatedAt": artifact["generatedAt"],
        "conference": artifact["conference"],
        "recordCount": len(records),
        "artifactUrl": "data/records.json",
        "artifactSha256": f"sha256:{sha256_bytes(artifact_bytes)}",
        "sourceFingerprint": artifact["sourceFingerprint"],
    }
    assert_public_safe(manifest)
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    write_bytes_atomic(OUT_ROOT / "records.json", artifact_bytes)
    write_json_atomic(OUT_ROOT / "manifest.json", manifest)
    return artifact, manifest


def main() -> None:
    artifact, _ = build()
    print(json.dumps(artifact["summary"], ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
