#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Mapping, TypeAlias

DEFAULT_INDEX_PATH: Final = Path(__file__).resolve().parents[1] / "docs" / "site" / "data" / "icml2026_index.json"


JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
TOKEN_PATTERN: Final = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*")
SPACE_PATTERN: Final = re.compile(r"\s+")
SEGMENT_PATTERN: Final = re.compile(r"[.!?;:]+")
STOP_TOKENS: Final = frozenset({
    "a", "an", "and", "are", "as", "at", "by", "can", "for", "from", "in", "into", "is",
    "of", "on", "our", "that", "the", "their", "this", "to", "using", "via", "we", "with",
})
HEAD_TOKENS: Final = frozenset({
    "acquisition", "agents", "algorithm", "algorithms", "benchmark", "benchmarks", "calibration",
    "circuits", "control", "design", "detection", "estimation", "evaluation", "function", "functions",
    "generation", "geometry", "inference", "interpretability", "learning", "loss", "models", "network",
    "networks", "ode", "optimization", "policy", "prediction", "reasoning", "recursion", "regularization",
    "representation", "retrieval", "routing", "scaling", "search", "simulation", "training", "verifier",
    "verifiers", "erasure",
})
MODEL_FAMILY_HEADS: Final = frozenset({"model", "models", "network", "networks"})
MODEL_SPECIFIERS: Final = frozenset({
    "energy-based", "mixture-of-experts", "parameter-efficient", "retrieval-augmented", "score-based", "state-space",
})
BROAD_CONCEPTS: Final = frozenset({
    "artificial intelligence", "deep learning", "diffusion language models", "diffusion models",
    "foundation models", "generative models", "graph neural networks", "language models",
    "large language models", "machine learning", "multimodal models", "neural networks",
    "reinforcement learning", "representation learning", "scientific discovery", "vision-language models",
})
FRAGMENT_LEADING_TOKENS: Final = frozenset({
    "novel", "new", "standard", "minimal", "over", "provide", "provides",
})
FRAGMENT_TOKENS: Final = frozenset({
    "achieves", "contains", "during", "enables", "includes", "makes", "maintains", "providing",
    "recovers", "substantially", "than", "while", "which",
})
FRAGMENT_END_TOKENS: Final = frozenset({"ability", "benchmark", "benchmarks", "evaluation", "performance", "results"})


@dataclass(frozen=True, slots=True)
class CandidateExtractionConfig:
    max_candidates: int = 400
    max_candidates_per_record: int = 12
    max_evidence_per_candidate: int = 3

    def __post_init__(self) -> None:
        if min(self.max_candidates, self.max_candidates_per_record, self.max_evidence_per_candidate) < 1:
            raise InvalidCandidateExtractionConfig()


class InvalidCandidateExtractionConfig(Exception):
    def __str__(self) -> str:
        return "candidate limits must be positive"


@dataclass(frozen=True, slots=True)
class CanonicalRecord:
    record_id: str
    record_type: str
    title: str
    abstract: str


@dataclass(frozen=True, slots=True)
class CandidateEvidence:
    record_id: str
    field: str
    excerpt: str
    score: float


def normalized_text(value: str) -> str:
    return SPACE_PATTERN.sub(" ", value.replace("$", " ").replace("\\", " ")).strip()


