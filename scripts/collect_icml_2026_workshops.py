#!/usr/bin/env python3
"""Collect public ICML 2026 workshop materials from official/first-party sources."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


OPENREVIEW_API = "https://api2.openreview.net"
OPENREVIEW_WEB = "https://openreview.net"
ICML_WORKSHOP_GROUP = "ICML.cc/2026/Workshop"
OFFICIAL_ICML_URLS = {
    "call_for_workshops": "https://icml.cc/Conferences/2026/CallForWorkshops",
    "schedule": "https://icml.cc/Conferences/2026/Schedule",
    "poster_instructions": "https://icml.cc/Conferences/2026/PosterInstructions",
}
USER_AGENT = "ICML2026WorkshopMaterialCollector/1.0 (+public official-source archival)"
MATERIAL_EXTENSIONS = {
    ".pdf",
    ".zip",
    ".ppt",
    ".pptx",
    ".key",
    ".odp",
    ".tar",
    ".gz",
    ".tgz",
    ".csv",
    ".json",
}
PAGE_HINTS = (
    "program",
    "schedule",
    "accepted",
    "paper",
    "papers",
    "poster",
    "posters",
    "slide",
    "slides",
    "presentation",
    "presentations",
)
MATERIAL_HINTS = (
    "paper",
    "poster",
    "slide",
    "presentation",
    "supplement",
    "supplemental",
    "program",
    "schedule",
)


@dataclass
class Counters:
    workshops_discovered: int = 0
    workshops_with_public_submissions: int = 0
    workshops_with_manifest: int = 0
    openreview_items_discovered: int = 0
    page_items_discovered: int = 0
    files_downloaded: int = 0
    files_skipped_existing: int = 0
    files_failed: int = 0
    items_skipped: int = 0
    items_failed: int = 0


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "item"


def content_value(content: dict[str, Any], key: str, default: Any = None) -> Any:
    raw = content.get(key, default)
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def request_with_backoff(
    session: requests.Session,
    method: str,
    url: str,
    *,
    max_attempts: int = 6,
    **kwargs: Any,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            response = session.request(method, url, timeout=kwargs.pop("timeout", 45), **kwargs)
            if response.status_code == 429:
                delay = min(60, 3 * (attempt + 1) ** 2)
                time.sleep(delay)
                continue
            return response
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(min(30, 2 * (attempt + 1)))
    if last_error:
        raise last_error
    raise RuntimeError(f"Request failed after retries: {url}")


def safe_json_response(session: requests.Session, url: str, params: dict[str, Any]) -> dict[str, Any]:
    response = request_with_backoff(session, "GET", url, params=params)
    response.raise_for_status()
    return response.json()


def is_probably_same_site(base_url: str, candidate_url: str) -> bool:
    base = urlparse(base_url)
    candidate = urlparse(candidate_url)
    if not candidate.netloc:
        return True
    return candidate.netloc.lower() == base.netloc.lower()


def absolute_url(base_url: str, maybe_url: str) -> str:
    if maybe_url.startswith("//"):
        return "https:" + maybe_url
    return urljoin(base_url, maybe_url)


def url_extension(url: str) -> str:
    path = urlparse(url).path
    suffix = Path(path).suffix.lower()
    if suffix == ".gz" and path.lower().endswith(".tar.gz"):
        return ".tar.gz"
    return suffix


def filename_from_url(url: str, fallback: str) -> str:
    path_name = Path(urlparse(url).path).name
    if path_name and "." in path_name:
        name = slugify(Path(path_name).stem)[:90] + Path(path_name).suffix.lower()
    else:
        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
        ext = url_extension(url) or ".html"
        name = f"{slugify(fallback)[:70]}-{digest}{ext}"
    return name


def download_file(
    session: requests.Session,
    url: str,
    target: Path,
    counters: Counters,
    *,
    max_bytes: int = 150_000_000,
) -> tuple[str, str | None]:
    if target.exists() and target.stat().st_size > 0:
        counters.files_skipped_existing += 1
        return "skipped_existing", None
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with session.get(url, timeout=45, stream=True) as response:
            if response.status_code == 429:
                counters.files_failed += 1
                return "failed", "HTTP 429 rate limited"
            if response.status_code >= 400:
                counters.files_failed += 1
                return "failed", f"HTTP {response.status_code}"
            total = int(response.headers.get("content-length") or 0)
            if total > max_bytes:
                counters.items_skipped += 1
                return "skipped", f"File exceeds {max_bytes} bytes"
            written = 0
            tmp = target.with_suffix(target.suffix + ".part")
            with tmp.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 256):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > max_bytes:
                        handle.close()
                        tmp.unlink(missing_ok=True)
                        counters.items_skipped += 1
                        return "skipped", f"File exceeds {max_bytes} bytes"
                    handle.write(chunk)
            tmp.replace(target)
            counters.files_downloaded += 1
            return "downloaded", None
    except Exception as exc:  # noqa: BLE001 - report collection failures, keep going.
        counters.files_failed += 1
        tmp = target.with_suffix(target.suffix + ".part")
        tmp.unlink(missing_ok=True)
        return "failed", str(exc)


def save_text_snapshot(session: requests.Session, url: str, target: Path, counters: Counters) -> tuple[str, str | None]:
    if target.exists() and target.stat().st_size > 0:
        counters.files_skipped_existing += 1
        return "skipped_existing", None
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        response = request_with_backoff(session, "GET", url)
        if response.status_code >= 400:
            counters.files_failed += 1
            return "failed", f"HTTP {response.status_code}"
        target.write_text(response.text, encoding=response.encoding or "utf-8")
        counters.files_downloaded += 1
        return "downloaded", None
    except Exception as exc:  # noqa: BLE001
        counters.files_failed += 1
        return "failed", str(exc)


def fetch_workshop_groups(session: requests.Session) -> list[dict[str, Any]]:
    data = safe_json_response(session, f"{OPENREVIEW_API}/groups", {"parent": ICML_WORKSHOP_GROUP})
    groups = data.get("groups", [])
    return sorted(groups, key=lambda group: group["id"].lower())


def fetch_notes(session: requests.Session, invitation: str) -> tuple[list[dict[str, Any]], str | None]:
    notes: list[dict[str, Any]] = []
    offset = 0
    limit = 1000
    try:
        while True:
            data = safe_json_response(
                session,
                f"{OPENREVIEW_API}/notes",
                {"invitation": invitation, "limit": limit, "offset": offset},
            )
            batch = data.get("notes", [])
            notes.extend(batch)
            if len(batch) < limit:
                break
            offset += limit
            time.sleep(0.5)
        return notes, None
    except Exception as exc:  # noqa: BLE001
        return notes, str(exc)


def classify_note_status(note: dict[str, Any]) -> str:
    content = note.get("content", {})
    venue = str(content_value(content, "venue", "") or "")
    venue_lower = venue.lower()
    if any(term in venue_lower for term in ("withdrawn", "desk rejected", "rejected")):
        return "not_accepted_or_withdrawn_public_record"
    if any(term in venue_lower for term in ("oral", "poster", "spotlight", "accept")) and "submitted to" not in venue_lower:
        return "accepted_public"
    if "submitted to" in venue_lower:
        return "public_submission_acceptance_unknown"
    return "public_submission"


def normalize_openreview_file_url(path_or_url: str) -> str | None:
    if not path_or_url:
        return None
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    if path_or_url.startswith("/"):
        return OPENREVIEW_WEB + path_or_url
    return None


def extract_supplemental_urls(note: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for key, raw_value in note.get("content", {}).items():
        value = raw_value.get("value") if isinstance(raw_value, dict) else raw_value
        if key == "pdf":
            continue
        values = value if isinstance(value, list) else [value]
        for item in values:
            if not isinstance(item, str):
                continue
            normalized = normalize_openreview_file_url(item)
            if normalized and ("/attachment/" in normalized or url_extension(normalized) in MATERIAL_EXTENSIONS):
                urls.append(normalized)
            elif item.startswith("http://") or item.startswith("https://"):
                if any(hint in key.lower() for hint in ("supp", "code", "data", "appendix", "poster", "slide")):
                    urls.append(item)
    return sorted(set(urls))


def note_to_manifest_item(
    workshop: dict[str, Any],
    note: dict[str, Any],
    pdf_url: str | None,
    local_pdf_path: str | None,
    supplemental_urls: list[str],
    local_supplemental_paths: list[str],
    status: str,
    failure_reason: str | None,
    checked_at: str,
) -> dict[str, Any]:
    content = note.get("content", {})
    title = content_value(content, "title", "")
    authors = content_value(content, "authors", [])
    return {
        "workshop_name": workshop["name"],
        "workshop_slug": workshop["slug"],
        "source_type": "openreview_submission",
        "title": title,
        "authors": authors if isinstance(authors, list) else [authors],
        "openreview_id": note.get("id"),
        "workshop_page_url": workshop.get("workshop_page_url"),
        "openreview_url": workshop["openreview_url"],
        "paper_url": f"{OPENREVIEW_WEB}/forum?id={note.get('forum') or note.get('id')}",
        "pdf_url": pdf_url,
        "supplemental_urls": supplemental_urls,
        "local_pdf_path": local_pdf_path,
        "local_supplemental_paths": local_supplemental_paths,
        "status": status,
        "failure_reason": failure_reason,
        "source_checked_at": checked_at,
    }


def extract_links_from_page(html: str, page_url: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    links: list[dict[str, str]] = []
    for tag in soup.find_all("a", href=True):
        href = tag["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        text = " ".join(tag.get_text(" ", strip=True).split())
        full_url = absolute_url(page_url, href)
        links.append({"url": full_url, "text": text})
    return links


def should_follow_page_link(base_url: str, link: dict[str, str]) -> bool:
    url = link["url"]
    if not is_probably_same_site(base_url, url):
        return False
    parsed = urlparse(url)
    if parsed.fragment and not parsed.path:
        return False
    haystack = f"{link.get('text', '')} {parsed.path}".lower()
    return any(hint in haystack for hint in PAGE_HINTS) and url_extension(url) not in MATERIAL_EXTENSIONS


def should_record_material_link(link: dict[str, str]) -> bool:
    url = link["url"]
    haystack = f"{link.get('text', '')} {urlparse(url).path}".lower()
    ext = url_extension(url)
    return ext in MATERIAL_EXTENSIONS or any(hint in haystack for hint in MATERIAL_HINTS)


def crawl_workshop_page(
    session: requests.Session,
    workshop: dict[str, Any],
    workshop_dir: Path,
    counters: Counters,
    checked_at: str,
) -> list[dict[str, Any]]:
    page_url = workshop.get("workshop_page_url")
    if not page_url:
        return []
    manifest_items: list[dict[str, Any]] = []
    pages_to_check: list[tuple[str, str]] = [(page_url, "official_workshop_page")]
    seen_pages: set[str] = set()
    for current_url, source_type in pages_to_check:
        if current_url in seen_pages or len(seen_pages) >= 8:
            continue
        seen_pages.add(current_url)
        try:
            response = request_with_backoff(session, "GET", current_url)
            if response.status_code >= 400:
                counters.items_failed += 1
                manifest_items.append(page_manifest_item(workshop, source_type, current_url, [], [], "failed", f"HTTP {response.status_code}", checked_at))
                continue
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                continue
            html = response.text
        except Exception as exc:  # noqa: BLE001
            counters.items_failed += 1
            manifest_items.append(page_manifest_item(workshop, source_type, current_url, [], [], "failed", str(exc), checked_at))
            continue

        page_name = filename_from_url(current_url, source_type)
        if not page_name.endswith(".html"):
            page_name = Path(page_name).stem + ".html"
        local_page = workshop_dir / "pages" / page_name
        snapshot_status, snapshot_error = save_text_snapshot(session, current_url, local_page, counters)
        counters.page_items_discovered += 1
        manifest_items.append(
            page_manifest_item(
                workshop,
                source_type,
                current_url,
                [],
                [str(local_page)],
                snapshot_status,
                snapshot_error,
                checked_at,
            )
        )

        links = extract_links_from_page(html, current_url)
        for link in links:
            if should_follow_page_link(page_url, link):
                pages_to_check.append((link["url"], "workshop_program_or_schedule_page"))

        for link in links:
            if not should_record_material_link(link):
                continue
            material_url = link["url"]
            ext = url_extension(material_url)
            title = link.get("text") or filename_from_url(material_url, "linked-material")
            if ext in MATERIAL_EXTENSIONS:
                target_name = filename_from_url(material_url, title)
                target = workshop_dir / "page_materials" / target_name
                download_status, download_error = download_file(session, material_url, target, counters)
                local_paths = [str(target)] if download_status in {"downloaded", "skipped_existing"} else []
                pdf_url = material_url if ext == ".pdf" else None
                local_pdf_path = str(target) if ext == ".pdf" and local_paths else None
                supplemental_urls = [] if ext == ".pdf" else [material_url]
                local_supplemental_paths = [] if ext == ".pdf" else local_paths
            else:
                counters.items_skipped += 1
                download_status = "skipped"
                download_error = "Linked material is not a direct downloadable file"
                pdf_url = None
                local_pdf_path = None
                supplemental_urls = [material_url]
                local_supplemental_paths = []
            counters.page_items_discovered += 1
            manifest_items.append(
                {
                    "workshop_name": workshop["name"],
                    "workshop_slug": workshop["slug"],
                    "source_type": "workshop_page_linked_material",
                    "title": title,
                    "authors": [],
                    "openreview_id": None,
                    "workshop_page_url": workshop.get("workshop_page_url"),
                    "openreview_url": workshop["openreview_url"],
                    "paper_url": current_url,
                    "pdf_url": pdf_url,
                    "supplemental_urls": supplemental_urls,
                    "local_pdf_path": local_pdf_path,
                    "local_supplemental_paths": local_supplemental_paths,
                    "status": download_status,
                    "failure_reason": download_error,
                    "source_checked_at": checked_at,
                }
            )
            time.sleep(0.2)
    return manifest_items


def page_manifest_item(
    workshop: dict[str, Any],
    source_type: str,
    page_url: str,
    supplemental_urls: list[str],
    local_paths: list[str],
    status: str,
    failure_reason: str | None,
    checked_at: str,
) -> dict[str, Any]:
    return {
        "workshop_name": workshop["name"],
        "workshop_slug": workshop["slug"],
        "source_type": source_type,
        "title": source_type.replace("_", " ").title(),
        "authors": [],
        "openreview_id": None,
        "workshop_page_url": workshop.get("workshop_page_url"),
        "openreview_url": workshop["openreview_url"],
        "paper_url": page_url,
        "pdf_url": None,
        "supplemental_urls": supplemental_urls,
        "local_pdf_path": None,
        "local_supplemental_paths": local_paths,
        "status": status,
        "failure_reason": failure_reason,
        "source_checked_at": checked_at,
    }


def build_workshop_record(group: dict[str, Any]) -> dict[str, Any]:
    content = group.get("content", {})
    group_id = group["id"]
    short_slug = group_id.split("/")[-1]
    title = content_value(content, "title", short_slug)
    return {
        "workshop_name": title,
        "name": title,
        "workshop_slug": slugify(short_slug),
        "slug": slugify(short_slug),
        "openreview_group_id": group_id,
        "openreview_url": f"{OPENREVIEW_WEB}/group?id={group_id.replace('/', '%2F')}",
        "workshop_page_url": content_value(content, "website"),
        "subtitle": content_value(content, "subtitle"),
        "start_date": content_value(content, "start_date"),
        "location": content_value(content, "location"),
        "submission_id": content_value(content, "submission_id"),
        "public_submissions_setting": content_value(content, "public_submissions", False),
        "decision_heading_map": content_value(content, "decision_heading_map", {}),
        "source_checked_at": utc_now(),
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_manifest(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")


def read_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    items: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items


def recompute_summary(output_dir: Path) -> dict[str, Any]:
    index_path = output_dir / "workshops_index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    manifest_paths = list(output_dir.glob("*/manifest.jsonl"))
    manifest_items: list[dict[str, Any]] = []
    for manifest_path in manifest_paths:
        manifest_items.extend(read_manifest(manifest_path))
    files_downloaded = sum(1 for item in manifest_items if item.get("status") == "downloaded")
    files_skipped_existing = sum(1 for item in manifest_items if item.get("status") == "skipped_existing")
    files_failed = sum(1 for item in manifest_items if item.get("status") == "failed")
    items_skipped = sum(1 for item in manifest_items if item.get("status") == "skipped")
    page_items = sum(1 for item in manifest_items if item.get("source_type") != "openreview_submission")
    openreview_items = sum(1 for item in manifest_items if item.get("source_type") == "openreview_submission")
    return {
        "checked_at": utc_now(),
        "output_dir": str(output_dir),
        "workshops_discovered": len(index),
        "workshops_with_public_submissions": sum(1 for item in index if item.get("public_submission_count", 0) > 0),
        "workshops_with_manifest": len(manifest_paths),
        "openreview_items_discovered": openreview_items,
        "page_items_discovered": page_items,
        "files_downloaded": files_downloaded,
        "files_skipped_existing": files_skipped_existing,
        "files_failed": files_failed,
        "items_skipped": items_skipped,
        "items_failed": 0,
    }


def write_readme(output_dir: Path, counters: Counters, index: list[dict[str, Any]], checked_at: str) -> None:
    blocked = [w for w in index if w.get("public_submission_count", 0) == 0]
    with_public = [w for w in index if w.get("public_submission_count", 0) > 0]
    lines = [
        "# ICML 2026 Workshop Materials",
        "",
        f"Checked at: {checked_at}",
        "",
        "Scope: ICML 2026 workshop and affinity-workshop materials only. Main conference papers and main conference poster materials are out of scope.",
        "",
        "Source-of-truth pages:",
        f"- OpenReview ICML 2026 Workshop group: {OPENREVIEW_WEB}/group?id=ICML.cc%2F2026%2FWorkshop",
        f"- ICML 2026 call for workshops: {OFFICIAL_ICML_URLS['call_for_workshops']}",
        f"- ICML 2026 schedule page: {OFFICIAL_ICML_URLS['schedule']}",
        f"- ICML 2026 workshop poster instructions: {OFFICIAL_ICML_URLS['poster_instructions']}",
        "",
        "## Counts",
        "",
        f"- Workshops discovered: {counters.workshops_discovered}",
        f"- Workshops with public OpenReview submissions discovered: {counters.workshops_with_public_submissions}",
        f"- Workshops with manifest files: {counters.workshops_with_manifest}",
        f"- OpenReview submission items discovered: {counters.openreview_items_discovered}",
        f"- Workshop-page/page-material items discovered: {counters.page_items_discovered}",
        f"- Files downloaded: {counters.files_downloaded}",
        f"- Files skipped because already present: {counters.files_skipped_existing}",
        f"- Items skipped: {counters.items_skipped}",
        f"- Failed file downloads: {counters.files_failed}",
        f"- Failed item checks: {counters.items_failed}",
        "",
        "## Current Availability",
        "",
        "OpenReview venue groups were publicly enumerable. Per-workshop submissions/materials are only included when the official OpenReview venue API or the first-party workshop website made them public without authentication.",
        "",
        "Workshops with public OpenReview submissions:",
    ]
    if with_public:
        for workshop in with_public:
            lines.append(
                f"- {workshop['workshop_name']} (`{workshop['workshop_slug']}`): {workshop['public_submission_count']} public submission item(s)"
            )
    else:
        lines.append("- None found.")
    lines.extend(["", "Workshops without public OpenReview submissions discovered:"])
    if blocked:
        for workshop in blocked:
            reason = workshop.get("submission_blocker") or "No public submissions returned by OpenReview at check time."
            lines.append(f"- {workshop['workshop_name']} (`{workshop['workshop_slug']}`): {reason}")
    else:
        lines.append("- None.")
    lines.extend(
        [
            "",
            "## Files",
            "",
            "- Global index: `workshops_index.json`",
            "- Per-workshop manifests: `<workshop_slug>/manifest.jsonl`",
            "- OpenReview PDFs: `<workshop_slug>/openreview_pdfs/`",
            "- OpenReview supplemental files: `<workshop_slug>/openreview_supplemental/`",
            "- First-party page snapshots: `<workshop_slug>/pages/`",
            "- Downloadable first-party page materials: `<workshop_slug>/page_materials/`",
            "",
            "## Notes",
            "",
            "- Acceptance is taken from OpenReview venue labels such as Poster, Oral, Spotlight, or explicit Accept mappings. Generic submitted records are not treated as accepted.",
            "- Third-party pages, social media, and arXiv searches were not used to infer workshop acceptance.",
            "- Authentication was not attempted. Login-gated or non-direct-download links are recorded as skipped or blocked rather than bypassed.",
        ]
    )
    (output_dir / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def collect(output_dir: Path, crawl_pages: bool) -> int:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    checked_at = utc_now()
    counters = Counters()
    output_dir.mkdir(parents=True, exist_ok=True)

    groups = fetch_workshop_groups(session)
    counters.workshops_discovered = len(groups)
    index: list[dict[str, Any]] = []

    for position, group in enumerate(groups, start=1):
        workshop = build_workshop_record(group)
        slug = workshop["workshop_slug"]
        print(f"[{position}/{len(groups)}] {slug}", flush=True)
        workshop_dir = output_dir / slug
        manifest: list[dict[str, Any]] = []
        notes, note_error = fetch_notes(session, workshop["submission_id"])
        workshop["public_submission_count"] = len(notes)
        workshop["submission_query_error"] = note_error
        if note_error:
            workshop["submission_blocker"] = f"OpenReview note query failed: {note_error}"
            counters.items_failed += 1
        elif not notes:
            workshop["submission_blocker"] = "No public submissions returned by OpenReview at check time."
        else:
            counters.workshops_with_public_submissions += 1
            counters.openreview_items_discovered += len(notes)

        for note in notes:
            content = note.get("content", {})
            title = content_value(content, "title", note.get("id", "submission"))
            pdf_url = normalize_openreview_file_url(content_value(content, "pdf", ""))
            local_pdf_path = None
            item_status = classify_note_status(note)
            failure_reason = None
            if pdf_url:
                target = workshop_dir / "openreview_pdfs" / f"{note.get('number', note.get('id'))}-{slugify(str(title))[:80]}.pdf"
                download_status, download_error = download_file(session, pdf_url, target, counters)
                if download_status in {"downloaded", "skipped_existing"}:
                    local_pdf_path = str(target)
                else:
                    item_status = download_status
                    failure_reason = download_error
            supplemental_urls = extract_supplemental_urls(note)
            local_supplemental_paths: list[str] = []
            supplemental_failures: list[str] = []
            for idx, supplemental_url in enumerate(supplemental_urls, start=1):
                target_name = filename_from_url(supplemental_url, f"{note.get('id')}-supplemental-{idx}")
                target = workshop_dir / "openreview_supplemental" / target_name
                supp_status, supp_error = download_file(session, supplemental_url, target, counters)
                if supp_status in {"downloaded", "skipped_existing"}:
                    local_supplemental_paths.append(str(target))
                elif supp_error:
                    supplemental_failures.append(f"{supplemental_url}: {supp_error}")
            if supplemental_failures:
                failure_reason = "; ".join(filter(None, [failure_reason, *supplemental_failures]))
            manifest.append(
                note_to_manifest_item(
                    workshop,
                    note,
                    pdf_url,
                    local_pdf_path,
                    supplemental_urls,
                    local_supplemental_paths,
                    item_status,
                    failure_reason,
                    checked_at,
                )
            )
            time.sleep(0.15)

        if crawl_pages:
            page_items = crawl_workshop_page(session, workshop, workshop_dir, counters, checked_at)
            manifest.extend(page_items)

        if manifest:
            write_manifest(workshop_dir / "manifest.jsonl", manifest)
            workshop["manifest_path"] = str(workshop_dir / "manifest.jsonl")
            workshop["manifest_item_count"] = len(manifest)
            counters.workshops_with_manifest += 1
        else:
            workshop["manifest_path"] = None
            workshop["manifest_item_count"] = 0
        index.append(workshop)
        write_json(output_dir / "workshops_index.json", index)
        time.sleep(0.5)

    write_json(output_dir / "workshops_index.json", index)
    write_readme(output_dir, counters, index, checked_at)
    summary = {
        "checked_at": checked_at,
        "output_dir": str(output_dir),
        **counters.__dict__,
    }
    write_json(output_dir / "collection_summary.json", summary)
    print(json.dumps(summary, indent=2, sort_keys=True), flush=True)
    return 0


def collect_workshop_pages_only(output_dir: Path) -> int:
    index_path = output_dir / "workshops_index.json"
    if not index_path.exists():
        raise FileNotFoundError(f"Missing workshop index: {index_path}")
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    checked_at = utc_now()
    counters = Counters()
    index = json.loads(index_path.read_text(encoding="utf-8"))
    counters.workshops_discovered = len(index)
    for position, workshop in enumerate(index, start=1):
        slug = workshop["workshop_slug"]
        print(f"[pages {position}/{len(index)}] {slug}", flush=True)
        workshop_dir = output_dir / slug
        manifest_path = workshop_dir / "manifest.jsonl"
        existing_items = read_manifest(manifest_path)
        page_items = crawl_workshop_page(session, workshop, workshop_dir, counters, checked_at)
        combined = existing_items + page_items
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[Any, ...]] = set()
        for item in combined:
            key = (
                item.get("source_type"),
                item.get("paper_url"),
                item.get("pdf_url"),
                tuple(item.get("supplemental_urls") or []),
                item.get("title"),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        if deduped:
            write_manifest(manifest_path, deduped)
            workshop["manifest_path"] = str(manifest_path)
            workshop["manifest_item_count"] = len(deduped)
        time.sleep(0.25)
    write_json(index_path, index)
    summary = recompute_summary(output_dir)
    write_json(output_dir / "collection_summary.json", summary)
    readme_counters = Counters(
        workshops_discovered=summary["workshops_discovered"],
        workshops_with_public_submissions=summary["workshops_with_public_submissions"],
        workshops_with_manifest=summary["workshops_with_manifest"],
        openreview_items_discovered=summary["openreview_items_discovered"],
        page_items_discovered=summary["page_items_discovered"],
        files_downloaded=summary["files_downloaded"],
        files_skipped_existing=summary["files_skipped_existing"],
        files_failed=summary["files_failed"],
        items_skipped=summary["items_skipped"],
        items_failed=summary["items_failed"],
    )
    write_readme(output_dir, readme_counters, index, summary["checked_at"])
    print(json.dumps(summary, indent=2, sort_keys=True), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        default="icml_2026_materials/workshops",
        help="Output directory for workshop materials.",
    )
    parser.add_argument(
        "--skip-workshop-pages",
        action="store_true",
        help="Only collect OpenReview metadata/PDFs; do not crawl first-party workshop pages.",
    )
    parser.add_argument(
        "--only-workshop-pages",
        action="store_true",
        help="Use an existing workshops_index.json and only crawl first-party workshop pages.",
    )
    args = parser.parse_args()
    if args.only_workshop_pages:
        return collect_workshop_pages_only(Path(args.output_dir))
    return collect(Path(args.output_dir), crawl_pages=not args.skip_workshop_pages)


if __name__ == "__main__":
    sys.exit(main())
