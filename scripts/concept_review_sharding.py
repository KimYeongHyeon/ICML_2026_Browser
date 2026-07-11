from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from scripts.concept_review_lock import output_lock
from scripts.concept_review_recovery import record_filename
from scripts.concept_review_runner import atomic_write_json


class ShardingError(Exception):
    pass


ACCEPTED_STATES = frozenset({"completed", "skipped"})
TERMINAL_STATES = ACCEPTED_STATES | {"needs_review"}


@dataclass(frozen=True, slots=True)
class ShardCandidate:
    directory: Path
    candidate_path: Path
    record_ids: tuple[str, ...]


def _read_object(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ShardingError(f"cannot read JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ShardingError(f"expected object in {path}")
    return value


def _record_id(value: object) -> str:
    if not isinstance(value, dict):
        raise ShardingError("candidate record is not an object")
    raw = value.get("record_id", value.get("id"))
    if not isinstance(raw, str) or not raw.strip():
        raise ShardingError("candidate record has no record_id")
    return " ".join(raw.split())


def _records(payload: Mapping[str, object]) -> list[dict[str, object]]:
    raw_records = payload.get("records")
    if not isinstance(raw_records, list):
        raise ShardingError("candidate artifact requires records array")
    records: list[dict[str, object]] = []
    for raw in raw_records:
        if not isinstance(raw, dict):
            raise ShardingError("candidate record is not an object")
        _record_id(raw)
        records.append(raw)
    return records


def prepare_shards(
    candidate_path: Path,
    root_manifest_path: Path,
    shard_root: Path,
    shard_count: int,
) -> tuple[Path, ...]:
    if shard_count < 1:
        raise ShardingError("shard_count must be positive")
    candidate = _read_object(candidate_path)
    manifest = _read_object(root_manifest_path)
    root_states = manifest.get("records")
    if not isinstance(root_states, dict):
        raise ShardingError("root manifest requires records object")
    remaining = [record for record in _records(candidate) if _record_id(record) not in root_states]
    if not remaining:
        return ()
    count = min(shard_count, len(remaining))
    buckets: list[list[dict[str, object]]] = [[] for _ in range(count)]
    for index, record in enumerate(remaining):
        buckets[index % count].append(record)
    paths: list[Path] = []
    for index, records in enumerate(buckets):
        directory = shard_root / f"shard-{index:03d}"
        candidate_output = directory / "candidates.json"
        payload = {**candidate, "records": records}
        atomic_write_json(candidate_output, payload)
        paths.append(candidate_output)
    return tuple(paths)


def prepare_retry_shards(
    candidate_path: Path,
    root_dir: Path,
    shard_root: Path,
    shard_count: int,
) -> tuple[Path, ...]:
    if shard_count < 1:
        raise ShardingError("shard_count must be positive")
    candidate = _read_object(candidate_path)
    root_manifest = _read_object(root_dir / "manifest.json")
    root_states = root_manifest.get("records")
    root_fingerprints = root_manifest.get("fingerprints")
    if not isinstance(root_states, dict) or not isinstance(root_fingerprints, dict):
        raise ShardingError("root manifest is incomplete")
    selected_ids = {
        record_id
        for record_id, state in root_states.items()
        if isinstance(state, dict) and state.get("status") == "needs_review"
    }
    records_by_id = {_record_id(record): record for record in _records(candidate)}
    if len(records_by_id) != len(_records(candidate)):
        raise ShardingError("candidate artifact contains duplicate record IDs")
    missing = selected_ids.difference(records_by_id)
    if missing:
        raise ShardingError(f"root needs_review IDs are absent from candidates: {sorted(missing)[:3]}")
    if not selected_ids:
        return ()
    selected = [record for record in _records(candidate) if _record_id(record) in selected_ids]
    for record in selected:
        record_id = _record_id(record)
        _validate_cache_record(
            root_dir / "cache" / f"{record_filename(record_id)}.json",
            root_states[record_id],
            record_id,
            require_state_fingerprints=False,
        )
    count = min(shard_count, len(selected))
    buckets: list[list[dict[str, object]]] = [[] for _ in range(count)]
    for index, record in enumerate(selected):
        buckets[index % count].append(record)
    for index in range(count):
        directory = shard_root / f"shard-{index:03d}"
        if directory.exists() and any(directory.iterdir()):
            raise ShardingError(f"retry shard directory is not empty: {directory}")
    for index, bucket in enumerate(buckets):
        directory = shard_root / f"shard-{index:03d}"
        candidate_output = directory / "candidates.json"
        shard_ids = [_record_id(record) for record in bucket]
        shard_manifest = {
            **root_manifest,
            "records": {record_id: root_states[record_id] for record_id in shard_ids},
        }
        atomic_write_json(candidate_output, {**candidate, "records": bucket})
        atomic_write_json(directory / "reviews" / "manifest.json", shard_manifest)
        for record_id in shard_ids:
            source_cache = root_dir / "cache" / f"{record_filename(record_id)}.json"
            target_cache = directory / "reviews" / "cache" / source_cache.name
            target_cache.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_cache, target_cache)
    return tuple(shard_root / f"shard-{index:03d}" / "candidates.json" for index in range(count))


def _validate_cache_record(
    cache_path: Path,
    state: object,
    record_id: str,
    *,
    require_state_fingerprints: bool = True,
) -> dict[str, object]:
    if not isinstance(state, dict):
        raise ShardingError(f"record {record_id} state is invalid")
    state_fingerprints = state.get("fingerprints")
    cache = _read_object(cache_path)
    review = cache.get("review")
    if require_state_fingerprints and not isinstance(state_fingerprints, dict):
        raise ShardingError(f"record {record_id} has no state fingerprints")
    if isinstance(state_fingerprints, dict) and cache.get("fingerprints") != state_fingerprints:
        raise ShardingError(f"record {record_id} cache fingerprint mismatch")
    if not isinstance(review, dict) or review.get("record_id") != record_id:
        raise ShardingError(f"record {record_id} cache review mismatch")
    status = state.get("status")
    expected_review_status = "accepted" if status in ACCEPTED_STATES else "needs_review"
    if status not in TERMINAL_STATES or review.get("review_status") != expected_review_status:
        raise ShardingError(f"record {record_id} has inconsistent terminal status")
    return cache


def _validate_shard(
    root_fingerprints: Mapping[str, object],
    shard_dir: Path,
    existing_ids: set[str],
) -> tuple[dict[str, object], dict[str, object], list[str]]:
    expected = [_record_id(record) for record in _records(_read_object(shard_dir / "candidates.json"))]
    if len(expected) != len(set(expected)) or existing_ids.intersection(expected):
        raise ShardingError(f"shard {shard_dir} has overlapping record IDs")
    manifest = _read_object(shard_dir / "reviews" / "manifest.json")
    fingerprints = manifest.get("fingerprints")
    states = manifest.get("records")
    if not isinstance(fingerprints, dict) or not isinstance(states, dict):
        raise ShardingError(f"shard {shard_dir} manifest is incomplete")
    for key in ("schema", "model", "cliVersion", "promptTemplate"):
        if fingerprints.get(key) != root_fingerprints.get(key):
            raise ShardingError(f"shard {shard_dir} fingerprint mismatch for {key}")
    if set(states) != set(expected):
        raise ShardingError(f"shard {shard_dir} manifest IDs do not match its candidate IDs")
    for record_id in expected:
        state = states[record_id]
        if not isinstance(state, dict) or state.get("status") not in TERMINAL_STATES:
            raise ShardingError(f"shard {shard_dir} record {record_id} is not terminal")
        cache_path = shard_dir / "reviews" / "cache" / f"{record_filename(record_id)}.json"
        _validate_cache_record(cache_path, state, record_id)
    return manifest, states, expected


def merge_shards(root_dir: Path, shard_dirs: tuple[Path, ...]) -> int:
    with output_lock(root_dir / ".lock", steal_lock=False):
        root_manifest_path = root_dir / "manifest.json"
        root_manifest = _read_object(root_manifest_path)
        root_fingerprints = root_manifest.get("fingerprints")
        root_states = root_manifest.get("records")
        if not isinstance(root_fingerprints, dict) or not isinstance(root_states, dict):
            raise ShardingError("root manifest is incomplete")
        merged = dict(root_states)
        prepared: list[tuple[Path, dict[str, object], list[str]]] = []
        known_ids = set(merged)
        for shard_dir in shard_dirs:
            _, states, record_ids = _validate_shard(root_fingerprints, shard_dir, known_ids)
            prepared.append((shard_dir, states, record_ids))
            known_ids.update(record_ids)
        for shard_dir, states, record_ids in prepared:
            shard_review_dir = shard_dir / "reviews"
            for record_id in record_ids:
                name = record_filename(record_id)
                source_cache = shard_review_dir / "cache" / f"{name}.json"
                target_cache = root_dir / "cache" / source_cache.name
                if target_cache.exists():
                    raise ShardingError(f"root cache already contains {record_id}")
                target_cache.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_cache, target_cache)
                for source_log in shard_review_dir.glob(f"logs/{name}.*"):
                    target_log = root_dir / "logs" / source_log.name
                    target_log.parent.mkdir(parents=True, exist_ok=True)
                    if target_log.exists():
                        raise ShardingError(f"root logs already contain {record_id}")
                    shutil.copy2(source_log, target_log)
                merged[record_id] = states[record_id]
        root_manifest["records"] = merged
        atomic_write_json(root_manifest_path, root_manifest)
    return len(merged)


