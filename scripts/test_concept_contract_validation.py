#!/usr/bin/env python3
from __future__ import annotations

import importlib
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_contract_schema_declares_canonical_array_bounds() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")

    # When
    core_schema = contract.CONCEPT_SCHEMA["properties"]["core_concepts"]
    detail_schema = contract.CONCEPT_SCHEMA["properties"]["detail_concepts"]

    # Then
    assert core_schema["minItems"] == 0
    assert core_schema["maxItems"] == 3
    assert detail_schema["minItems"] == 0
    assert detail_schema["maxItems"] == 6


def test_normalizer_rejects_broad_generic_and_cross_level_duplicates() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Concept Erasure", "Machine Learning"],
        "detail_concepts": ["concept-erasure", "Neural ODE", "Optimization"],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Concept Erasure",
                "field": "title",
                "excerpt": "Concept Erasure",
            },
            {
                "concept": "Machine Learning",
                "field": "abstract",
                "excerpt": "machine learning",
            },
            {
                "concept": "concept-erasure",
                "field": "title",
                "excerpt": "Concept Erasure",
            },
            {"concept": "Neural ODE", "field": "title", "excerpt": "Neural ODE"},
            {"concept": "Optimization", "field": "abstract", "excerpt": "optimization"},
        ],
        "confidence": 0.91,
        "review_status": "accepted",
    }

    # When
    try:
        contract.normalize_concept_payload(
            payload,
            title="Concept Erasure for Neural ODE Models",
            abstract="We study machine learning optimization methods.",
        )
    except contract.ConceptContractError as error:
        # Then
        assert (
            str(error) == "forbidden broad concept in core_concepts: Machine Learning"
        )
        return
    raise AssertionError("selected broad labels must fail closed")


