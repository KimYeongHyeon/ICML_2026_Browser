#!/usr/bin/env python3
from __future__ import annotations

import importlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_contract_schema_exposes_the_required_downstream_outcome() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")

    # When
    schema = contract.CONCEPT_SCHEMA

    # Then
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {
        "schema_version",
        "record_id",
        "core_concepts",
        "detail_concepts",
        "rejected_candidates",
        "evidence",
        "confidence",
        "review_status",
    }
    assert schema["properties"]["core_concepts"]["maxItems"] == 3
    assert schema["properties"]["detail_concepts"]["maxItems"] == 6
    rejected_item = schema["properties"]["rejected_candidates"]["items"]
    assert rejected_item["type"] == "object"
    assert rejected_item["required"] == ["concept", "reason"]


def test_contract_schema_avoids_codex_forbidden_composition_keywords() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    forbidden = {"allOf", "anyOf", "oneOf", "not", "if", "then", "else", "$ref"}

    def keys_in(value: object) -> set[str]:
        if isinstance(value, dict):
            return set(value) | set().union(*(keys_in(item) for item in value.values()))
        if isinstance(value, list):
            return set().union(*(keys_in(item) for item in value))
        return set()

    # When
    schema_keys = keys_in(contract.CONCEPT_SCHEMA)

    # Then
    assert not (schema_keys & forbidden)


def test_contract_schema_declares_type_for_every_property() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")

    def property_schemas(value: object) -> list[dict[str, object]]:
        if isinstance(value, dict):
            properties = value.get("properties")
            nested = list(properties.values()) if isinstance(properties, dict) else []
            return nested + [
                schema for child in value.values() for schema in property_schemas(child)
            ]
        if isinstance(value, list):
            return [schema for child in value for schema in property_schemas(child)]
        return []

    # When
    schemas = property_schemas(contract.CONCEPT_SCHEMA)

    # Then
    assert schemas
    assert all("type" in schema for schema in schemas)


def test_contract_cli_validates_a_grounded_payload() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Adaptive Routing"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Adaptive Routing",
                "field": "title",
                "excerpt": "Adaptive Routing",
            },
        ],
        "confidence": 0.91,
        "review_status": "accepted",
    }

    # When
    with tempfile.TemporaryDirectory() as temporary:
        input_path = Path(temporary) / "payload.json"
        input_path.write_text(json.dumps(payload), encoding="utf-8")
        exit_code = contract.main(
            [
                "validate",
                "--input",
                str(input_path),
                "--title",
                "Adaptive Routing for Robust Systems",
                "--abstract",
                "",
            ]
        )

    # Then
    assert exit_code == 0


def test_contract_script_cli_reports_malformed_input_without_traceback() -> None:
    # Given
    script = Path(__file__).resolve().with_name("icml_concept_contract.py")

    # When
    with tempfile.TemporaryDirectory() as temporary:
        input_path = Path(temporary) / "malformed.json"
        input_path.write_text("{", encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                str(script),
                "validate",
                "--input",
                str(input_path),
                "--title",
                "Concept Erasure",
                "--abstract",
                "",
            ],
            cwd=temporary,
            text=True,
            capture_output=True,
            check=False,
        )

    # Then
    assert result.returncode == 2
    assert result.stdout == ""
    assert result.stderr.startswith("concept contract validation failed: invalid JSON")
    assert "Traceback" not in result.stderr


def test_normalizer_preserves_multiword_concepts_and_grounding() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Concept Erasure", "Neural ODE"],
        "detail_concepts": ["Adjoint Sensitivity"],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Concept Erasure",
                "field": "title",
                "excerpt": "Concept Erasure",
            },
            {"concept": "Neural ODE", "field": "title", "excerpt": "Neural ODE"},
            {
                "concept": "Adjoint Sensitivity",
                "field": "abstract",
                "excerpt": "adjoint sensitivity",
            },
        ],
        "confidence": 0.91,
        "review_status": "accepted",
    }

    # When
    normalized = contract.normalize_concept_payload(
        payload,
        title="Concept Erasure for Neural ODE Models",
        abstract="We use adjoint sensitivity to train the proposed system.",
    )

    # Then
    assert normalized["core_concepts"] == ["Concept Erasure", "Neural ODE"]
    assert normalized["detail_concepts"] == ["Adjoint Sensitivity"]
    assert normalized["review_status"] == "accepted"


