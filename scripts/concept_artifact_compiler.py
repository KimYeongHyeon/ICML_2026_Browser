from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from scripts.concept_artifact_json import (
    CompileError,
    JsonValue,
    atomic_write_json,
    canonical_json,
    read_json_object,
    sha256_text,
)

from scripts.concept_review_runner import (
    RUNNER_SCHEMA_VERSION,
    compact_text,
    record_filename,
)
from scripts.icml_concept_contract import (
    ConceptContractError,
    normalize_concept_payload,
)


ARTIFACT_SCHEMA_VERSION: Final = "icml-concepts/v1"
CANDIDATE_SCHEMA_VERSION: Final = "icml-concept-candidates/v1"
SUCCESSFUL_REVIEW_STATUSES: Final = frozenset({"completed", "skipped"})
MANIFEST_FINGERPRINT_KEYS: Final = frozenset(
    {"candidateContent", "schema", "model", "cliVersion", "promptTemplate"}
)
STATE_FINGERPRINT_KEYS: Final = frozenset(
    {"schema", "model", "cliVersion", "promptTemplate", "content", "prompt"}
)


@dataclass(frozen=True, slots=True)
class CandidateRecord:
    record_id: str
    title: str
    abstract: str
    candidates: str


@dataclass(frozen=True, slots=True)
class CandidateContext:
    records: tuple[CandidateRecord, ...]
    source_fingerprint: str
    artifact_fingerprint: str
    runner_input_fingerprint: str


