from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from pathlib import Path
import sys
from typing import Final, Literal, TypeAlias, TypedDict


ROOT: Final = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


SCHEMA_VERSION: Final = 1
MAX_CONCEPT_LENGTH: Final = 120
MAX_PAYLOAD_BYTES: Final = 131_072
REJECTION_REASONS: Final = frozenset(
    {
        "broad_label",
        "duplicate",
        "generic_term",
        "invalid_concept",
        "missing_evidence",
        "over_limit",
    }
)
GENERIC_CONCEPTS: Final = frozenset(
    {
        "algorithm",
        "analysis",
        "approach",
        "data",
        "dataset",
        "evaluation",
        "experiment",
        "framework",
        "learning",
        "method",
        "model",
        "system",
        "technique",
    }
)
FORBIDDEN_BROAD_LABELS: Final = frozenset(
    {
        *GENERIC_CONCEPTS,
        "artificial intelligence",
        "computer vision",
        "deep learning",
        "diffusion language models",
        "diffusion models",
        "foundation models",
        "generative models",
        "graph neural networks",
        "language models",
    "large language models",
    "latent representation",
        "machine learning",
        "multimodal models",
        "natural language processing",
        "neural networks",
        "reinforcement learning",
        "representation learning",
    "scientific discovery",
    "synthetic data",
        "vision-language models",
    }
)
FRAGMENT_LEADING_TOKENS: Final = frozenset(
    {"novel", "new", "standard", "over", "provide", "provides"}
)
FRAGMENT_TOKENS: Final = frozenset(
    {
        "achieves", "contains", "during", "enables", "includes", "makes", "maintains", "providing",
        "recovers", "substantially", "than", "while", "which",
    }
)
FRAGMENT_END_TOKENS: Final = frozenset(
    {"ability", "performance", "results"}
)
JsonValue: TypeAlias = (
    None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
)
EvidenceField: TypeAlias = Literal["title", "abstract"]
ReviewStatus: TypeAlias = Literal["accepted", "needs_review"]


class Evidence(TypedDict):
    concept: str
    field: EvidenceField
    excerpt: str


class RejectedCandidate(TypedDict):
    concept: str
    reason: str


class ConceptPayload(TypedDict):
    schema_version: int
    record_id: str
    core_concepts: list[str]
    detail_concepts: list[str]
    rejected_candidates: list[RejectedCandidate]
    evidence: list[Evidence]
    confidence: float
    review_status: ReviewStatus


class ConceptContractError(ValueError):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


CONCEPT_SCHEMA: Final[dict[str, JsonValue]] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "ICML research concept outcome",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version",
        "record_id",
        "core_concepts",
        "detail_concepts",
        "rejected_candidates",
        "evidence",
        "confidence",
        "review_status",
    ],
    "properties": {
        "schema_version": {"type": "integer", "const": SCHEMA_VERSION},
        "record_id": {"type": "string", "minLength": 1},
        "core_concepts": {
            "type": "array",
            "description": "Runtime validation requires accepted output to contain one to three concrete, evidenced concepts; needs_review requires none.",
            "minItems": 0,
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": MAX_CONCEPT_LENGTH,
            },
            "maxItems": 3,
        },
        "detail_concepts": {
            "type": "array",
            "minItems": 0,
            "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": MAX_CONCEPT_LENGTH,
            },
            "maxItems": 6,
        },
        "rejected_candidates": {
            "type": "array",
            "description": "Forbidden broad labels rejected from selection.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["concept", "reason"],
                "properties": {
                    "concept": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_CONCEPT_LENGTH,
                    },
                    "reason": {"type": "string", "enum": sorted(REJECTION_REASONS)},
                },
            },
        },
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["concept", "field", "excerpt"],
                "properties": {
                    "concept": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_CONCEPT_LENGTH,
                    },
                    "field": {"type": "string", "enum": ["title", "abstract"]},
                    "excerpt": {"type": "string", "minLength": 1},
                },
            },
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "review_status": {"type": "string", "enum": ["accepted", "needs_review"]},
    },
}


def normalize_concept_payload(
    payload: Mapping[str, JsonValue],
    *,
    title: str,
    abstract: str,
) -> ConceptPayload:
    from scripts.icml_concept_normalization import (
        normalize_concept_payload as normalize,
    )

    return normalize(payload, title=title, abstract=abstract)


def parse_and_normalize_concept_payload(
    raw: str | bytes, *, title: str, abstract: str
) -> ConceptPayload:
    from scripts.icml_concept_parsing import (
        parse_and_normalize_concept_payload as parse,
    )

    return parse(raw, title=title, abstract=abstract)


def schema_json() -> str:
    return json.dumps(
        CONCEPT_SCHEMA, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def _parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(
        description="Validate and normalize one untrusted ICML concept-review JSON payload."
    )
    commands = argument_parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "schema", help="Print the deterministic concept-review JSON Schema."
    )
    validate = commands.add_parser(
        "validate", help="Validate a payload and print canonical JSON."
    )
    validate.add_argument(
        "--input",
        required=True,
        type=Path,
        help="Untrusted concept-review JSON payload.",
    )
    validate.add_argument(
        "--title",
        required=True,
        help="Canonical source title used for evidence grounding.",
    )
    validate.add_argument(
        "--abstract",
        required=True,
        help="Canonical source abstract used for evidence grounding.",
    )
    return argument_parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    if arguments.command == "schema":
        print(schema_json())
        return 0
    try:
        raw = arguments.input.read_bytes()
    except OSError as error:
        print(
            f"concept contract validation failed: cannot read input: {error}",
            file=sys.stderr,
        )
        return 2
    try:
        normalized = parse_and_normalize_concept_payload(
            raw, title=arguments.title, abstract=arguments.abstract
        )
    except ConceptContractError as error:
        print(f"concept contract validation failed: {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
    )
    return 0


if __name__ == "__main__":
    from scripts.icml_concept_contract import main as package_main

    raise SystemExit(package_main())
