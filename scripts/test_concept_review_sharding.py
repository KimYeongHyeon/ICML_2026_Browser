#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import concept_review_sharding as sharding  # noqa: E402


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_prepare_shards_only_includes_records_missing_from_root_manifest() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidate_path = directory / "candidates.json"
        root_manifest_path = directory / "reviews" / "manifest.json"
        write_json(candidate_path, {
            "schemaVersion": "icml-concept-candidates/v1",
            "source": {"source_fingerprint": "source-1"},
            "records": [
                {"record_id": "a", "provenance": {"title": "A", "abstract": "AA"}},
                {"record_id": "b", "provenance": {"title": "B", "abstract": "BB"}},
                {"record_id": "c", "provenance": {"title": "C", "abstract": "CC"}},
            ],
        })
        write_json(root_manifest_path, {
            "schemaVersion": "icml-concept-review-runner/v1",
            "fingerprints": {"candidateContent": "root"},
            "records": {"a": {"status": "completed"}},
        })

        paths = sharding.prepare_shards(candidate_path, root_manifest_path, directory / "shards", 2)

        assert len(paths) == 2
        selected = [
            record["record_id"]
            for path in paths
            for record in json.loads(path.read_text(encoding="utf-8"))["records"]
        ]
        assert sorted(selected) == ["b", "c"]


def test_merge_shards_preserves_root_fingerprint_and_copies_new_cache() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        root_dir = directory / "root"
        shard_dir = directory / "shard-000"
        root_fingerprints = {
            "candidateContent": "root-candidates",
            "schema": "schema",
            "model": "model",
            "cliVersion": "cli",
            "promptTemplate": "prompt",
        }
        write_json(root_dir / "manifest.json", {
            "schemaVersion": "icml-concept-review-runner/v1",
            "fingerprints": root_fingerprints,
            "records": {"a": {"status": "completed", "fingerprints": {"content": "a"}}},
        })
        write_json(shard_dir / "candidates.json", {
            "schemaVersion": "icml-concept-candidates/v1",
            "source": {"source_fingerprint": "source-1"},
            "records": [{"record_id": "b", "provenance": {"title": "B", "abstract": "BB"}}],
        })
        state_fingerprints = {**root_fingerprints, "content": "b", "prompt": "b-prompt"}
        write_json(shard_dir / "reviews" / "manifest.json", {
            "schemaVersion": "icml-concept-review-runner/v1",
            "fingerprints": {**root_fingerprints, "candidateContent": "shard-candidates"},
            "records": {"b": {"status": "skipped", "fingerprints": state_fingerprints}},
        })
        cache_name = sharding.record_filename("b")
        write_json(shard_dir / "reviews" / "cache" / f"{cache_name}.json", {
            "fingerprints": state_fingerprints,
            "review": {"record_id": "b", "review_status": "accepted"},
        })
        (shard_dir / "reviews" / "logs").mkdir(parents=True)
        (shard_dir / "reviews" / "logs" / f"{cache_name}.attempt-1.last-message.json").write_text("{}", encoding="utf-8")

        merged_count = sharding.merge_shards(root_dir, (shard_dir,))

        merged = json.loads((root_dir / "manifest.json").read_text(encoding="utf-8"))
        assert merged_count == 2
        assert merged["fingerprints"] == root_fingerprints
        assert set(merged["records"]) == {"a", "b"}
        assert (root_dir / "cache" / f"{cache_name}.json").exists()
        assert (root_dir / "logs" / f"{cache_name}.attempt-1.last-message.json").exists()


