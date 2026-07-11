from __future__ import annotations

from collections.abc import Mapping

from scripts.icml_concept_contract import (
    ConceptContractError,
    ConceptPayload,
    Evidence,
    FRAGMENT_END_TOKENS,
    FRAGMENT_LEADING_TOKENS,
    FRAGMENT_TOKENS,
    FORBIDDEN_BROAD_LABELS,
    JsonValue,
    MAX_CONCEPT_LENGTH,
    RejectedCandidate,
    SCHEMA_VERSION,
)
from scripts.icml_concept_normalization_helpers import (
    add_rejection as _add_rejection,
    concept_key as _concept_key,
    confidence as _confidence,
    evidence_field as _evidence_field,
    evidence_order as _evidence_order,
    normalize_space as _normalize_space,
    presentation_text as _presentation_text,
    rejection_reason as _rejection_reason,
    review_status as _review_status,
    text_order as _text_order,
)
from scripts.icml_semantic_config import AREA_TAGS, DOMAIN_TAGS


def normalize_concept_payload(
    payload: Mapping[str, JsonValue],
    *,
    title: str,
    abstract: str,
) -> ConceptPayload:
    if not isinstance(payload, Mapping):
        raise ConceptContractError("concept payload must be an object")
    _require_exact_fields(
        payload,
        {
            "schema_version",
            "record_id",
            "core_concepts",
            "detail_concepts",
            "rejected_candidates",
            "evidence",
            "confidence",
            "review_status",
        },
    )
    _require_schema_version(payload["schema_version"])
    record_id = _normalized_text(payload["record_id"], "record_id")
    source_text = {
        "title": _presentation_text(title),
        "abstract": _presentation_text(abstract),
    }
    core_candidates = _string_list(payload["core_concepts"], "core_concepts")
    detail_candidates = _string_list(payload["detail_concepts"], "detail_concepts")
    review_status = _review_status(payload["review_status"])
    confidence = _confidence(payload["confidence"])
    evidence_by_concept = _evidence_by_concept(payload["evidence"], source_text)
    rejected = _rejected_candidates(payload["rejected_candidates"])
    accepted_keys: set[str] = set()
    core_concepts: list[str] = []
    detail_concepts: list[str] = []
    evidence: list[Evidence] = []
    _accept_candidates(
        core_candidates,
        3,
        "core_concepts",
        core_concepts,
        accepted_keys,
        evidence_by_concept,
        evidence,
    )
    _accept_candidates(
        detail_candidates,
        6,
        "detail_concepts",
        detail_concepts,
        accepted_keys,
        evidence_by_concept,
        evidence,
    )
    core_concepts.sort(key=_concept_key)
    detail_concepts.sort(key=_concept_key)
    evidence.sort(
        key=lambda item: (
            _concept_key(item["concept"]),
            item["field"],
            _concept_key(item["excerpt"]),
        )
    )
    rejected.sort(key=lambda item: (_concept_key(item["concept"]), item["reason"]))
    output: ConceptPayload = {
        "schema_version": SCHEMA_VERSION,
        "record_id": record_id,
        "core_concepts": core_concepts,
        "detail_concepts": detail_concepts,
        "rejected_candidates": rejected,
        "evidence": evidence,
        "confidence": confidence,
        "review_status": review_status,
    }
    _validate_normalized_payload(output, source_text)
    return output


def _accept_candidates(
    candidates: list[str],
    limit: int,
    field_name: str,
    accepted: list[str],
    accepted_keys: set[str],
    evidence_by_concept: dict[str, list[Evidence]],
    evidence: list[Evidence],
) -> None:
    if len(candidates) > limit:
        raise ConceptContractError(
            f"{field_name} must contain at most {limit} concepts"
        )
    for candidate in sorted(candidates, key=_text_order):
        normalized = _normalize_space(candidate)
        key = _concept_key(normalized)
        _validate_selected_concept(
            key, normalized, field_name, accepted_keys, evidence_by_concept
        )
        accepted.append(normalized)
        accepted_keys.add(key)
        evidence.extend(evidence_by_concept[key])


def _validate_selected_concept(
    key: str,
    label: str,
    field_name: str,
    accepted_keys: set[str],
    evidence_by_concept: dict[str, list[Evidence]],
) -> None:
    if not key or len(label) > MAX_CONCEPT_LENGTH:
        raise ConceptContractError(f"invalid concept in {field_name}: {label}")
    if key in _banned_concept_keys():
        raise ConceptContractError(f"forbidden broad concept in {field_name}: {label}")
    if _is_sentence_fragment(key):
        raise ConceptContractError(f"sentence fragment in {field_name}: {label}")
    if key in accepted_keys:
        raise ConceptContractError(f"duplicate concept in {field_name}: {label}")
    if key not in evidence_by_concept:
        raise ConceptContractError(
            f"missing evidence for concept in {field_name}: {label}"
        )


def _is_sentence_fragment(key: str) -> bool:
    tokens = key.split()
    return (
        tokens[0] in FRAGMENT_LEADING_TOKENS
        or tokens[-1] in FRAGMENT_END_TOKENS
        or "empirical evaluation" in key
        or "performance loss" in key
        or bool(set(tokens).intersection(FRAGMENT_TOKENS))
    )


