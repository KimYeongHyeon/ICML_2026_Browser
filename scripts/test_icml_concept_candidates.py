#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from extract_icml_concept_candidates import (
    CandidateExtractionConfig,
    InvalidCandidateIndex,
    build_candidate_payload,
    canonical_records,
    phrase_candidates,
)

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "docs" / "site" / "data" / "icml2026_index.json"


def test_canonical_index_merges_poster_assets_into_papers() -> None:
    payload = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    records = payload["records"]
    papers = [record for record in records if record.get("type") == "paper"]

    assert len(papers) >= 6_000
    assert not [record for record in records if record.get("type") == "poster"]
    assert sum(bool(record.get("hasPoster")) for record in papers) >= 1_500
    assert sum(bool(record.get("hasSlide")) for record in papers) >= 600


def test_candidates_are_concrete_bounded_and_evidenced() -> None:
    payload = {
        "records": [
            {
                "id": "paper:1",
                "type": "paper",
                "title": "Block-Level Recursion for Test-Time Routing",
                "abstract": (
                    "We introduce block-level recursion for adaptive test-time routing "
                    "in large language models. Our routing policy uses weak verifiers."
                ),
            },
            {
                "id": "poster:1",
                "type": "poster",
                "title": "Block-Level Recursion for Test-Time Routing",
                "abstract": "Poster-session duplicate that must not increase support.",
            },
            {
                "id": "workshop:1",
                "type": "workshop",
                "title": "Test-Time Scaling with Weak Verifiers",
                "abstract": "Weak verifiers provide feedback for test-time routing.",
            },
        ]
    }
    config = CandidateExtractionConfig(max_candidates=8, max_evidence_per_candidate=2)

    first = build_candidate_payload(payload, config)
    second = build_candidate_payload(payload, config)
    concepts = {item["normalizedConcept"]: item for item in first["candidates"]}
    records = {item["record_id"]: item for item in first["records"]}

    assert first["source"]["selectedRecordCount"] == 2
    assert first["source"]["excludedPosterCount"] == 1
    assert first["source"]["source_fingerprint"].startswith("sha256:")
    assert first["source"]["source_fingerprint"] == second["source"]["source_fingerprint"]
    assert len(first["candidates"]) <= 8
    assert records["paper:1"]["source_fingerprint"] == first["source"]["source_fingerprint"]
    assert records["paper:1"]["provenance"]["title"] == "Block-Level Recursion for Test-Time Routing"
    assert records["paper:1"]["provenance"]["abstract"].startswith("We introduce")
    assert "block-level recursion" in concepts
    assert "test-time routing" in concepts
    assert "weak verifiers" in concepts
    assert "large language models" not in concepts
    assert "language models" not in concepts
    assert concepts["test-time routing"]["evidence"][0]["record_id"] == "paper:1"
    assert concepts["weak verifiers"]["supportingRecordCount"] == 2
    assert all({"concept", "evidence", "score"} <= set(item) for item in records["paper:1"]["candidates"])
    assert {"field", "excerpt"} <= set(records["paper:1"]["candidates"][0]["evidence"])


def test_broad_model_labels_are_filtered() -> None:
    candidates = phrase_candidates(
        "Language models, diffusion models, and multimodal large language models are broad labels.",
        "title",
    )

    assert "language models" not in candidates
    assert "diffusion models" not in candidates
    assert "multimodal large language models" not in candidates


def test_phrases_do_not_cross_sentence_boundaries() -> None:
    candidates = phrase_candidates("We train robust models. Test-time routing improves results.", "abstract")

    assert "models test-time routing" not in candidates
    assert all(concept in evidence.excerpt.lower() for concept, evidence in candidates.items())


def test_candidates_keep_precise_terms_and_drop_observed_sentence_fragments() -> None:
    candidates = phrase_candidates(
        "Concept Erasure for Neural ODE uses Cross-sample Consistency Regularization. "
        "RED substantially recovers reasoning, while a novel loss function improves results.",
        "abstract",
    )

    assert "concept erasure" in candidates
    assert "neural ode" in candidates
    assert "cross-sample consistency regularization" in candidates
    assert "red substantially recovers reasoning" not in candidates
    assert "novel loss function" not in candidates


def test_duplicate_record_ids_are_rejected() -> None:
    payload = {
        "records": [
            {"id": "duplicate", "type": "paper", "title": "Weak Verifiers", "abstract": "Test-time routing."},
            {"id": "duplicate", "type": "paper", "title": "Block Recursion", "abstract": "Adaptive routing."},
        ]
    }

    try:
        canonical_records(payload)
    except InvalidCandidateIndex:
        pass
    else:
        raise AssertionError("duplicate record IDs must be rejected")


def test_records_missing_title_or_abstract_are_excluded_with_reasons() -> None:
    payload = {
        "records": [
            {"id": "valid", "type": "paper", "title": "Weak Verifiers", "abstract": "Test-time routing."},
            {"id": "missing-title", "type": "paper", "title": " ", "abstract": "Test-time routing."},
            {"id": "missing-abstract", "type": "workshop", "title": "Weak Verifiers", "abstract": ""},
            {"id": "missing-both", "type": "paper", "title": None, "abstract": None},
        ]
    }

    first = build_candidate_payload(payload, CandidateExtractionConfig(max_candidates=4))
    second = build_candidate_payload(payload, CandidateExtractionConfig(max_candidates=4))

    assert [record["record_id"] for record in first["records"]] == ["valid"]
    assert first["source"]["selectedRecordCount"] == 1
    assert first["source"]["excludedOtherCount"] == 3
    assert first["source"]["exclusionReasons"]["missing_title"] == 2
    assert first["source"]["exclusionReasons"]["missing_abstract"] == 2
    assert first["source"]["source_fingerprint"] == second["source"]["source_fingerprint"]
    assert all(record["provenance"]["title"] and record["provenance"]["abstract"] for record in first["records"])


def run() -> None:
    test_canonical_index_merges_poster_assets_into_papers()
    test_candidates_are_concrete_bounded_and_evidenced()
    test_broad_model_labels_are_filtered()
    test_phrases_do_not_cross_sentence_boundaries()
    test_candidates_keep_precise_terms_and_drop_observed_sentence_fragments()
    test_duplicate_record_ids_are_rejected()
    test_records_missing_title_or_abstract_are_excluded_with_reasons()
    print("concept candidate baseline test passed")


if __name__ == "__main__":
    run()
