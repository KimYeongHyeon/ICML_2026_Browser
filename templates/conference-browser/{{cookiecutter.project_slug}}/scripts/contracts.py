#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import parse_qsl, urlsplit


CONFIG_SCHEMA = "conference-browser-config/v1"
SOURCE_SCHEMA = "conference-browser-source/v1"
ARTIFACT_SCHEMA = "conference-browser-records/v1"
MANIFEST_SCHEMA = "conference-browser-manifest/v1"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PRIVATE_FRAGMENTS = (
    "/PROJECT_Yeonghyeon/",
    "/Users/",
    "/home/",
    "/private/var/",
    "/tmp/",
    "c:\\users\\",
    "file:",
    "sftp:",
)
PUBLIC_RECORD_KEYS = {
    "id",
    "title",
    "authors",
    "sourceUrl",
    "publicPdfUrl",
    "accessStatus",
    "accessReason",
    "archiveStatus",
    "archived",
    "archiveUpdatedAt",
}
SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "credential",
    "password",
    "secret",
    "signature",
    "token",
    "x-amz-credential",
    "x-amz-signature",
}


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def source_fingerprint(queue_hash: str, state_hash: str, state_present: bool) -> str:
    if not SHA256_RE.fullmatch(queue_hash) or not SHA256_RE.fullmatch(state_hash):
        raise ValueError("source snapshot fingerprints must be SHA-256 hex digests")
    if not isinstance(state_present, bool):
        raise ValueError("state_present must be a boolean")
    return sha256_bytes(canonical_json_bytes({
        "queueSnapshotSha256": queue_hash,
        "statePresent": state_present,
        "stateSnapshotSha256": state_hash,
    }))