def _evidence_by_concept(
    value: JsonValue, source_text: dict[str, str]
) -> dict[str, list[Evidence]]:
    if not isinstance(value, list):
        raise ConceptContractError("evidence must be an array")
    result: dict[str, list[Evidence]] = {}
    seen: set[tuple[str, str, str]] = set()
    for item in value:
        mapping = _mapping(item, "evidence item")
        _require_exact_fields(mapping, {"concept", "field", "excerpt"})
        concept = _normalized_text(mapping["concept"], "evidence.concept")
        field = _evidence_field(mapping["field"])
        excerpt = _normalized_text(mapping["excerpt"], "evidence.excerpt")
        if len(concept) > MAX_CONCEPT_LENGTH:
            raise ConceptContractError("evidence.concept exceeds maximum length")
        key, excerpt_key = (
            _concept_key(concept),
            _concept_key(excerpt),
        )
        if (
            not key
            or key not in excerpt_key
            or _presentation_text(excerpt) not in source_text[field]
        ):
            raise ConceptContractError(f"ungrounded evidence for concept: {concept}")
        marker = (key, field, excerpt)
        if marker not in seen:
            seen.add(marker)
            result.setdefault(key, []).append(
                {"concept": concept, "field": field, "excerpt": excerpt}
            )
    for concepts in result.values():
        concepts.sort(key=_evidence_order)
    return result


def _rejected_candidates(value: JsonValue) -> list[RejectedCandidate]:
    if not isinstance(value, list):
        raise ConceptContractError("rejected_candidates must be an array")
    result: dict[tuple[str, str], RejectedCandidate] = {}
    for item in value:
        if isinstance(item, str):
            concept = _normalized_text(item, "rejected_candidates item")
            if len(concept) > MAX_CONCEPT_LENGTH:
                raise ConceptContractError(
                    "rejected_candidates.concept exceeds maximum length"
                )
            if _concept_key(concept) not in _banned_concept_keys():
                raise ConceptContractError(
                    f"bare rejected candidate must be a forbidden broad label: {concept}"
                )
            _add_rejection(result, concept, "broad_label")
            continue
        mapping = _mapping(item, "rejected candidate")
        _require_exact_fields(mapping, {"concept", "reason"})
        concept = _normalized_text(mapping["concept"], "rejected_candidates.concept")
        if len(concept) > MAX_CONCEPT_LENGTH:
            raise ConceptContractError(
                "rejected_candidates.concept exceeds maximum length"
            )
        _add_rejection(result, concept, _rejection_reason(mapping["reason"]))
    return [result[key] for key in sorted(result)]


def _validate_normalized_payload(
    payload: ConceptPayload, source_text: dict[str, str]
) -> None:
    core, detail, evidence = (
        payload["core_concepts"],
        payload["detail_concepts"],
        payload["evidence"],
    )
    if len(core) > 3 or len(detail) > 6:
        raise ConceptContractError("concept limits exceeded")
    if payload["review_status"] == "accepted" and not core:
        raise ConceptContractError("accepted output requires one core concept")
    if payload["review_status"] == "needs_review" and (core or detail):
        raise ConceptContractError(
            "needs_review output cannot include accepted concepts"
        )
    concept_keys = [_concept_key(item) for item in core + detail]
    if len(concept_keys) != len(set(concept_keys)):
        raise ConceptContractError("duplicate concepts are not allowed")
    if not set(concept_keys) <= {_concept_key(item["concept"]) for item in evidence}:
        raise ConceptContractError("every accepted concept requires evidence")
    for item in evidence:
        if _presentation_text(item["excerpt"]) not in source_text[item["field"]]:
            raise ConceptContractError(
                f"ungrounded evidence for concept: {item['concept']}"
            )


def _require_exact_fields(mapping: Mapping[str, JsonValue], required: set[str]) -> None:
    unknown, missing = set(mapping) - required, required - set(mapping)
    if unknown or missing:
        raise ConceptContractError(
            f"invalid fields; missing={sorted(missing)}, unknown={sorted(unknown)}"
        )


def _require_schema_version(value: JsonValue) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value != SCHEMA_VERSION:
        raise ConceptContractError(f"schema_version must be {SCHEMA_VERSION}")


def _string_list(value: JsonValue, name: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ConceptContractError(f"{name} must be an array of strings")
    return value


def _mapping(value: JsonValue, name: str) -> dict[str, JsonValue]:
    if not isinstance(value, dict):
        raise ConceptContractError(f"{name} must be an object")
    return value


def _normalized_text(value: JsonValue, name: str) -> str:
    if not isinstance(value, str):
        raise ConceptContractError(f"{name} must be a string")
    normalized = _normalize_space(value)
    if not normalized:
        raise ConceptContractError(f"{name} must not be empty")
    return normalized


def _banned_concept_keys() -> frozenset[str]:
    values = {*AREA_TAGS, *DOMAIN_TAGS, *FORBIDDEN_BROAD_LABELS}
    return frozenset(_concept_key(item) for item in values)
