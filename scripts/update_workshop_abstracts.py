#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import requests
except Exception:  # noqa: BLE001 - optional when running PDF-only fallback.
    requests = None


ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "icml_2026_materials"
WORKSHOP_ROOT = MATERIALS / "workshops"
ABSTRACTS_PATH = MATERIALS / "abstracts.jsonl"
OPENREVIEW_API = "https://api2.openreview.net"
OPENREVIEW_WEB = "https://openreview.net"
USER_AGENT = "ICML2026WorkshopAbstractUpdater/1.0 (+public official-source archival)"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def content_value(content: dict[str, Any], key: str, default: Any = "") -> Any:
    raw = content.get(key, default)
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def normalize_space(value: str) -> str:
    value = re.sub(r"-\s+", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def abstract_key(row: dict[str, Any]) -> str:
    paper_url = str(row.get("paper_url") or "")
    name = str(row.get("name") or "").strip().lower()
    return paper_url or f"title:{name}"


def iter_workshop_submissions() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for manifest in sorted(WORKSHOP_ROOT.glob("*/manifest.jsonl")):
        for row in read_jsonl(manifest):
            if row.get("source_type") != "openreview_submission":
                continue
            if row.get("status") != "accepted_public":
                continue
            rows.append(row)
    rows.sort(key=lambda item: (str(item.get("workshop_slug") or ""), str(item.get("title") or "")))
    return rows


def row_to_abstract_entry(source: dict[str, Any], abstract: str, source_kind: str) -> dict[str, Any]:
    openreview_id = str(source.get("openreview_id") or "")
    return {
        "id": openreview_id,
        "name": source.get("title") or "Untitled",
        "abstract": abstract,
        "paper_url": source.get("paper_url") or f"{OPENREVIEW_WEB}/forum?id={quote(openreview_id)}",
        "event_type": "Workshop",
        "virtualsite_url": "",
        "source": source_kind,
        "workshop_slug": source.get("workshop_slug") or "",
        "workshop_name": source.get("workshop_name") or "",
    }


def fetch_openreview_abstract(openreview_id: str, *, delay: float) -> str:
    if not requests or not openreview_id:
        return ""
    url = f"{OPENREVIEW_API}/notes"
    params = {"id": openreview_id}
    for attempt in range(4):
        try:
            response = requests.get(
                url,
                params=params,
                timeout=35,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            if response.status_code == 429:
                time.sleep(min(60, delay * (attempt + 1) ** 2))
                continue
            if response.status_code >= 400:
                return ""
            payload = response.json()
            notes = payload.get("notes") or []
            if not notes:
                return ""
            content = notes[0].get("content") or {}
            abstract = content_value(content, "abstract", "")
            if not abstract:
                abstract = content_value(content, "Abstract", "")
            if isinstance(abstract, list):
                abstract = " ".join(str(item) for item in abstract)
            return normalize_space(str(abstract))
        except Exception:  # noqa: BLE001 - keep the daily updater moving.
            time.sleep(min(30, delay * (attempt + 1)))
    return ""


def left_column(line: str) -> str:
    if len(line) - len(line.lstrip(" ")) > 20:
        return ""
    parts = [part.strip() for part in re.split(r"\s{3,}", line.rstrip()) if part.strip()]
    return parts[0] if parts else ""


def extract_abstract_from_layout_text(text: str) -> str:
    lines = text.replace("\x0c", "\n").splitlines()
    start = None
    for index, line in enumerate(lines):
        if re.fullmatch(r"\s*abstract\s*", left_column(line), flags=re.I) or re.search(r"^\s*abstract\b", line, flags=re.I):
            start = index + 1
            break
        if re.search(r"\babstract\b", line, flags=re.I):
            start = index + 1
            break
    if start is None:
        return ""

    chunks: list[str] = []
    for line in lines[start:]:
        chunk = left_column(line)
        if not chunk:
            continue
        if re.match(r"^(?:\d+\.|[IVX]+\.)\s+[A-Z]", chunk):
            break
        if re.match(r"^(?:introduction|overview|background)\b", chunk, flags=re.I):
            break
        if re.match(r"^proceedings of\b", chunk, flags=re.I):
            continue
        if re.match(r"^(?:\*|†|‡|\d+\s)", chunk):
            continue
        chunks.append(chunk)
        if len(" ".join(chunks)) > 2600:
            break
    abstract = normalize_space(" ".join(chunks))
    return abstract if len(abstract) >= 80 else ""


def extract_abstract_from_plain_text(text: str) -> str:
    normalized = text.replace("\x0c", "\n")
    match = re.search(
        r"\bAbstract\b(?P<body>.*?)(?:\n\s*(?:1\.|I\.)\s+[A-Z]|\n\s*(?:Introduction|Overview|Background)\b)",
        normalized,
        flags=re.I | re.S,
    )
    if not match:
        return ""
    abstract = normalize_space(match.group("body"))
    return abstract if len(abstract) >= 80 else ""


def extract_pdf_abstract(pdf_path: Path) -> str:
    if not pdf_path.exists() or not shutil.which("pdftotext"):
        return ""
    commands = [
        ["pdftotext", "-layout", "-f", "1", "-l", "2", str(pdf_path), "-"],
        ["pdftotext", "-f", "1", "-l", "2", str(pdf_path), "-"],
    ]
    for index, command in enumerate(commands):
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=25)
        except Exception:  # noqa: BLE001
            continue
        if result.returncode != 0 or not result.stdout.strip():
            continue
        abstract = extract_abstract_from_layout_text(result.stdout) if index == 0 else extract_abstract_from_plain_text(result.stdout)
        if abstract:
            return abstract
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill ICML 2026 workshop abstracts from OpenReview and local PDFs.")
    parser.add_argument("--write", action="store_true", help="Write abstracts.jsonl. Default is dry-run.")
    parser.add_argument("--api", action="store_true", help="Try OpenReview API before PDF fallback.")
    parser.add_argument("--pdf", action="store_true", help="Try local PDF text extraction.")
    parser.add_argument("--limit", type=int, default=0, help="Limit accepted workshop records for debugging.")
    parser.add_argument("--delay", type=float, default=2.5, help="OpenReview retry/backoff base delay.")
    args = parser.parse_args()

    use_api = args.api
    use_pdf = args.pdf or not args.api
    rows = read_jsonl(ABSTRACTS_PATH)
    existing = {abstract_key(row): row for row in rows if len(str(row.get("abstract") or "")) >= 40}
    additions: list[dict[str, Any]] = []
    counters = {
        "accepted_workshop_records": 0,
        "already_present": 0,
        "from_manifest": 0,
        "from_openreview_api": 0,
        "from_pdf": 0,
        "missing": 0,
    }

    submissions = iter_workshop_submissions()
    if args.limit:
        submissions = submissions[: args.limit]

    for source in submissions:
        counters["accepted_workshop_records"] += 1
        key = source.get("paper_url") or f"{OPENREVIEW_WEB}/forum?id={quote(str(source.get('openreview_id') or ''))}"
        if key in existing:
            counters["already_present"] += 1
            continue

        abstract = normalize_space(str(source.get("abstract") or ""))
        source_kind = "workshop_manifest"
        if abstract:
            counters["from_manifest"] += 1
        if not abstract and use_api:
            abstract = fetch_openreview_abstract(str(source.get("openreview_id") or ""), delay=args.delay)
            source_kind = "openreview_api"
            if abstract:
                counters["from_openreview_api"] += 1
        if not abstract and use_pdf:
            pdf_path = ROOT / str(source.get("local_pdf_path") or "")
            abstract = extract_pdf_abstract(pdf_path)
            source_kind = "workshop_pdf_text"
            if abstract:
                counters["from_pdf"] += 1

        if len(abstract) >= 80:
            entry = row_to_abstract_entry(source, abstract, source_kind)
            existing[abstract_key(entry)] = entry
            additions.append(entry)
        else:
            counters["missing"] += 1

    if args.write and additions:
        write_jsonl(ABSTRACTS_PATH, rows + additions)

    print(json.dumps({
        **counters,
        "new_abstracts": len(additions),
        "abstracts_path": str(ABSTRACTS_PATH),
        "wrote": bool(args.write and additions),
    }, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