def test_normalizer_canonicalizes_semantically_equivalent_input_order() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    common = {
        "schema_version": 1,
        "record_id": "paper-42",
        "detail_concepts": [],
        "rejected_candidates": [],
        "confidence": 0.91,
        "review_status": "accepted",
    }
    first_payload = {
        **common,
        "core_concepts": ["Zero-Knowledge Proof", "Adaptive Routing"],
        "evidence": [
            {
                "concept": "Zero-Knowledge Proof",
                "field": "abstract",
                "excerpt": "zero-knowledge proof",
            },
            {
                "concept": "Adaptive Routing",
                "field": "title",
                "excerpt": "Adaptive Routing",
            },
        ],
    }
    reordered_payload = {
        **common,
        "core_concepts": ["Adaptive Routing", "Zero-Knowledge Proof"],
        "evidence": list(reversed(first_payload["evidence"])),
    }

    # When
    first = contract.normalize_concept_payload(
        first_payload,
        title="Adaptive Routing with Zero-Knowledge Proof",
        abstract="Our protocol emits a zero-knowledge proof for each route.",
    )
    second = contract.normalize_concept_payload(
        reordered_payload,
        title="Adaptive Routing with Zero-Knowledge Proof",
        abstract="Our protocol emits a zero-knowledge proof for each route.",
    )

    # Then
    assert first == second
    assert first["core_concepts"] == ["Adaptive Routing", "Zero-Knowledge Proof"]


def test_public_contract_api_emits_exact_canonical_json_for_grounded_payload() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Zero-Knowledge Proof", "Adaptive Routing"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Zero-Knowledge Proof",
                "field": "abstract",
                "excerpt": "zero-knowledge proof",
            },
            {
                "concept": "Adaptive Routing",
                "field": "title",
                "excerpt": "Adaptive Routing",
            },
        ],
        "confidence": 0.91,
        "review_status": "accepted",
    }

    # When
    normalized = contract.normalize_concept_payload(
        payload,
        title="Adaptive Routing with Zero-Knowledge Proof",
        abstract="Our protocol emits a zero-knowledge proof for each route.",
    )
    canonical = json.dumps(
        normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )

    # Then
    assert canonical == (
        '{"confidence":0.91,"core_concepts":["Adaptive Routing",'
        '"Zero-Knowledge Proof"],"detail_concepts":[],"evidence":['
        '{"concept":"Adaptive Routing","excerpt":"Adaptive Routing",'
        '"field":"title"},{"concept":"Zero-Knowledge Proof",'
        '"excerpt":"zero-knowledge proof","field":"abstract"}],'
        '"record_id":"paper-42","rejected_candidates":[],'
        '"review_status":"accepted","schema_version":1}'
    )


def test_parser_accepts_one_json_fence() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Concept Erasure"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Concept Erasure",
                "field": "title",
                "excerpt": "Concept Erasure",
            },
        ],
        "confidence": 0.5,
        "review_status": "accepted",
    }

    # When
    parsed = contract.parse_and_normalize_concept_payload(
        f"```json\n{json.dumps(payload)}\n```",
        title="Concept Erasure",
        abstract="",
    )

    # Then
    assert parsed["core_concepts"] == ["Concept Erasure"]


def test_parser_rejects_non_json_prose() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Concept Erasure"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {
                "concept": "Concept Erasure",
                "field": "title",
                "excerpt": "Concept Erasure",
            },
        ],
        "confidence": 0.5,
        "review_status": "accepted",
    }
    malformed = "Here is the output: " + json.dumps(payload)

    # When
    try:
        contract.parse_and_normalize_concept_payload(
            malformed, title="Concept Erasure", abstract=""
        )
    except contract.ConceptContractError:
        # Then
        return
    raise AssertionError("non-JSON prose must not be parsed as a concept payload")


def test_normalizer_fails_closed_on_ungrounded_evidence() -> None:
    # Given
    contract = importlib.import_module("scripts.icml_concept_contract")
    payload = {
        "schema_version": 1,
        "record_id": "paper-42",
        "core_concepts": ["Neural ODE"],
        "detail_concepts": [],
        "rejected_candidates": [],
        "evidence": [
            {"concept": "Neural ODE", "field": "title", "excerpt": "Neural ODE"},
        ],
        "confidence": 0.5,
        "review_status": "accepted",
    }

    # When
    try:
        contract.normalize_concept_payload(
            payload, title="A different title", abstract=""
        )
    except contract.ConceptContractError:
        # Then
        return
    raise AssertionError("hallucinated evidence spans must be rejected")


def run() -> None:
    test_contract_schema_exposes_the_required_downstream_outcome()
    test_contract_schema_avoids_codex_forbidden_composition_keywords()
    test_contract_schema_declares_type_for_every_property()
    test_contract_cli_validates_a_grounded_payload()
    test_contract_script_cli_reports_malformed_input_without_traceback()
    test_normalizer_preserves_multiword_concepts_and_grounding()
    test_normalizer_canonicalizes_semantically_equivalent_input_order()
    test_public_contract_api_emits_exact_canonical_json_for_grounded_payload()
    test_parser_accepts_one_json_fence()
    test_parser_rejects_non_json_prose()
    test_normalizer_fails_closed_on_ungrounded_evidence()
    from scripts.test_concept_contract_validation import (
        run as run_contract_validation_tests,
    )

    run_contract_validation_tests()
    print("concept contract unit tests passed")


if __name__ == "__main__":
    run()