def test_retry_shards_replace_every_unresolved_root_cache() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        root_dir = directory / "root"
        root_fingerprints = {
            "candidateContent": "root-candidates",
            "schema": "schema",
            "model": "model",
            "cliVersion": "cli",
            "promptTemplate": "prompt",
        }
        fingerprints = {**root_fingerprints, "content": "b", "prompt": "b-prompt"}
        write_json(directory / "candidates.json", {
            "schemaVersion": "icml-concept-candidates/v1",
            "records": [
                {"record_id": "a", "provenance": {"title": "A", "abstract": "AA"}},
                {"record_id": "b", "provenance": {"title": "B", "abstract": "BB"}},
            ],
        })
        write_json(root_dir / "manifest.json", {
            "schemaVersion": "icml-concept-review-runner/v1",
            "fingerprints": root_fingerprints,
            "records": {
                "a": {"status": "completed", "fingerprints": {**root_fingerprints, "content": "a", "prompt": "a"}},
                "b": {"status": "needs_review"},
            },
        })
        cache_name = sharding.record_filename("b")
        write_json(root_dir / "cache" / f"{cache_name}.json", {
            "fingerprints": fingerprints,
            "review": {"record_id": "b", "review_status": "needs_review"},
        })

        paths = sharding.prepare_retry_shards(directory / "candidates.json", root_dir, directory / "retry", 2)

        assert len(paths) == 1
        shard_dir = paths[0].parent
        retry_manifest_path = shard_dir / "reviews" / "manifest.json"
        retry_manifest = json.loads(retry_manifest_path.read_text(encoding="utf-8"))
        assert set(retry_manifest["records"]) == {"b"}
        write_json(retry_manifest_path, {
            **retry_manifest,
            "records": {"b": {"status": "completed", "fingerprints": fingerprints}},
        })
        write_json(shard_dir / "reviews" / "cache" / f"{cache_name}.json", {
            "fingerprints": fingerprints,
            "review": {"record_id": "b", "review_status": "accepted"},
        })
        (shard_dir / "reviews" / "logs").mkdir(parents=True)
        (shard_dir / "reviews" / "logs" / f"{cache_name}.attempt-1.last-message.json").write_text("{}", encoding="utf-8")

        merged_count = sharding.merge_retry_shards(root_dir, (shard_dir,))

        merged = json.loads((root_dir / "manifest.json").read_text(encoding="utf-8"))
        assert merged_count == 2
        assert merged["records"]["b"]["status"] == "completed"
        assert json.loads((root_dir / "cache" / f"{cache_name}.json").read_text(encoding="utf-8"))["review"]["review_status"] == "accepted"


def test_retry_shards_preserve_conflicting_prior_logs_under_audit_path() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        root_dir = directory / "root"
        retry_dir = directory / "retry-round-001" / "shard-000"
        root_fingerprints = {
            "candidateContent": "root-candidates",
            "schema": "schema",
            "model": "model",
            "cliVersion": "cli",
            "promptTemplate": "prompt",
        }
        fingerprints = {**root_fingerprints, "content": "b", "prompt": "b-prompt"}
        cache_name = sharding.record_filename("b")
        write_json(root_dir / "manifest.json", {
            "schemaVersion": "icml-concept-review-runner/v1",
            "fingerprints": root_fingerprints,
            "records": {"b": {"status": "needs_review", "fingerprints": fingerprints}},
        })
        write_json(root_dir / "cache" / f"{cache_name}.json", {
            "fingerprints": fingerprints,
            "review": {"record_id": "b", "review_status": "needs_review"},
        })
        write_json(retry_dir / "candidates.json", {
            "schemaVersion": "icml-concept-candidates/v1",
            "records": [{"record_id": "b", "provenance": {"title": "B", "abstract": "BB"}}],
        })
        write_json(retry_dir / "reviews" / "manifest.json", {
            "schemaVersion": "icml-concept-review-runner/v1",
            "fingerprints": {**root_fingerprints, "candidateContent": "retry-candidates"},
            "records": {"b": {"status": "completed", "fingerprints": fingerprints}},
        })
        write_json(retry_dir / "reviews" / "cache" / f"{cache_name}.json", {
            "fingerprints": fingerprints,
            "review": {"record_id": "b", "review_status": "accepted"},
        })
        log_name = f"{cache_name}.attempt-1.stderr.log"
        (root_dir / "logs").mkdir(parents=True)
        (root_dir / "logs" / log_name).write_text("prior", encoding="utf-8")
        (retry_dir / "reviews" / "logs").mkdir(parents=True)
        (retry_dir / "reviews" / "logs" / log_name).write_text("retry", encoding="utf-8")

        sharding.merge_retry_shards(root_dir, (retry_dir,))

        assert (root_dir / "logs" / log_name).read_text(encoding="utf-8") == "prior"
        audit_log = root_dir / "logs" / "retries" / "retry-round-001" / "shard-000" / log_name
        assert audit_log.read_text(encoding="utf-8") == "retry"


if __name__ == "__main__":
    test_prepare_shards_only_includes_records_missing_from_root_manifest()
    test_merge_shards_preserves_root_fingerprint_and_copies_new_cache()
    test_retry_shards_replace_every_unresolved_root_cache()
    test_retry_shards_preserve_conflicting_prior_logs_under_audit_path()
    print("concept review sharding tests passed")
