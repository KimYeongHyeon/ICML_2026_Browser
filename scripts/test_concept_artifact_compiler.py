#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib
import json
import sys
import tempfile
from pathlib import Path
from typing import TypeAlias


ROOT = Path(__file__).resolve().parents[1]
JsonValue: TypeAlias = (
    None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def canonical_json(value: JsonValue) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def write_json(path: Path, payload: JsonValue) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def candidate_payload() -> dict[str, JsonValue]:
    return {
        "schemaVersion": "icml-concept-candidates/v1",
        "source": {
            "source_fingerprint": "sha256:source-fixture",
            "selectedRecordCount": 3,
        },
        "records": [
            {
                "record_id": "paper-b",
                "source_fingerprint": "sha256:source-fixture",
                "provenance": {
                    "title": "Weak Verifiers",
                    "abstract": "Weak verifiers guide routing.",
                },
            },
            {
                "record_id": "paper-a",
                "source_fingerprint": "sha256:source-fixture",
                "provenance": {
                    "title": "Block-Level Recursion",
                    "abstract": "Block-level recursion routes tokens.",
                },
            },
            {
                "record_id": "paper-failed",
                "source_fingerprint": "sha256:source-fixture",
                "provenance": {
                    "title": "Deferred Review",
                    "abstract": "This record was not reviewed.",
                },
            },
        ],
    }


def accepted_review(record_id: str, concept: str, title: str) -> dict[str, JsonValue]:
    return {
        "schema_version": 1,
        "record_id": record_id,
        "core_concepts": [concept],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [{"concept": concept, "field": "title", "excerpt": title}],
        "confidence": 0.9,
        "review_status": "accepted",
    }


def review_fixture(directory: Path, *, complete: bool = False) -> tuple[Path, Path]:
    runner = importlib.import_module("scripts.concept_review_runner")
    candidates_path = directory / "candidates.json"
    payload = candidate_payload()
    write_json(candidates_path, payload)
    candidate_text = candidates_path.read_text(encoding="utf-8")
    review_dir = directory / "review"
    global_fingerprints = {
        "schema": "sha256:schema-fixture",
        "model": "sha256:model-fixture",
        "cliVersion": "sha256:cli-fixture",
        "promptTemplate": "sha256:prompt-template-fixture",
    }
    states: dict[str, JsonValue] = {}
    if not complete:
        states["paper-failed"] = {"status": "failed", "errorCategory": "permanent"}
    for raw_record in payload["records"]:
        record = raw_record
        assert isinstance(record, dict)
        record_id = str(record["record_id"])
        if record_id == "paper-failed" and not complete:
            continue
        provenance = record["provenance"]
        assert isinstance(provenance, dict)
        runner_record = {
            "id": record_id,
            "title": str(provenance["title"]),
            "abstract": str(provenance["abstract"]),
            "candidates": "[]",
        }
        prompt = runner.build_prompt(runner_record)
        fingerprints = {
            **global_fingerprints,
            **runner.record_fingerprints(runner_record, prompt),
        }
        states[record_id] = {"status": "completed", "fingerprints": fingerprints}
        concept = {
            "paper-a": "Block-Level Recursion",
            "paper-b": "Weak Verifiers",
            "paper-failed": "Deferred Review",
        }[record_id]
        review = accepted_review(record_id, concept, runner_record["title"])
        cache = {"fingerprints": fingerprints, "review": review}
        cache_path = review_dir / "cache" / f"{runner.record_filename(record_id)}.json"
        write_json(cache_path, cache)
    manifest = {
        "schemaVersion": runner.RUNNER_SCHEMA_VERSION,
        "fingerprints": {
            **global_fingerprints,
            "candidateContent": sha256_text(canonical_json({"input": candidate_text})),
        },
        "records": states,
    }
    write_json(review_dir / "manifest.json", manifest)
    return candidates_path, review_dir


def test_compiler_publishes_only_validated_records_in_deterministic_compact_order() -> (
    None
):
    # Given
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    auditor = importlib.import_module("scripts.concept_artifact_audit")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidates_path, review_dir = review_fixture(directory, complete=True)
        output = directory / "published" / "concepts.json"

        # When
        artifact = compiler.compile_artifact(candidates_path, review_dir, output)

        # Then
        assert list(artifact["records"]) == ["paper-a", "paper-b", "paper-failed"]
        assert artifact["records"]["paper-a"] == {
            "core": ["Block-Level Recursion"],
            "detail": [],
        }
        assert artifact["summary"]["publishedRecordCount"] == 3
        assert artifact["summary"]["excludedRecordCount"] == 0
        assert artifact["summary"]["exclusionCounts"] == {}
        assert artifact["source"]["sourceFingerprint"] == "sha256:source-fixture"
        assert (
            artifact["review"]["runnerSchemaVersion"] == "icml-concept-review-runner/v1"
        )
        assert set(artifact["fingerprints"]) == {
            "artifact",
            "candidateArtifact",
            "reviewManifest",
        }
        assert auditor.audit_artifact(output, candidates_path, review_dir) == []


def test_compiler_imports_current_runner_filename_api() -> None:
    # Given
    runner = importlib.import_module("scripts.concept_review_runner")

    # When
    compiler = importlib.import_module("scripts.concept_artifact_compiler")

    # Then
    assert callable(runner.record_filename)
    assert compiler.record_filename is runner.record_filename


def test_compiler_publishes_valid_cached_reviews_from_an_earlier_prompt_template() -> None:
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    runner = importlib.import_module("scripts.concept_review_runner")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidates_path, review_dir = review_fixture(directory, complete=True)
        manifest_path = review_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        state = manifest["records"]["paper-a"]
        assert isinstance(state, dict)
        fingerprints = state["fingerprints"]
        assert isinstance(fingerprints, dict)
        fingerprints["content"] = "sha256:earlier-candidate-hints"
        fingerprints["prompt"] = "sha256:earlier-record-prompt"
        fingerprints["promptTemplate"] = "sha256:earlier-prompt-template"
        write_json(manifest_path, manifest)
        cache_path = review_dir / "cache" / f"{runner.record_filename('paper-a')}.json"
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        cache["fingerprints"]["content"] = "sha256:earlier-candidate-hints"
        cache["fingerprints"]["prompt"] = "sha256:earlier-record-prompt"
        cache["fingerprints"]["promptTemplate"] = "sha256:earlier-prompt-template"
        write_json(cache_path, cache)

        artifact = compiler.compile_artifact(candidates_path, review_dir, directory / "concepts.json")

        assert artifact["summary"]["publishedRecordCount"] == 3
        assert artifact["summary"]["excludedRecordCount"] == 0


def test_compiler_excludes_cache_with_mismatched_review_fingerprint() -> None:
    # Given
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    runner = importlib.import_module("scripts.concept_review_runner")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidates_path, review_dir = review_fixture(directory)
        cache_path = review_dir / "cache" / f"{runner.record_filename('paper-b')}.json"
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        cache["fingerprints"]["content"] = "sha256:tampered"
        write_json(cache_path, cache)

        # When
        artifact = compiler.build_artifact(candidates_path, review_dir)
        output = directory / "concepts.json"
        compile_error: str | None = None
        try:
            compiler.compile_artifact(candidates_path, review_dir, output)
        except compiler.CompileError as exc:
            compile_error = str(exc)
        else:
            raise AssertionError("incomplete coverage must not compile")

        # Then
        assert list(artifact["records"]) == ["paper-a"]
        assert artifact["summary"]["exclusionCounts"] == {
            "cache_fingerprint_mismatch": 1,
            "manifest_not_successful": 1,
        }
        assert compile_error is not None
        assert "incomplete candidate coverage" in compile_error
        assert not output.exists()


def test_compiler_rejects_nonstandard_json_constants_in_review_manifest() -> None:
    # Given
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidates_path, review_dir = review_fixture(directory)
        manifest_path = review_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["fingerprints"]["unexpected"] = float("inf")
        write_json(manifest_path, manifest)

        # When
        try:
            compiler.compile_artifact(
                candidates_path, review_dir, directory / "concepts.json"
            )
        except compiler.CompileError:
            # Then
            return
    raise AssertionError("nonstandard JSON constants must be rejected")


def test_compiler_and_auditor_reject_partial_candidate_coverage() -> None:
    # Given
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    auditor = importlib.import_module("scripts.concept_artifact_audit")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidates_path, review_dir = review_fixture(directory)
        output = directory / "partial-concepts.json"
        partial_artifact = compiler.build_artifact(candidates_path, review_dir)
        write_json(output, partial_artifact)

        # When
        compile_error: str | None = None
        try:
            compiler.compile_artifact(candidates_path, review_dir, output)
        except compiler.CompileError as exc:
            compile_error = str(exc)
        audit_errors = auditor.audit_artifact(output, candidates_path, review_dir)

        # Then
        assert compile_error is not None
        assert "incomplete candidate coverage" in compile_error
        assert any("incomplete candidate coverage" in error for error in audit_errors)


def test_audit_reports_artifact_tampering_and_candidate_source_drift() -> None:
    # Given
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    auditor = importlib.import_module("scripts.concept_artifact_audit")
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        candidates_path, review_dir = review_fixture(directory, complete=True)
        output = directory / "concepts.json"
        compiler.compile_artifact(candidates_path, review_dir, output)
        artifact = json.loads(output.read_text(encoding="utf-8"))
        artifact["records"]["paper-a"]["core"] = ["Tampered Concept"]
        write_json(output, artifact)
        candidate = json.loads(candidates_path.read_text(encoding="utf-8"))
        source = candidate["source"]
        assert isinstance(source, dict)
        source["source_fingerprint"] = "sha256:drifted-source"
        candidate_records = candidate["records"]
        assert isinstance(candidate_records, list)
        for record in candidate_records:
            assert isinstance(record, dict)
            record["source_fingerprint"] = "sha256:drifted-source"
        write_json(candidates_path, candidate)

        # When
        errors = auditor.audit_artifact(output, candidates_path, review_dir)

        # Then
        assert any("artifact fingerprint mismatch" in error for error in errors)
        assert any("candidate source fingerprint drift" in error for error in errors)
        assert any(
            "review manifest candidate fingerprint mismatch" in error
            for error in errors
        )


def run() -> None:
    test_compiler_imports_current_runner_filename_api()
    test_compiler_publishes_valid_cached_reviews_from_an_earlier_prompt_template()
    test_compiler_publishes_only_validated_records_in_deterministic_compact_order()
    test_compiler_excludes_cache_with_mismatched_review_fingerprint()
    test_compiler_rejects_nonstandard_json_constants_in_review_manifest()
    test_compiler_and_auditor_reject_partial_candidate_coverage()
    test_audit_reports_artifact_tampering_and_candidate_source_drift()
    print("concept artifact compiler tests passed")


if __name__ == "__main__":
    run()
