#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import json
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from contracts import (
    SOURCE_SCHEMA,
    canonical_json_bytes,
    canonical_queue_bytes,
    load_config,
    normalize_archive_state,
    normalize_queue,
    parse_json_bytes,
    sha256_bytes,
    write_bytes_atomic,
    write_json_atomic,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "data" / "source"


@contextmanager
def archive_snapshot_locks(archive_root: Path, slug: str, year: int) -> Iterator[None]:
    lock_paths = [
        archive_root / ".queue-locks" / f"{slug}-{year}.lock",
        archive_root / ".state-locks" / f"{slug}-{year}.lock",
    ]
    with ExitStack() as stack:
        handles = []
        for path in lock_paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = stack.enter_context(path.open("a+b"))
            fcntl.flock(handle.fileno(), fcntl.LOCK_SH)
            handles.append(handle)
        try:
            yield
        finally:
            for handle in reversed(handles):
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def read_optional(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def stable_archive_read(queue_path: Path, state_path: Path, archive_root: Path, slug: str, year: int) -> tuple[bytes, bytes | None]:
    with archive_snapshot_locks(archive_root, slug, year):
        queue_first = queue_path.read_bytes()
        state_first = read_optional(state_path)
        queue_second = queue_path.read_bytes()
        state_second = read_optional(state_path)
    if queue_first != queue_second or state_first != state_second:
        raise RuntimeError("archive queue/state changed during snapshot; retry after the writer finishes")
    return queue_first, state_first


def previous_sync_time(
    manifest_path: Path,
    queue_hash: str,
    state_hash: str,
    state_present: bool,
    config: dict,
) -> str:
    if not manifest_path.exists():
        return ""
    previous = parse_json_bytes(manifest_path.read_bytes(), str(manifest_path))
    if not isinstance(previous, dict):
        raise ValueError("existing source manifest must be an object")
    same_source = (
        previous.get("schemaVersion") == SOURCE_SCHEMA
        and previous.get("conference") == {"slug": config["slug"], "year": config["year"]}
        and previous.get("queueSnapshotSha256") == queue_hash
        and previous.get("stateSnapshotSha256") == state_hash
        and previous.get("statePresent") is state_present
    )
    return str(previous.get("syncedAt") or "") if same_source else ""


def sync(archive_root: Path) -> dict:
    config = load_config(ROOT / "conference.json")
    archive_root = archive_root.expanduser().resolve()
    if not archive_root.is_dir():
        raise FileNotFoundError(f"archive root does not exist: {archive_root}")
    queue_path = archive_root / "queues" / config["slug"] / f"{config['year']}.jsonl"
    state_path = archive_root / "state" / config["slug"] / f"{config['year']}.json"
    queue_raw, state_raw = stable_archive_read(
        queue_path,
        state_path,
        archive_root,
        config["slug"],
        config["year"],
    )
    queue_rows = normalize_queue(queue_raw, config)
    state = normalize_archive_state(state_raw, config)
    queue_snapshot = canonical_queue_bytes(queue_rows)
    state_snapshot = canonical_json_bytes(state)
    queue_hash = sha256_bytes(queue_snapshot)
    state_hash = sha256_bytes(state_snapshot)
    manifest_path = SOURCE_ROOT / "manifest.json"
    state_present = state_raw is not None
    synced_at = previous_sync_time(
        manifest_path,
        queue_hash,
        state_hash,
        state_present,
        config,
    )
    if not synced_at:
        synced_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    manifest = {
        "schemaVersion": SOURCE_SCHEMA,
        "conference": {"slug": config["slug"], "year": config["year"]},
        "syncedAt": synced_at,
        "statePresent": state_present,
        "queueRecordCount": len(queue_rows),
        "stateRecordCount": len(state),
        "queueSource": f"queues/{config['slug']}/{config['year']}.jsonl",
        "stateSource": f"state/{config['slug']}/{config['year']}.json",
        "archiveQueueSha256": sha256_bytes(queue_raw),
        "archiveStateSha256": sha256_bytes(state_raw) if state_raw is not None else "",
        "queueSnapshotSha256": queue_hash,
        "stateSnapshotSha256": state_hash,
    }
    SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    write_bytes_atomic(SOURCE_ROOT / "queue.jsonl", queue_snapshot)
    write_bytes_atomic(SOURCE_ROOT / "archive-state.json", state_snapshot)
    write_json_atomic(manifest_path, manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Snapshot the canonical conference archive metadata.")
    parser.add_argument("--archive-root", type=Path, required=True)
    args = parser.parse_args()
    manifest = sync(args.archive_root)
    print(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