def _required_string(mapping: dict[str, JsonValue], key: str, label: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        raise CompileError(f"{label} requires non-empty {key}")
    return value


def _candidate_record(
    raw: JsonValue, source_fingerprint: str, index: int
) -> CandidateRecord:
    if not isinstance(raw, dict):
        raise CompileError(f"candidate record {index} is not an object")
    record_id_value = raw.get("record_id", raw.get("id"))
    record_id = (
        compact_text(record_id_value) if isinstance(record_id_value, str) else ""
    )
    provenance = raw.get("provenance")
    title_value = raw.get("title")
    abstract_value = raw.get("abstract")
    if isinstance(provenance, dict):
        title_value = provenance.get("title", title_value)
        abstract_value = provenance.get("abstract", abstract_value)
    title = compact_text(title_value) if isinstance(title_value, str) else ""
    abstract = compact_text(abstract_value) if isinstance(abstract_value, str) else ""
    if not record_id or not title or not abstract:
        raise CompileError(
            f"candidate record {index} requires record_id, title, and abstract"
        )
    if raw.get("source_fingerprint") != source_fingerprint:
        raise CompileError(
            f"candidate record {record_id} has mismatched source fingerprint"
        )
    candidates = raw.get("candidates")
    candidates_json = json.dumps(
        candidates if isinstance(candidates, list) else [],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return CandidateRecord(record_id, title, abstract, candidates_json)


def read_candidate_context(path: Path) -> CandidateContext:
    payload, raw_text = read_json_object(path)
    if payload.get("schemaVersion") != CANDIDATE_SCHEMA_VERSION:
        raise CompileError("unsupported candidate artifact schema")
    source = payload.get("source")
    if not isinstance(source, dict):
        raise CompileError("candidate artifact requires source metadata")
    source_fingerprint = _required_string(
        source, "source_fingerprint", "candidate source"
    )
    records = payload.get("records")
    if not isinstance(records, list):
        raise CompileError("candidate artifact requires records array")
    parsed = tuple(
        _candidate_record(raw, source_fingerprint, index)
        for index, raw in enumerate(records)
    )
    identifiers = [record.record_id for record in parsed]
    if len(identifiers) != len(set(identifiers)):
        raise CompileError("candidate artifact has duplicate record IDs")
    return CandidateContext(
        tuple(sorted(parsed, key=lambda record: record.record_id)),
        source_fingerprint,
        sha256_text(raw_text),
        sha256_text(canonical_json({"input": raw_text})),
    )


def _manifest_context(
    path: Path, candidate: CandidateContext
) -> tuple[dict[str, JsonValue], str, dict[str, JsonValue]]:
    manifest, raw_text = read_json_object(path)
    if manifest.get("schemaVersion") != RUNNER_SCHEMA_VERSION:
        raise CompileError("unsupported review manifest schema")
    fingerprints = manifest.get("fingerprints")
    records = manifest.get("records")
    if not isinstance(fingerprints, dict) or not isinstance(records, dict):
        raise CompileError("review manifest requires fingerprints and records objects")
    if set(fingerprints) != MANIFEST_FINGERPRINT_KEYS:
        raise CompileError("review manifest has unexpected fingerprint fields")
    if fingerprints.get("candidateContent") != candidate.runner_input_fingerprint:
        raise CompileError("review manifest candidate fingerprint mismatch")
    for key in ("schema", "model", "cliVersion", "promptTemplate"):
        _required_string(fingerprints, key, "review manifest fingerprints")
    return manifest, raw_text, fingerprints


def _exclusion(counts: dict[str, int], reason: str) -> None:
    counts[reason] = counts.get(reason, 0) + 1


def _review_for_record(
    record: CandidateRecord,
    state: JsonValue,
    review_dir: Path,
    manifest_fingerprints: dict[str, JsonValue],
) -> tuple[dict[str, list[str]] | None, str | None]:
    if (
        not isinstance(state, dict)
        or state.get("status") not in SUCCESSFUL_REVIEW_STATUSES
    ):
        return None, "manifest_not_successful"
    state_fingerprints = state.get("fingerprints")
    if not isinstance(state_fingerprints, dict):
        return None, "manifest_fingerprint_missing"
    if set(state_fingerprints) != STATE_FINGERPRINT_KEYS:
        return None, "manifest_record_fingerprint_mismatch"
    for key in ("schema", "model", "cliVersion"):
        if state_fingerprints.get(key) != manifest_fingerprints.get(key):
            return None, "manifest_record_fingerprint_mismatch"
    cache_path = review_dir / "cache" / f"{record_filename(record.record_id)}.json"
    try:
        cache, _ = read_json_object(cache_path)
    except CompileError:
        return None, "cache_unreadable"
    if cache.get("fingerprints") != state_fingerprints:
        return None, "cache_fingerprint_mismatch"
    review = cache.get("review")
    if not isinstance(review, dict):
        return None, "cache_review_missing"
    try:
        normalized = normalize_concept_payload(
            review, title=record.title, abstract=record.abstract
        )
    except (ConceptContractError, TypeError):
        return None, "review_contract_invalid"
    if normalized["record_id"] != record.record_id:
        return None, "review_record_id_mismatch"
    if normalized["review_status"] != "accepted" or not normalized["core_concepts"]:
        return None, "review_not_accepted"
    return {
        "core": normalized["core_concepts"],
        "detail": normalized["detail_concepts"],
    }, None


def build_artifact(candidates_path: Path, review_dir: Path) -> dict[str, JsonValue]:
    candidate = read_candidate_context(candidates_path)
    manifest, manifest_text, manifest_fingerprints = _manifest_context(
        review_dir / "manifest.json", candidate
    )
    states = manifest["records"]
    assert isinstance(states, dict)
    records: dict[str, dict[str, list[str]]] = {}
    exclusion_counts: dict[str, int] = {}
    for record in candidate.records:
        concepts, exclusion = _review_for_record(
            record, states.get(record.record_id), review_dir, manifest_fingerprints
        )
        if exclusion is not None:
            _exclusion(exclusion_counts, exclusion)
            continue
        assert concepts is not None
        records[record.record_id] = concepts
    ordered_records = {record_id: records[record_id] for record_id in sorted(records)}
    core_count = sum(len(concepts["core"]) for concepts in ordered_records.values())
    detail_count = sum(len(concepts["detail"]) for concepts in ordered_records.values())
    artifact: dict[str, JsonValue] = {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "source": {"sourceFingerprint": candidate.source_fingerprint},
        "review": {
            "runnerSchemaVersion": RUNNER_SCHEMA_VERSION,
            "manifestFingerprints": manifest_fingerprints,
        },
        "records": ordered_records,
        "summary": {
            "candidateRecordCount": len(candidate.records),
            "publishedRecordCount": len(ordered_records),
            "excludedRecordCount": sum(exclusion_counts.values()),
            "exclusionCounts": dict(sorted(exclusion_counts.items())),
            "coreConceptCount": core_count,
            "detailConceptCount": detail_count,
        },
        "fingerprints": {
            "candidateArtifact": candidate.artifact_fingerprint,
            "reviewManifest": sha256_text(manifest_text),
        },
    }
    fingerprints = artifact["fingerprints"]
    assert isinstance(fingerprints, dict)
    fingerprints["artifact"] = sha256_text(canonical_json(artifact))
    return artifact


def publication_coverage_error(artifact: dict[str, JsonValue]) -> str | None:
    summary = artifact.get("summary")
    records = artifact.get("records")
    if not isinstance(summary, dict) or not isinstance(records, dict):
        return "incomplete candidate coverage: artifact summary or records is invalid"
    candidate_count = summary.get("candidateRecordCount")
    published_count = summary.get("publishedRecordCount")
    excluded_count = summary.get("excludedRecordCount")
    exclusion_counts = summary.get("exclusionCounts")
    if (
        not isinstance(candidate_count, int)
        or isinstance(candidate_count, bool)
        or not isinstance(published_count, int)
        or isinstance(published_count, bool)
        or not isinstance(excluded_count, int)
        or isinstance(excluded_count, bool)
        or not isinstance(exclusion_counts, dict)
    ):
        return "incomplete candidate coverage: artifact summary is invalid"
    if (
        candidate_count != published_count
        or published_count != len(records)
        or excluded_count != 0
        or exclusion_counts
    ):
        return (
            "incomplete candidate coverage: "
            f"candidateRecordCount={candidate_count}, "
            f"publishedRecordCount={published_count}, "
            f"excludedRecordCount={excluded_count}"
        )
    return None


def compile_artifact(
    candidates_path: Path, review_dir: Path, output_path: Path
) -> dict[str, JsonValue]:
    artifact = build_artifact(candidates_path, review_dir)
    coverage_error = publication_coverage_error(artifact)
    if coverage_error is not None:
        raise CompileError(coverage_error)
    atomic_write_json(output_path, artifact)
    return artifact
