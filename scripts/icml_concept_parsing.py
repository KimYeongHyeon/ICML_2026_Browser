from __future__ import annotations

import json
import re
from typing import Never

from scripts.icml_concept_contract import (
    ConceptContractError,
    ConceptPayload,
    JsonValue,
    MAX_PAYLOAD_BYTES,
)
from scripts.icml_concept_normalization import normalize_concept_payload


def parse_and_normalize_concept_payload(
    raw: str | bytes, *, title: str, abstract: str
) -> ConceptPayload:
    text = _payload_text(raw)
    try:
        decoded = json.loads(
            _unfence_json(text),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except json.JSONDecodeError as error:
        raise ConceptContractError(f"invalid JSON payload: {error.msg}") from error
    if not isinstance(decoded, dict):
        raise ConceptContractError("concept payload must be a JSON object")
    return normalize_concept_payload(decoded, title=title, abstract=abstract)


def _payload_text(raw: str | bytes) -> str:
    if not isinstance(raw, str | bytes):
        raise ConceptContractError("concept payload must be text")
    if isinstance(raw, bytes):
        if len(raw) > MAX_PAYLOAD_BYTES:
            raise ConceptContractError("concept payload exceeds size limit")
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ConceptContractError("concept payload must be UTF-8") from error
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ConceptContractError("concept payload exceeds size limit")
    return raw


def _unfence_json(value: str) -> str:
    fenced = re.fullmatch(
        r"```(?:json)?[ \t]*\r?\n(?P<body>[\s\S]*?)\r?\n?```",
        value.strip(),
        flags=re.IGNORECASE,
    )
    return fenced.group("body") if fenced else value.strip()


def _unique_object(pairs: list[tuple[str, JsonValue]]) -> dict[str, JsonValue]:
    result: dict[str, JsonValue] = {}
    for key, value in pairs:
        if key in result:
            raise ConceptContractError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> Never:
    raise ConceptContractError(f"invalid JSON constant: {value}")