def merge_retry_shards(root_dir: Path, shard_dirs: tuple[Path, ...]) -> int:
    with output_lock(root_dir / ".lock", steal_lock=False):
        root_manifest_path = root_dir / "manifest.json"
        root_manifest = _read_object(root_manifest_path)
        root_fingerprints = root_manifest.get("fingerprints")
        root_states = root_manifest.get("records")
        if not isinstance(root_fingerprints, dict) or not isinstance(root_states, dict):
            raise ShardingError("root manifest is incomplete")
        root_needs_review = {
            record_id
            for record_id, state in root_states.items()
            if isinstance(state, dict) and state.get("status") == "needs_review"
        }
        prepared: list[tuple[Path, dict[str, object], list[str]]] = []
        shard_ids: set[str] = set()
        for shard_dir in shard_dirs:
            _, states, record_ids = _validate_shard(root_fingerprints, shard_dir, shard_ids)
            if not set(record_ids).issubset(root_needs_review):
                raise ShardingError(f"retry shard {shard_dir} contains a record that is not unresolved in root")
            prepared.append((shard_dir, states, record_ids))
            shard_ids.update(record_ids)
        if shard_ids != root_needs_review:
            missing = root_needs_review.difference(shard_ids)
            raise ShardingError(f"retry shards do not cover all root needs_review records: {sorted(missing)[:3]}")
        transfers: list[tuple[Path, Path]] = []
        for shard_dir, _, record_ids in prepared:
            shard_review_dir = shard_dir / "reviews"
            for record_id in record_ids:
                name = record_filename(record_id)
                source_cache = shard_review_dir / "cache" / f"{name}.json"
                target_cache = root_dir / "cache" / source_cache.name
                if not target_cache.exists():
                    raise ShardingError(f"root cache is missing retry record {record_id}")
                transfers.append((source_cache, target_cache))
                for source_log in shard_review_dir.glob(f"logs/{name}.*"):
                    target_log = root_dir / "logs" / source_log.name
                    if target_log.exists():
                        if source_log.read_bytes() != target_log.read_bytes():
                            retry_log = root_dir / "logs" / "retries" / shard_dir.parent.name / shard_dir.name / source_log.name
                            if retry_log.exists() and source_log.read_bytes() != retry_log.read_bytes():
                                raise ShardingError(f"retry audit log conflicts with retry record {record_id}: {source_log.name}")
                            if not retry_log.exists():
                                transfers.append((source_log, retry_log))
                            continue
                        continue
                    transfers.append((source_log, target_log))
        for source, target in transfers:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        for _, states, record_ids in prepared:
            for record_id in record_ids:
                root_states[record_id] = states[record_id]
        atomic_write_json(root_manifest_path, root_manifest)
    return len(root_states)