def test_normalizer_canonicalizes_bare_broad_rejections() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "r1",
        "core_concepts": ["Block-Level Recursion"],
        "detail_concepts": [],
        "rejected_candidates": ["Machine Learning"],
        "evidence": [
            {
                "concept": "Block-Level Recursion",
                "field": "title",
                "excerpt": "Block-Level Recursion for Routing",
            },
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    # When
    normalized = contract.normalize_concept_payload(
        payload,
        title="Block-Level Recursion for Routing",
        abstract="We study block-level recursion.",
    )

    # Then
    assert normalized["core_concepts"] == ["Block-Level Recursion"]
    assert normalized["rejected_candidates"] == [
        {"concept": "Machine Learning", "reason": "broad_label"},
    ]


def test_normalizer_rejects_forbidden_broad_core_label() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "r1",
        "core_concepts": ["Machine Learning"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Machine Learning",
                "field": "title",
                "excerpt": "Machine Learning for Routing",
            },
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    # When
    try:
        contract.normalize_concept_payload(
            payload,
            title="Machine Learning for Routing",
            abstract="We study machine learning.",
        )
    except contract.ConceptContractError as error:
        # Then
        assert (
            str(error) == "forbidden broad concept in core_concepts: Machine Learning"
        )
        return
    raise AssertionError("forbidden broad core label must be rejected")


def test_normalizer_preserves_legacy_rejected_candidate_objects() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "r1",
        "core_concepts": ["Block-Level Recursion"],
        "detail_concepts": [],
        "rejected_candidates": [
            {"concept": "Machine Learning", "reason": "broad_label"},
        ],
        "evidence": [
            {
                "concept": "Block-Level Recursion",
                "field": "title",
                "excerpt": "Block-Level Recursion",
            },
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    # When
    normalized = contract.normalize_concept_payload(
        payload,
        title="Block-Level Recursion for Routing",
        abstract="We study block-level recursion.",
    )

    # Then
    assert normalized["rejected_candidates"] == [
        {"concept": "Machine Learning", "reason": "broad_label"},
    ]


def test_normalizer_rejects_nonverbatim_evidence_excerpt() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "r1",
        "core_concepts": ["Adaptive Routing"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Adaptive Routing",
                "field": "title",
                "excerpt": "Adaptive, Routing",
            },
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    # When
    try:
        contract.normalize_concept_payload(
            payload,
            title="Adaptive Routing for Robust Systems",
            abstract="",
        )
    except contract.ConceptContractError as error:
        # Then
        assert str(error) == "ungrounded evidence for concept: Adaptive Routing"
        return
    raise AssertionError("evidence excerpts must be literal contiguous source spans")


def test_normalizer_rejects_schema_oversized_concept_label() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    concept = "Adaptive Routing" + "-" * 121
    payload = {
        "schema_version": 1,
        "record_id": "r1",
        "core_concepts": [concept],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Adaptive Routing",
                "field": "title",
                "excerpt": "Adaptive Routing",
            },
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    # When
    try:
        contract.normalize_concept_payload(payload, title=concept, abstract="")
    except contract.ConceptContractError as error:
        # Then
        assert str(error) == f"invalid concept in core_concepts: {concept}"
        return
    raise AssertionError("normalized concepts must satisfy the schema maxLength")


def test_normalizer_rejects_observed_sentence_fragments_and_keeps_precise_terms() -> None:
    contract = importlib.import_module("scripts.icml_concept_contract")
    bad_labels = [
        "code2video includes three agents",
        "over direct code generation",
        "large size makes inference",
        "minimal performance loss",
        "provide unbiased advantage estimation",
        "cross-modal interactions during training",
        "large-scale empirical evaluation",
        "latent representation",
        "synthetic data",
    ]
    for label in bad_labels:
        payload = {
            "schema_version": 1,
            "record_id": "r1",
            "core_concepts": [label],
            "detail_concepts": [],
            "rejected_candidates": [],
            "evidence": [{"concept": label, "field": "abstract", "excerpt": label}],
            "confidence": 0.9,
            "review_status": "accepted",
        }
        try:
            contract.normalize_concept_payload(payload, title="", abstract=label)
        except contract.ConceptContractError:
            continue
        raise AssertionError(f"sentence fragment must be rejected: {label}")

    payload = {
        "schema_version": 1,
        "record_id": "r2",
        "core_concepts": ["Concept Erasure", "Neural ODE"],
        "detail_concepts": ["Adjoint Sensitivity"],
        "rejected_candidates": [],
        "evidence": [
            {"concept": "Concept Erasure", "field": "title", "excerpt": "Concept Erasure"},
            {"concept": "Neural ODE", "field": "title", "excerpt": "Neural ODE"},
            {"concept": "Adjoint Sensitivity", "field": "abstract", "excerpt": "adjoint sensitivity"},
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }
    normalized = contract.normalize_concept_payload(
        payload,
        title="Concept Erasure for Neural ODE",
        abstract="We use adjoint sensitivity.",
    )
    assert normalized["core_concepts"] == ["Concept Erasure", "Neural ODE"]

    titled_payload = {
        **payload,
        "record_id": "r3",
        "core_concepts": ["An Explicit Memory-Driven Agentic Framework"],
        "detail_concepts": [],
        "evidence": [{
            "concept": "An Explicit Memory-Driven Agentic Framework",
            "field": "title",
            "excerpt": "An Explicit Memory-Driven Agentic Framework",
        }],
    }
    titled = contract.normalize_concept_payload(
        titled_payload,
        title="An Explicit Memory-Driven Agentic Framework for Power System Simulation",
        abstract="We introduce an explicit memory-driven agentic framework.",
    )
    assert titled["core_concepts"] == ["An Explicit Memory-Driven Agentic Framework"]


def test_normalizer_accepts_named_benchmark_and_evaluation_protocols() -> None:
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "r4",
        "core_concepts": ["Reward Hacking Benchmark", "Decision Theoretic Explanation Evaluation"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {"concept": "Reward Hacking Benchmark", "field": "title", "excerpt": "Reward Hacking Benchmark"},
            {"concept": "Decision Theoretic Explanation Evaluation", "field": "title", "excerpt": "Decision Theoretic Explanation Evaluation"},
        ],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    normalized = contract.normalize_concept_payload(
        payload,
        title="Reward Hacking Benchmark and Decision Theoretic Explanation Evaluation",
        abstract="",
    )

    assert normalized["core_concepts"] == ["Decision Theoretic Explanation Evaluation", "Reward Hacking Benchmark"]


def test_normalizer_accepts_evidence_inside_source_presentation_markup() -> None:
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "r5",
        "core_concepts": ["weighted Wasserstein regularized risk"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [{
            "concept": "weighted Wasserstein regularized risk",
            "field": "abstract",
            "excerpt": "weighted Wasserstein regularized risk",
        }],
        "confidence": 0.9,
        "review_status": "accepted",
    }

    normalized = contract.normalize_concept_payload(
        payload,
        title="Program verification",
        abstract="We obtain the *weighted* Wasserstein regularized risk.",
    )

    assert normalized["core_concepts"] == ["weighted Wasserstein regularized risk"]


def run() -> None:
    test_contract_schema_declares_canonical_array_bounds()
    test_normalizer_rejects_broad_generic_and_cross_level_duplicates()
    test_normalizer_canonicalizes_bare_broad_rejections()
    test_normalizer_rejects_forbidden_broad_core_label()
    test_normalizer_preserves_legacy_rejected_candidate_objects()
    test_normalizer_rejects_nonverbatim_evidence_excerpt()
    test_normalizer_rejects_schema_oversized_concept_label()
    test_normalizer_rejects_observed_sentence_fragments_and_keeps_precise_terms()
    test_normalizer_accepts_named_benchmark_and_evaluation_protocols()
    test_normalizer_accepts_evidence_inside_source_presentation_markup()


if __name__ == "__main__":
    run()
