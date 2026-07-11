from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Mapping

from scripts.icml_concept_contract import parse_and_normalize_concept_payload
from scripts.icml_concept_normalization_helpers import concept_key


RECOVERY_SCHEMA_VERSION = "icml-concept-review-salvage/v1"


@dataclass(frozen=True, slots=True)
class SalvageResult:
    review: dict[str, object] | None
    metadata: dict[str, object]


def salvage_accepted_review(
    raw: str,
    record: Mapping[str, str],
    raw_source_name: str,
) -> SalvageResult | None:
    try:
        payload = json.loads(raw, object_pairs_hook=_unique_object)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("review_status") != "accepted":
        return None
    if payload.get("record_id") != record["id"]:
        return None
    core_candidates = payload.get("core_concepts")
    detail_candidates = payload.get("detail_concepts")
    evidence_items = payload.get("evidence")
    rejected_candidates = payload.get("rejected_candidates")
    if not isinstance(core_candidates, list) or not isinstance(detail_candidates, list) or not isinstance(evidence_items, list):
        return None
    base = {
        "schema_version": payload.get("schema_version"),
        "record_id": payload.get("record_id"),
        "rejected_candidates": [],
        "confidence": payload.get("confidence"),
        "review_status": "accepted",
    }
    retained: list[dict[str, object]] = []
    dropped: list[dict[str, str]] = []
    selected_core: list[str] = []
    selected_detail: list[str] = []
    selected_evidence: list[dict[str, object]] = []
    for level, candidates in (("core_concepts", core_candidates), ("detail_concepts", detail_candidates)):
        for candidate in candidates:
            if not isinstance(candidate, str):
                dropped.append({"concept": str(candidate), "level": level, "reason": "invalid_selected_concept"})
                continue
            matching = _matching_evidence(candidate, evidence_items)
            retained_evidence: list[dict[str, object]] = []
            for evidence in matching:
                next_core = [*selected_core, candidate] if level == "core_concepts" else selected_core
                next_detail = [*selected_detail, candidate] if level == "detail_concepts" else selected_detail
                normalized = _normalize(
                    base,
                    next_core,
                    next_detail,
                    [*selected_evidence, *retained_evidence, evidence],
                    record,
                )
                if normalized is not None:
                    retained_evidence.append(evidence)
            if not retained_evidence and level == "core_concepts":
                for field in ("title", "abstract"):
                    source_evidence = {"concept": candidate, "field": field, "excerpt": candidate}
                    next_core = [*selected_core, candidate] if level == "core_concepts" else selected_core
                    next_detail = [*selected_detail, candidate] if level == "detail_concepts" else selected_detail
                    normalized = _normalize(
                        base,
                        next_core,
                        next_detail,
                        [*selected_evidence, source_evidence],
                        record,
                    )
                    if normalized is not None:
                        retained_evidence.append(source_evidence)
                        break
            if not retained_evidence:
                dropped.append({"concept": candidate, "level": level, "reason": "no_matching_grounded_evidence"})
                continue
            if level == "core_concepts":
                selected_core.append(candidate)
            else:
                selected_detail.append(candidate)
            selected_evidence.extend(retained_evidence)
            retained.append({"concept": candidate, "level": level, "evidence": retained_evidence})
    if not selected_core and isinstance(rejected_candidates, list):
        for rejected in rejected_candidates:
            if not isinstance(rejected, dict) or rejected.get("reason") != "duplicate":
                continue
            candidate = rejected.get("concept")
            if not isinstance(candidate, str):
                continue
            for field in ("title", "abstract"):
                source_evidence = {"concept": candidate, "field": field, "excerpt": candidate}
                normalized = _normalize(base, [candidate], [], [source_evidence], record)
                if normalized is not None:
                    selected_core.append(candidate)
                    selected_evidence.append(source_evidence)
                    retained.append({"concept": candidate, "level": "core_concepts", "evidence": [source_evidence]})
                    break
            if selected_core:
                break
    metadata: dict[str, object] = {
        "schemaVersion": RECOVERY_SCHEMA_VERSION,
        "rawResponse": {
            "source": "last_message",
            "path": raw_source_name,
            "sha256": "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        },
        "retained": retained,
        "dropped": dropped,
    }
    if not selected_core:
        return SalvageResult(review=None, metadata=metadata)
    normalized = _normalize(base, selected_core, selected_detail, selected_evidence, record)
    if normalized is None:
        metadata["finalValidation"] = "failed"
        return SalvageResult(review=None, metadata=metadata)
    return SalvageResult(review=normalized, metadata=metadata)


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _matching_evidence(candidate: str, evidence_items: list[object]) -> list[dict[str, object]]:
    key = concept_key(candidate)
    return [
        item for item in evidence_items
        if isinstance(item, dict) and isinstance(item.get("concept"), str) and concept_key(item["concept"]) == key
    ]


def _normalize(
    base: dict[str, object],
    core: list[str],
    detail: list[str],
    evidence: list[dict[str, object]],
    record: Mapping[str, str],
) -> dict[str, object] | None:
    payload = {**base, "core_concepts": core, "detail_concepts": detail, "evidence": evidence}
    try:
        normalized = parse_and_normalize_concept_payload(
            json.dumps(payload), title=record["title"], abstract=record["abstract"]
        )
    except (TypeError, ValueError):
        return None
    return dict(normalized)