def canonical_records(index: Mapping[str, JsonValue]) -> tuple[list[CanonicalRecord], int, int, dict[str, int]]:
    raw_records = index.get("records")
    if not isinstance(raw_records, list):
        raise InvalidCandidateIndex()
    selected: list[CanonicalRecord] = []
    selected_ids: set[str] = set()
    excluded_posters = 0
    excluded_other = 0
    exclusion_reasons: Counter[str] = Counter()
    for raw in raw_records:
        if not isinstance(raw, dict):
            excluded_other += 1
            exclusion_reasons["non_object_record"] += 1
            continue
        record_type = normalized_text(str(raw.get("type") or ""))
        if record_type == "poster":
            excluded_posters += 1
            exclusion_reasons["poster_duplicate"] += 1
            continue
        if record_type not in {"paper", "workshop"}:
            excluded_other += 1
            exclusion_reasons["unsupported_record_type"] += 1
            continue
        record_id = normalized_text(str(raw.get("id") or ""))
        title_value = raw.get("title")
        abstract_value = raw.get("abstract")
        title = normalized_text(title_value) if isinstance(title_value, str) else ""
        abstract = normalized_text(abstract_value) if isinstance(abstract_value, str) else ""
        if not record_id:
            excluded_other += 1
            exclusion_reasons["missing_record_id"] += 1
            continue
        if not title:
            exclusion_reasons["missing_title"] += 1
        if not abstract:
            exclusion_reasons["missing_abstract"] += 1
        if not title or not abstract:
            excluded_other += 1
            continue
        if record_id in selected_ids:
            raise InvalidCandidateIndex(f"input contains duplicate record ID: {record_id}")
        selected_ids.add(record_id)
        selected.append(CanonicalRecord(record_id, record_type, title, abstract))
    return sorted(selected, key=lambda record: record.record_id), excluded_posters, excluded_other, dict(sorted(exclusion_reasons.items()))


class InvalidCandidateIndex(Exception):
    def __init__(self, detail: str = "input JSON must contain a records array") -> None:
        self.detail = detail

    def __str__(self) -> str:
        return self.detail


