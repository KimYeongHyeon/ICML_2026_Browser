from __future__ import annotations

import math
import re
import unicodedata

from scripts.icml_concept_contract import (
    ConceptContractError,
    Evidence,
    EvidenceField,
    JsonValue,
    REJECTION_REASONS,
    RejectedCandidate,
    ReviewStatus,
)


def normalize_space(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def presentation_text(value: str) -> str:
    normalized = normalize_space(value)
    wrapper = re.compile(r"(?:\\)?(?:emph|textbf|textsc|mathrm)\{([^{}]*)\}")
    while True:
        unwrapped = wrapper.sub(r"\1", normalized)
        if unwrapped == normalized:
            break
        normalized = unwrapped
    return normalize_space(normalized.replace("*", "").replace("`", ""))


def concept_key(value: str) -> str:
    return " ".join(
        re.sub(r"[^\w]+", " ", unicodedata.normalize("NFKC", value).casefold()).split()
    )


def text_order(value: str) -> tuple[str, str]:
    normalized = normalize_space(value)
    return concept_key(normalized), normalized


def evidence_order(value: Evidence) -> tuple[int, str, str, str]:
    field_order = 0 if value["field"] == "title" else 1
    return (
        field_order,
        concept_key(value["excerpt"]),
        value["excerpt"],
        value["concept"],
    )


def evidence_field(value: JsonValue) -> EvidenceField:
    if value == "title" or value == "abstract":
        return value
    raise ConceptContractError("evidence.field must be title or abstract")


def rejection_reason(value: JsonValue) -> str:
    if isinstance(value, str) and value in REJECTION_REASONS:
        return value
    raise ConceptContractError("unknown rejection reason")


def confidence(value: JsonValue) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not math.isfinite(float(value))
        or not 0 <= value <= 1
    ):
        raise ConceptContractError("confidence must be a finite number from 0 to 1")
    return round(float(value), 6)


def review_status(value: JsonValue) -> ReviewStatus:
    if value == "accepted" or value == "needs_review":
        return value
    raise ConceptContractError("review_status must be accepted or needs_review")


def add_rejection(
    rejected: dict[tuple[str, str], RejectedCandidate], concept: str, reason: str
) -> None:
    marker = (concept_key(concept), reason)
    current = rejected.get(marker)
    if current is None or text_order(concept) < text_order(current["concept"]):
        rejected[marker] = {"concept": concept, "reason": reason}
