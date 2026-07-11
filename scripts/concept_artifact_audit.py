from __future__ import annotations

from pathlib import Path

from scripts.concept_artifact_compiler import (
    ARTIFACT_SCHEMA_VERSION,
    CompileError,
    _manifest_context,
    build_artifact,
    canonical_json,
    JsonValue,
    publication_coverage_error,
    read_candidate_context,
    read_json_object,
    sha256_text,
)


def _has_valid_artifact_fingerprint(artifact: dict[str, JsonValue]) -> bool:
    fingerprints = artifact.get("fingerprints")
    if not isinstance(fingerprints, dict):
        return False
    recorded = fingerprints.get("artifact")
    if not isinstance(recorded, str):
        return False
    fingerprintless = {
        **artifact,
        "fingerprints": {
            key: value for key, value in fingerprints.items() if key != "artifact"
        },
    }
    return recorded == sha256_text(canonical_json(fingerprintless))


def audit_artifact(
    artifact_path: Path, candidates_path: Path, review_dir: Path
) -> list[str]:
    errors: list[str] = []
    try:
        artifact, _ = read_json_object(artifact_path)
    except CompileError as exc:
        return [str(exc)]
    if artifact.get("schemaVersion") != ARTIFACT_SCHEMA_VERSION:
        errors.append("unsupported artifact schema")
    if not _has_valid_artifact_fingerprint(artifact):
        errors.append("artifact fingerprint mismatch")
    records = artifact.get("records")
    if not isinstance(records, dict):
        errors.append("artifact records must be an object")
    else:
        _audit_records(records, errors)
    try:
        candidate = read_candidate_context(candidates_path)
    except CompileError as exc:
        errors.append(str(exc))
        return errors
    coverage_error = publication_coverage_error(artifact)
    if coverage_error is not None:
        errors.append(coverage_error)
    source = artifact.get("source")
    fingerprints = artifact.get("fingerprints")
    if (
        not isinstance(source, dict)
        or source.get("sourceFingerprint") != candidate.source_fingerprint
    ):
        errors.append("candidate source fingerprint drift")
    if (
        not isinstance(fingerprints, dict)
        or fingerprints.get("candidateArtifact") != candidate.artifact_fingerprint
    ):
        errors.append("candidate artifact fingerprint drift")
    try:
        _, manifest_text, _ = _manifest_context(review_dir / "manifest.json", candidate)
    except CompileError as exc:
        errors.append(str(exc))
        return errors
    if not isinstance(fingerprints, dict) or fingerprints.get(
        "reviewManifest"
    ) != sha256_text(manifest_text):
        errors.append("review manifest fingerprint drift")
    expected = build_artifact(candidates_path, review_dir)
    for key in ("records", "summary", "source", "review"):
        if artifact.get(key) != expected.get(key):
            errors.append(f"artifact {key} does not match current validated inputs")
    return errors


def _audit_records(records: dict[str, JsonValue], errors: list[str]) -> None:
    if list(records) != sorted(records):
        errors.append("artifact records are not deterministically ordered")
    for record_id, concepts in records.items():
        if (
            not isinstance(record_id, str)
            or not record_id
            or not isinstance(concepts, dict)
        ):
            errors.append("artifact record shape is invalid")
            continue
        if set(concepts) != {"core", "detail"}:
            errors.append(f"artifact record {record_id} is not compact")
            continue
        core, detail = concepts.get("core"), concepts.get("detail")
        if not isinstance(core, list) or not isinstance(detail, list):
            errors.append(f"artifact record {record_id} concepts must be arrays")
            continue
        if not 1 <= len(core) <= 3 or len(detail) > 6:
            errors.append(f"artifact record {record_id} violates concept bounds")
        if not all(isinstance(item, str) and item for item in core + detail):
            errors.append(f"artifact record {record_id} has invalid concept text")