def source_fingerprint(records: list[CanonicalRecord]) -> str:
    material = [
        {"abstract": record.abstract, "record_id": record.record_id, "title": record.title, "type": record.record_type}
        for record in records
    ]
    encoded = json.dumps(material, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def phrase_score(tokens: list[str], field: str) -> float:
    technical_tokens = sum("-" in token or token in HEAD_TOKENS for token in tokens)
    return (6.0 if field == "title" else 3.0) + len(tokens) * 0.3 + technical_tokens * 0.5


def is_broad_model_family(tokens: list[str]) -> bool:
    return tokens[-1] in MODEL_FAMILY_HEADS and not any(token in MODEL_SPECIFIERS for token in tokens)


def is_sentence_fragment(tokens: list[str]) -> bool:
    return (
        tokens[0] in FRAGMENT_LEADING_TOKENS
        or tokens[-1] in FRAGMENT_END_TOKENS
        or bool(set(tokens).intersection(FRAGMENT_TOKENS))
    )


def phrase_candidates(text: str, field: str) -> dict[str, CandidateEvidence]:
    candidates: dict[str, CandidateEvidence] = {}
    for segment in SEGMENT_PATTERN.split(text):
        tokens = [token.lower() for token in TOKEN_PATTERN.findall(segment)]
        for width in range(2, 5):
            for start in range(len(tokens) - width + 1):
                phrase_tokens = tokens[start : start + width]
                concept = " ".join(phrase_tokens)
                if (
                    concept in BROAD_CONCEPTS
                    or any(token in STOP_TOKENS for token in phrase_tokens)
                    or phrase_tokens[-1] not in HEAD_TOKENS
                    or is_broad_model_family(phrase_tokens)
                    or is_sentence_fragment(phrase_tokens)
                    or not any("-" in token or token in HEAD_TOKENS for token in phrase_tokens)
                ):
                    continue
                score = phrase_score(phrase_tokens, field)
                evidence = CandidateEvidence("", field, excerpt_for(segment, concept), score)
                existing = candidates.get(concept)
                if existing is None or evidence.score > existing.score:
                    candidates[concept] = evidence
    return candidates


def excerpt_for(text: str, concept: str) -> str:
    normalized = normalized_text(text)
    match = re.search(re.escape(concept).replace(r"\ ", r"\s+"), normalized, re.IGNORECASE)
    if match is None:
        return normalized[:280]
    start = max(0, match.start() - 90)
    end = min(len(normalized), match.end() + 150)
    prefix = "..." if start else ""
    suffix = "..." if end < len(normalized) else ""
    return f"{prefix}{normalized[start:end]}{suffix}"


def record_candidates(record: CanonicalRecord, limit: int) -> list[tuple[str, CandidateEvidence]]:
    candidates = phrase_candidates(record.title, "title")
    for concept, evidence in phrase_candidates(record.abstract, "abstract").items():
        existing = candidates.get(concept)
        if existing is None or evidence.score > existing.score:
            candidates[concept] = evidence
    ranked = sorted(candidates.items(), key=lambda item: (-item[1].score, item[0]))
    return [(concept, CandidateEvidence(record.record_id, evidence.field, evidence.excerpt, evidence.score)) for concept, evidence in ranked[:limit]]


def record_payload(record: CanonicalRecord, fingerprint: str, candidates: list[tuple[str, CandidateEvidence]]) -> dict[str, JsonValue]:
    return {
        "record_id": record.record_id,
        "source_fingerprint": fingerprint,
        "provenance": {"title": record.title, "abstract": record.abstract},
        "candidates": [
            {
                "concept": concept,
                "normalizedConcept": concept,
                "score": round(evidence.score, 3),
                "evidence": {"field": evidence.field, "excerpt": evidence.excerpt},
            }
            for concept, evidence in candidates
        ],
    }


def aggregate_candidates(
    by_record: list[list[tuple[str, CandidateEvidence]]], config: CandidateExtractionConfig
) -> list[dict[str, JsonValue]]:
    grouped: defaultdict[str, list[CandidateEvidence]] = defaultdict(list)
    for candidates in by_record:
        for concept, evidence in candidates:
            grouped[concept].append(evidence)
    ranked: list[tuple[str, float, list[CandidateEvidence]]] = []
    for concept, evidence in grouped.items():
        selected = sorted(evidence, key=lambda item: (-item.score, item.record_id, item.field))
        support = len({item.record_id for item in selected})
        score = sum(item.score for item in selected) + max(0, support - 1) * 2.0
        ranked.append((concept, score, selected[: config.max_evidence_per_candidate]))
    ranked.sort(key=lambda item: (-item[1], item[0]))
    return [
        {
            "concept": concept,
            "normalizedConcept": concept,
            "score": round(score, 3),
            "supportingRecordCount": len({item.record_id for item in grouped[concept]}),
            "evidence": [
                {"record_id": item.record_id, "field": item.field, "excerpt": item.excerpt}
                for item in evidence
            ],
        }
        for concept, score, evidence in ranked[: config.max_candidates]
    ]


def build_candidate_payload(index: Mapping[str, JsonValue], config_value: CandidateExtractionConfig) -> dict[str, JsonValue]:
    records, excluded_posters, excluded_other, exclusion_reasons = canonical_records(index)
    fingerprint = source_fingerprint(records)
    by_record = [record_candidates(record, config_value.max_candidates_per_record) for record in records]
    return {
        "schemaVersion": "icml-concept-candidates/v1",
        "source": {
            "source_fingerprint": fingerprint,
            "selectedRecordCount": len(records),
            "excludedPosterCount": excluded_posters,
            "excludedOtherCount": excluded_other,
            "exclusionReasons": exclusion_reasons,
            "selection": "paper_and_workshop_records_excluding_poster_duplicates",
        },
        "records": [record_payload(record, fingerprint, candidates) for record, candidates in zip(records, by_record)],
        "candidates": aggregate_candidates(by_record, config_value),
    }


def read_index(path: Path) -> dict[str, JsonValue]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"input file not found: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"input is not valid JSON: {path}: {error.msg}") from error
    if not isinstance(payload, dict):
        raise SystemExit("input JSON must be an object")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract deterministic ICML research-concept candidates.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INDEX_PATH)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-candidates", type=int, default=400)
    parser.add_argument("--max-candidates-per-record", type=int, default=12)
    parser.add_argument("--max-evidence-per-candidate", type=int, default=3)
    args = parser.parse_args()
    try:
        settings = CandidateExtractionConfig(args.max_candidates, args.max_candidates_per_record, args.max_evidence_per_candidate)
        payload = build_candidate_payload(read_index(args.input), settings)
    except InvalidCandidateExtractionConfig as error:
        raise SystemExit(str(error)) from error
    except InvalidCandidateIndex as error:
        raise SystemExit(str(error)) from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