def write_bytes_atomic(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(value)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json_atomic(path: Path, value: Any) -> bytes:
    encoded = canonical_json_bytes(value)
    write_bytes_atomic(path, encoded)
    return encoded


def parse_json_bytes(value: bytes, label: str) -> Any:
    try:
        return json.loads(value.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid UTF-8 JSON in {label}: {error}") from error


def clean_text(value: Any, field: str, *, required: bool = True, limit: int = 10000) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = value.strip()
    if required and not text:
        raise ValueError(f"{field} must not be empty")
    if len(text) > limit or any(ord(char) < 32 and char not in "\t\n\r" for char in text):
        raise ValueError(f"{field} contains invalid text")
    return text


def public_url(value: Any, field: str, *, required: bool = False) -> str:
    text = clean_text(value, field, required=required, limit=4096)
    if not text:
        return ""
    if any(char.isspace() or ord(char) == 127 for char in text):
        raise ValueError(f"{field} must not contain whitespace or control characters")
    parsed = urlsplit(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{field} must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{field} must not contain credentials")
    query_keys = {key.casefold() for key, _value in parse_qsl(parsed.query, keep_blank_values=True)}
    if query_keys & SENSITIVE_QUERY_KEYS:
        raise ValueError(f"{field} must not contain credential-bearing query parameters")
    return text


def load_config(path: Path) -> dict[str, Any]:
    payload = parse_json_bytes(path.read_bytes(), str(path))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != CONFIG_SCHEMA:
        raise ValueError(f"invalid conference config schema: {path}")
    name = clean_text(payload.get("name"), "conference.name", limit=200)
    slug = clean_text(payload.get("slug"), "conference.slug", limit=80)
    if not SLUG_RE.fullmatch(slug):
        raise ValueError("conference.slug is invalid")
    year = payload.get("year")
    if not isinstance(year, int) or not YEAR_RE.fullmatch(str(year)):
        raise ValueError("conference.year is invalid")
    title = clean_text(payload.get("title"), "conference.title", limit=300)
    template_version = clean_text(payload.get("templateVersion"), "conference.templateVersion", limit=40)
    return {
        "schemaVersion": CONFIG_SCHEMA,
        "templateVersion": template_version,
        "name": name,
        "slug": slug,
        "year": year,
        "title": title,
    }


def normalize_queue(value: bytes, config: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        text = value.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"queue is not valid UTF-8: {error}") from error
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_number, raw_line in enumerate(text.splitlines(), 1):
        if not raw_line.strip():
            continue
        try:
            source = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ValueError(f"queue line {line_number} is invalid JSON: {error}") from error
        if not isinstance(source, dict):
            raise ValueError(f"queue line {line_number} must be an object")
        item_id = clean_text(source.get("id"), f"queue[{line_number}].id", limit=300)
        if item_id in seen:
            raise ValueError(f"duplicate queue id: {item_id}")
        seen.add(item_id)
        year = source.get("year")
        if year != config["year"]:
            raise ValueError(f"queue item {item_id} has year {year}, expected {config['year']}")
        title = clean_text(source.get("title"), f"queue[{item_id}].title", limit=2000)
        authors = source.get("authors", [])
        if not isinstance(authors, list) or len(authors) > 1000:
            raise ValueError(f"queue item {item_id} authors must be a list of non-empty strings")
        normalized_authors = []
        for index, author in enumerate(authors):
            author_text = clean_text(author, f"queue[{item_id}].authors[{index}]", limit=500)
            if any(char in author_text for char in "\t\n\r"):
                raise ValueError(f"queue item {item_id} authors must be single-line strings")
            normalized_authors.append(author_text)
        landing_url = public_url(source.get("landing_url"), f"queue[{item_id}].landing_url")
        pdf_url = public_url(source.get("pdf_url"), f"queue[{item_id}].pdf_url")
        access_status = clean_text(
            source.get("access_status"),
            f"queue[{item_id}].access_status",
            required=False,
            limit=100,
        )
        access_reason = clean_text(
            source.get("access_reason"),
            f"queue[{item_id}].access_reason",
            required=False,
            limit=2000,
        )
        unavailable = access_status == "unavailable_public_access"
        if not pdf_url and not unavailable:
            raise ValueError(f"queue item {item_id} requires pdf_url or unavailable_public_access")
        if not landing_url and not pdf_url:
            raise ValueError(f"queue item {item_id} requires a public landing_url or pdf_url")
        rows.append({
            "id": item_id,
            "year": year,
            "title": title,
            "authors": normalized_authors,
            "landing_url": landing_url,
            "pdf_url": pdf_url,
            "access_status": access_status,
            "access_reason": access_reason,
        })
    if not rows:
        raise ValueError("archive queue is empty")
    return sorted(rows, key=lambda row: row["id"])


def canonical_queue_bytes(rows: list[dict[str, Any]]) -> bytes:
    return b"".join(
        (json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        for row in rows
    )


def normalize_archive_state(value: bytes | None, config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if value is None:
        return {}
    payload = parse_json_bytes(value, "archive state")
    if not isinstance(payload, dict):
        raise ValueError("archive state must be an object")
    normalized: dict[str, dict[str, Any]] = {}
    remote_root = PurePosixPath(
        f"/PROJECT_Yeonghyeon/conference-pdf-archive/{config['slug']}/{config['year']}/pdfs"
    )
    for key, source in payload.items():
        if not isinstance(key, str) or not isinstance(source, dict):
            raise ValueError("archive state entries must map string keys to objects")
        item_id = clean_text(source.get("id"), f"state[{key}].id", limit=300)
        expected_key = f"{config['year']}:{item_id}"
        if key != expected_key or source.get("year") != config["year"]:
            raise ValueError(f"archive state key/year mismatch: {key}")
        status = clean_text(source.get("status"), f"state[{key}].status", limit=100)
        access_status = clean_text(
            source.get("access_status"),
            f"state[{key}].access_status",
            required=False,
            limit=100,
        )
        updated = clean_text(source.get("updated"), f"state[{key}].updated", required=False, limit=100)
        archived = status == "uploaded"
        if archived:
            remote_path = clean_text(source.get("remote_path"), f"state[{key}].remote_path", limit=4096)
            remote = PurePosixPath(remote_path)
            digest = clean_text(source.get("sha256"), f"state[{key}].sha256", limit=64)
            byte_count = source.get("bytes")
            if (
                not remote.is_absolute()
                or remote.parent != remote_root
                or remote.suffix.casefold() != ".pdf"
                or remote.as_posix() != remote_path
            ):
                raise ValueError(f"uploaded state has unexpected NAS path: {key}")
            if (
                not SHA256_RE.fullmatch(digest)
                or not isinstance(byte_count, int)
                or isinstance(byte_count, bool)
                or byte_count <= 0
            ):
                raise ValueError(f"uploaded state lacks valid size/SHA-256: {key}")
        if item_id in normalized:
            raise ValueError(f"duplicate archive state id: {item_id}")
        normalized[item_id] = {
            "status": status,
            "accessStatus": access_status,
            "updated": updated,
            "archived": archived,
        }
    return dict(sorted(normalized.items()))


def validate_state_snapshot(payload: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("state snapshot must be an object")
    normalized: dict[str, dict[str, Any]] = {}
    expected_keys = {"status", "accessStatus", "updated", "archived"}
    for item_id, state in payload.items():
        if not isinstance(item_id, str) or not isinstance(state, dict) or set(state) != expected_keys:
            raise ValueError(f"invalid state snapshot entry: {item_id}")
        if not isinstance(state["archived"], bool):
            raise ValueError(f"invalid archived flag in state snapshot: {item_id}")
        for key in {"status", "accessStatus", "updated"}:
            clean_text(state[key], f"stateSnapshot[{item_id}].{key}", required=key == "status", limit=100)
        normalized[item_id] = dict(state)
    return dict(sorted(normalized.items()))


def assert_public_safe(value: Any, path: str = "public") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = str(key).lower()
            if lowered in {"remote_path", "local_path", "archive_root", "sha256", "password", "token"}:
                raise ValueError(f"private key leaked into {path}: {key}")
            assert_public_safe(child, f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            assert_public_safe(child, f"{path}[{index}]")
        return
    if isinstance(value, str):
        lowered_value = value.casefold()
        for fragment in PRIVATE_FRAGMENTS:
            if fragment.casefold() in lowered_value:
                raise ValueError(f"private path/scheme leaked into {path}")


def public_record(queue_row: dict[str, Any], state: dict[str, Any] | None) -> dict[str, Any]:
    state = state or {}
    access_status = state.get("accessStatus") or queue_row["access_status"] or "public_url_unverified"
    if access_status == "unavailable_public_access" and queue_row["pdf_url"]:
        raise ValueError(
            f"queue item {queue_row['id']} cannot have both a public PDF URL and unavailable access"
        )
    record = {
        "id": queue_row["id"],
        "title": queue_row["title"],
        "authors": queue_row["authors"],
        "sourceUrl": queue_row["landing_url"] or queue_row["pdf_url"],
        "publicPdfUrl": queue_row["pdf_url"],
        "accessStatus": access_status,
        "accessReason": queue_row["access_reason"],
        "archiveStatus": state.get("status") or "not_started",
        "archived": bool(state.get("archived", False)),
        "archiveUpdatedAt": state.get("updated") or "",
    }
    if set(record) != PUBLIC_RECORD_KEYS:
        raise AssertionError("public record allowlist drift")
    public_url(record["sourceUrl"], f"publicRecord[{record['id']}].sourceUrl", required=True)
    public_url(record["publicPdfUrl"], f"publicRecord[{record['id']}].publicPdfUrl")
    assert_public_safe(record)
    return record
