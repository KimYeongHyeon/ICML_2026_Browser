#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from test_concept_review_runner import run_runner, write_json


def needs_review_output() -> str:
    return json.dumps({
        "record_id": "paper-1",
        "schema_version": 1,
        "core_concepts": [],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [],
        "confidence": 0.5,
        "review_status": "needs_review",
    })


def test_valid_needs_review_response_remains_unresolved() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        result = run_runner(directory, environment={
            "FAKE_CALLS": str(directory / "calls.jsonl"),
            "FAKE_OUTPUT": needs_review_output(),
        })

        assert result.returncode == 0, result.stderr
        manifest = json.loads((directory / "out" / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["records"]["paper-1"]["status"] == "needs_review"


def test_resume_reclassifies_old_completed_needs_review_cache_without_new_call() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        calls = directory / "calls.jsonl"
        environment = {"FAKE_CALLS": str(calls), "FAKE_OUTPUT": needs_review_output()}
        initial = run_runner(directory, environment=environment)
        assert initial.returncode == 0, initial.stderr
        manifest_path = directory / "out" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["records"]["paper-1"]["status"] = "completed"
        write_json(manifest_path, manifest)

        resumed = run_runner(directory, environment=environment)

        assert resumed.returncode == 0, resumed.stderr
        assert len(calls.read_text(encoding="utf-8").splitlines()) == 1
        updated = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert updated["records"]["paper-1"]["status"] == "needs_review"


def run() -> None:
    test_valid_needs_review_response_remains_unresolved()
    test_resume_reclassifies_old_completed_needs_review_cache_without_new_call()
    print("concept review status tests passed")


if __name__ == "__main__":
    run()
