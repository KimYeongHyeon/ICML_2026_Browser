#!/usr/bin/env python3
from __future__ import annotations

import argparse
import email.utils
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path
from typing import Any, Optional


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "docs/site/data/icml2026_index.json"
OUT_ROOT = ROOT / "docs/site/data/references"
MANIFEST_PATH = OUT_ROOT / "manifest.json"
RECORDS_ROOT = OUT_ROOT / "records"
DEFAULT_CACHE_PATH = ROOT / ".cache/icml_references_openalex.json"
DEFAULT_SMOKE_OUT_ROOT = Path("/tmp/icml_refs_smoke")

MAX_REFERENCES_PER_RECORD = 64
MAX_REFERENCE_TEXT = 220
MAX_REFERENCE_SAMPLE = 12
MAX_OVERLAPS_PER_RECORD = 16
MAX_SHARED_REFS_PER_OVERLAP = 5
TOP_REFERENCES = 80
TOP_AUTHORS = 80
OPENALEX_API = "https://api.openalex.org"
OPENALEX_SEARCH_PAGE_SIZE = 5
OPENALEX_DETAIL_PAGE_SIZE = 25
CROSSREF_API = "https://api.crossref.org"
CROSSREF_SEARCH_ROWS = 3
HTTP_RETRY_ATTEMPTS = 5
HTTP_RETRY_MAX_SLEEP = 20.0
TRANSIENT_HTTP_STATUSES = {429, 500, 502, 503, 504}

REFERENCE_HEADING_RE = re.compile(r"^\s*(?:\d+\s+)?(references|bibliography|works cited)\b", re.I)
STOP_HEADING_RE = re.compile(r"^\s*(?:\d+\s+)?(appendix|supplementary material|checklist|acknowledg(e)?ments?)\b", re.I)
NUMBERED_REF_RE = re.compile(r"^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s+")
AUTHOR_START_RE = re.compile(r"^[A-Z][A-Za-z'`-]+,\s+(?:[A-Z]\.|[A-Z][a-z])")
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b")
URL_RE = re.compile(r"https?://\S+|doi:\S+", re.I)
REFERENCE_FRAGMENT_RE = re.compile(
  r"^(?:"
  r"\d+[-–]\d+(?:,\s*\d+)?"
  r"|pp\."
  r"|url\b"
  r"|and\b"
  r"|in\s+(?:proceedings|advances|transactions|journal)\b"
  r")",
  re.I,
)
LATEX_WORDS = {
  r"\alpha": " alpha ",
  r"\beta": " beta ",
  r"\gamma": " gamma ",
  r"\delta": " delta ",
  r"\epsilon": " epsilon ",
  r"\lambda": " lambda ",
  r"\mathbb": " ",
  r"\mathcal": " ",
  r"\mathrm": " ",
  r"\mathbf": " ",
  r"\text": " ",
}


def read_json(path: Path) -> dict[str, Any]:
  return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def compact_text(value: Any) -> str:
  return " ".join(str(value or "").replace("\x00", "").split())


def normalize_key(value: str) -> str:
  text = URL_RE.sub(" ", value.lower())
  text = YEAR_RE.sub(" ", text)
  text = re.sub(r"[^a-z0-9]+", " ", text)
  return " ".join(text.split())[:160]


def normalize_title(value: str) -> str:
  text = compact_text(value).lower()
  for old, new in LATEX_WORDS.items():
    text = text.replace(old, new)
  text = re.sub(r"\\[a-zA-Z]+", " ", text)
  text = re.sub(r"[$^_{}]", " ", text)
  text = re.sub(r"[^a-z0-9]+", " ", text)
  return " ".join(text.split())


def titles_match(index_title: str, openalex_title: str) -> bool:
  left = normalize_title(index_title)
  right = normalize_title(openalex_title)
  if not left or not right:
    return False
  if left == right:
    return True
  if len(left) >= 24 and len(right) >= 24 and (left in right or right in left):
    return True
  score = SequenceMatcher(None, left, right).ratio()
  left_tokens = set(left.split())
  right_tokens = set(right.split())
  overlap = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
  return score >= 0.92 or (score >= 0.84 and overlap >= 0.86)


def rel(path: Path) -> str:
  return path.relative_to(ROOT).as_posix()


def display_path(path: Path) -> str:
  try:
    return rel(path)
  except ValueError:
    return str(path)


def is_checked_in_reference_root(path: Path) -> bool:
  return path.resolve() == OUT_ROOT.resolve()


def record_filename(record_id: str) -> str:
  digest = hashlib.sha256(record_id.encode("utf-8")).hexdigest()[:16]
  return f"{digest}.json"


def extract_pdf_text(pdf_path: Path, extractor: str, timeout: int) -> str:
  result = subprocess.run(
    [extractor, "-layout", "-enc", "UTF-8", str(pdf_path), "-"],
    check=False,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    timeout=timeout,
  )
  if result.returncode != 0:
    raise RuntimeError(compact_text(result.stderr) or f"pdftotext exited {result.returncode}")
  return result.stdout


def request_bytes(url: str, headers: dict[str, str], timeout: int, sleep: float) -> tuple[bytes, str]:
  base_delay = sleep if sleep > 0 else 1.0
  for attempt in range(HTTP_RETRY_ATTEMPTS):
    try:
      request = urllib.request.Request(url, headers=headers)
      with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), str(response.headers.get("content-type") or "")
    except urllib.error.HTTPError as exc:
      if exc.code not in TRANSIENT_HTTP_STATUSES or attempt == HTTP_RETRY_ATTEMPTS - 1:
        raise
      sleep_if_needed(retry_after_seconds(exc, base_delay * (2 ** attempt)))
  raise RuntimeError("unreachable HTTP retry state")


def openreview_id_from_record(record: dict[str, Any]) -> str:
  record_id = str(record.get("id") or "")
  if record_id.startswith("openreview:"):
    return record_id.split(";", 1)[0].split(":", 1)[1]
  page_url = str(record.get("pageUrl") or record.get("openreviewUrl") or "")
  parsed = urllib.parse.urlparse(page_url)
  query_id = urllib.parse.parse_qs(parsed.query).get("id") or []
  return str(query_id[0] if query_id else "")


def record_pdf_url(record: dict[str, Any]) -> str:
  pdf_url = compact_text(record.get("pdfUrl"))
  if pdf_url:
    return urllib.parse.urljoin("https://openreview.net", pdf_url)
  openreview_id = openreview_id_from_record(record)
  if openreview_id:
    return f"https://openreview.net/pdf?id={urllib.parse.quote(openreview_id)}"
  return ""


def strip_pdf_line(line: str) -> str:
  return compact_text(line.replace("\f", " "))


def reference_section(text: str) -> list[str]:
  lines = text.splitlines()
  starts = [index for index, line in enumerate(lines) if REFERENCE_HEADING_RE.match(strip_pdf_line(line))]
  if not starts:
    return []
  section: list[str] = []
  for line in lines[starts[-1] + 1:]:
    stripped = strip_pdf_line(line)
    if not stripped:
      section.append("")
      continue
    if len(section) > 8 and STOP_HEADING_RE.match(stripped):
      break
    section.append(stripped)
  return section


def is_reference_start(line: str) -> bool:
  return bool(NUMBERED_REF_RE.match(line) or AUTHOR_START_RE.match(line))


def clean_reference(value: str) -> str:
  value = NUMBERED_REF_RE.sub("", value)
  value = value.replace("- ", "")
  value = compact_text(value)
  return value[:MAX_REFERENCE_TEXT].rstrip(" ,;")


def looks_like_reference(value: str) -> bool:
  if len(value) < 35:
    return False
  if YEAR_RE.search(value) or URL_RE.search(value):
    return True
  return value.count(".") >= 2 and "," in value


def split_references(lines: list[str]) -> list[str]:
  refs: list[str] = []
  current: list[str] = []

  def flush() -> None:
    if not current:
      return
    ref = clean_reference(" ".join(current))
    if looks_like_reference(ref):
      refs.append(ref)
    current.clear()

  for line in lines:
    if not line:
      continue
    if is_reference_start(line) and current:
      flush()
    current.append(line)
  flush()

  deduped: list[str] = []
  seen: set[str] = set()
  for ref in refs:
    key = normalize_key(ref)
    if key and key not in seen:
      seen.add(key)
      deduped.append(ref)
    if len(deduped) >= MAX_REFERENCES_PER_RECORD:
      break
  return deduped


def parse_authors(ref: str) -> list[str]:
  first_sentence = ref.split(". ", 1)[0]
  names = re.findall(r"\b([A-Z][A-Za-z'`-]+),\s+(?:[A-Z]\.|[A-Z][a-z])", first_sentence)
  return names[:10]


def parse_title(ref: str) -> str:
  parts = [part.strip(" .") for part in re.split(r"\.\s+", ref) if part.strip(" .")]
  for part in parts[1:4]:
    if URL_RE.search(part):
      continue
    if len(part) >= 12 and not AUTHOR_START_RE.match(part):
      return part[:140]
  match = re.search(r"\b(?:19|20)\d{2}[a-z]?[.)]?\s+(.+?)(?:\.\s|$)", ref)
  if match:
    return match.group(1).strip(" .")[:140]
  return ""


def reference_entry(ref: str) -> dict[str, Any]:
  title = parse_title(ref)
  if not clean_reference_title(title, ref):
    return {}
  key_source = title or ref
  return {
    "key": normalize_key(key_source),
    "raw": ref,
    "title": title,
    "authors": parse_authors(ref),
  }


def clean_reference_title(title: str, raw: str) -> bool:
  title = compact_text(title)
  raw = compact_text(raw)
  if not title or len(title) < 18:
    return False
  if re.match(r"^(?:URL|https?:)", raw, re.I):
    return False
  if REFERENCE_FRAGMENT_RE.match(title):
    return False
  if re.match(r"^in\s+(?:the\s+)?(?:proceedings|conference|journal|transactions)\b", title, re.I):
    return False
  if len(title.split()) < 3:
    return False
  if title.count(",") >= 4:
    return False
  if re.search(r"[a-z]{3,}[A-Z][a-z]+", title):
    return False
  if re.search(r"\b(?:URL|doi:|arXiv:)\b", title, re.I):
    return False
  if re.match(r"^[A-Z][A-Za-z'`-]+,\s+(?:[A-Z]\.|[A-Z][a-z])", title):
    return False
  if not (YEAR_RE.search(raw) or URL_RE.search(raw) or len(raw) >= 60):
    return False
  return True


def reference_entries_from_text(text: str) -> list[dict[str, Any]]:
  return [entry for entry in (reference_entry(ref) for ref in split_references(reference_section(text))) if entry.get("key")]


def reference_entries_from_pdf_path(pdf_path: Path, extractor: str, timeout: int) -> list[dict[str, Any]]:
  return reference_entries_from_text(extract_pdf_text(pdf_path, extractor, timeout))


def reference_entries_from_remote_pdf(record: dict[str, Any], extractor: str, timeout: int, sleep: float) -> list[dict[str, Any]]:
  pdf_url = record_pdf_url(record)
  if not pdf_url:
    return []
  headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": str(record.get("openreviewUrl") or "https://openreview.net/"),
  }
  body, content_type = request_bytes(pdf_url, headers, timeout, sleep)
  if not body.startswith(b"%PDF") and "pdf" not in content_type.lower():
    raise RuntimeError(f"remote_pdf_not_pdf:{content_type or 'unknown'}")
  with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
    handle.write(body)
    handle.flush()
    return reference_entries_from_pdf_path(Path(handle.name), extractor, timeout)


def openalex_id(value: str) -> str:
  return value.rstrip("/").rsplit("/", 1)[-1]


def openalex_authors(work: dict[str, Any]) -> list[str]:
  authors: list[str] = []
  for authorship in work.get("authorships") or []:
    author = authorship.get("author") or {}
    name = compact_text(author.get("display_name"))
    if name:
      authors.append(name)
    if len(authors) >= 10:
      break
  return authors


def openalex_source(work: dict[str, Any]) -> str:
  location = work.get("primary_location") or {}
  source = location.get("source") or {}
  return compact_text(source.get("display_name"))


def openalex_reference_entry(work: dict[str, Any]) -> dict[str, Any]:
  title = compact_text(work.get("display_name"))[:140]
  source = openalex_source(work)
  year = work.get("publication_year")
  raw_parts = [title]
  if year:
    raw_parts.append(str(year))
  if source:
    raw_parts.append(source)
  return {
    "key": normalize_key(title or str(work.get("id") or "")),
    "raw": ". ".join(raw_parts)[:MAX_REFERENCE_TEXT],
    "title": title,
    "authors": openalex_authors(work),
    "year": year,
    "source": source,
    "openAlexId": openalex_id(str(work.get("id") or "")),
  }


def load_openalex_cache(path: Path) -> dict[str, Any]:
  if not path.exists():
    return {"titleLookups": {}, "works": {}, "crossrefTitleLookups": {}}
  cache = read_json(path)
  cache.setdefault("titleLookups", {})
  cache.setdefault("works", {})
  cache.setdefault("crossrefTitleLookups", {})
  return cache


def retry_after_seconds(error: urllib.error.HTTPError, fallback: float) -> float:
  value = error.headers.get("Retry-After", "")
  if value.isdigit():
    return min(HTTP_RETRY_MAX_SLEEP, max(0.0, float(value)))
  if value:
    try:
      retry_at = email.utils.parsedate_to_datetime(value)
      return min(HTTP_RETRY_MAX_SLEEP, max(0.0, retry_at.timestamp() - time.time()))
    except (TypeError, ValueError, IndexError, OverflowError):
      pass
  return min(HTTP_RETRY_MAX_SLEEP, fallback)


def request_json(url: str, headers: dict[str, str], timeout: int, sleep: float) -> dict[str, Any]:
  base_delay = sleep if sleep > 0 else 1.0
  for attempt in range(HTTP_RETRY_ATTEMPTS):
    try:
      request = urllib.request.Request(url, headers=headers)
      with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
      if exc.code not in TRANSIENT_HTTP_STATUSES or attempt == HTTP_RETRY_ATTEMPTS - 1:
        raise
      delay = retry_after_seconds(exc, base_delay * (2 ** attempt))
      sleep_if_needed(delay)
  raise RuntimeError("unreachable HTTP retry state")


def openalex_params(params: dict[str, str], mailto: str) -> dict[str, str]:
  request_params = dict(params)
  if mailto:
    request_params["mailto"] = mailto
  api_key = os.environ.get("OPENALEX_API_KEY")
  if api_key:
    request_params["api_key"] = api_key
  return request_params


def openalex_get(path: str, params: dict[str, str], mailto: str, timeout: int, sleep: float) -> dict[str, Any]:
  url = f"{OPENALEX_API}{path}?{urllib.parse.urlencode(openalex_params(params, mailto))}"
  headers = {"User-Agent": f"icml-2026-materials-browser/1.0 mailto:{mailto or 'none'}"}
  return request_json(url, headers, timeout, sleep)


def sleep_if_needed(seconds: float) -> None:
  if seconds > 0:
    time.sleep(seconds)


def cached_openalex_lookup(
  title: str,
  cache: dict[str, Any],
  mailto: str,
  timeout: int,
  sleep: float,
) -> tuple[dict[str, Any], bool]:
  key = normalize_title(title)
  title_cache = cache["titleLookups"]
  if key in title_cache:
    return title_cache[key], True

  payload = openalex_get(
    "/works",
    {
      "filter": f"title.search:{key}",
      "per-page": str(OPENALEX_SEARCH_PAGE_SIZE),
      "select": "id,display_name,publication_year,referenced_works,authorships,primary_location",
    },
    mailto,
    timeout,
    sleep,
  )
  sleep_if_needed(sleep)
  candidates = payload.get("results") or []
  matched = next((work for work in candidates if titles_match(title, str(work.get("display_name") or ""))), None)
  result = {"matched": bool(matched), "work": matched}
  if not matched:
    result["candidates"] = [compact_text(work.get("display_name")) for work in candidates[:3]]
  title_cache[key] = result
  return result, False


def fetch_openalex_work_details(
  ids: list[str],
  cache: dict[str, Any],
  mailto: str,
  timeout: int,
  sleep: float,
) -> None:
  works = cache["works"]
  missing = [work_id for work_id in ids if work_id and work_id not in works]
  for index in range(0, len(missing), OPENALEX_DETAIL_PAGE_SIZE):
    chunk = missing[index:index + OPENALEX_DETAIL_PAGE_SIZE]
    payload = openalex_get(
      "/works",
      {
        "filter": f"ids.openalex:{'|'.join(chunk)}",
        "per-page": str(OPENALEX_DETAIL_PAGE_SIZE),
        "select": "id,display_name,publication_year,authorships,primary_location",
      },
      mailto,
      timeout,
      sleep,
    )
    for work in payload.get("results") or []:
      works[str(work.get("id") or "")] = work
    for work_id in chunk:
      works.setdefault(work_id, None)
    sleep_if_needed(sleep)


def openalex_reference_entries(
  work: dict[str, Any],
  cache: dict[str, Any],
  mailto: str,
  timeout: int,
  sleep: float,
) -> list[dict[str, Any]]:
  ref_ids = [str(work_id) for work_id in (work.get("referenced_works") or [])[:MAX_REFERENCES_PER_RECORD]]
  fetch_openalex_work_details(ref_ids, cache, mailto, timeout, sleep)
  entries = []
  for work_id in ref_ids:
    ref_work = cache["works"].get(work_id)
    if ref_work:
      entry = openalex_reference_entry(ref_work)
      if entry["key"]:
        entries.append(entry)
  return entries


def crossref_get(path: str, params: dict[str, str], mailto: str, timeout: int, sleep: float) -> dict[str, Any]:
  if mailto:
    params = {**params, "mailto": mailto}
  url = f"{CROSSREF_API}{path}?{urllib.parse.urlencode(params)}"
  headers = {"User-Agent": f"icml-2026-materials-browser/1.0 mailto:{mailto or 'none'}"}
  return request_json(url, headers, timeout, sleep)


def crossref_first_text(value: Any) -> str:
  if isinstance(value, list):
    return compact_text(value[0] if value else "")
  return compact_text(value)


def crossref_item_title(item: dict[str, Any]) -> str:
  return crossref_first_text(item.get("title"))


def crossref_reference_authors(ref: dict[str, Any]) -> list[str]:
  author = compact_text(ref.get("author"))
  if not author:
    return []
  return [name.strip() for name in re.split(r"\s+(?:and|&)\s+", author) if name.strip()][:10]


def crossref_reference_entry(ref: dict[str, Any]) -> dict[str, Any]:
  doi = compact_text(ref.get("DOI") or ref.get("doi"))
  title = compact_text(ref.get("article-title") or ref.get("volume-title"))[:140]
  year = compact_text(ref.get("year"))
  raw = compact_text(ref.get("unstructured"))
  if not raw:
    raw = ". ".join(part for part in (title, year, doi) if part)[:MAX_REFERENCE_TEXT]
  entry: dict[str, Any] = {
    "key": normalize_key(doi or title or raw),
    "raw": raw[:MAX_REFERENCE_TEXT],
    "title": title,
    "authors": crossref_reference_authors(ref),
    "source": "Crossref",
  }
  if year.isdigit():
    entry["year"] = int(year)
  if doi:
    entry["doi"] = doi
  return entry


def crossref_reference_entries(item: dict[str, Any]) -> list[dict[str, Any]]:
  entries: list[dict[str, Any]] = []
  seen: set[str] = set()
  for ref in (item.get("reference") or [])[:MAX_REFERENCES_PER_RECORD]:
    if not isinstance(ref, dict):
      continue
    entry = crossref_reference_entry(ref)
    key = str(entry.get("key") or "")
    if key and key not in seen:
      seen.add(key)
      entries.append(entry)
  return entries


def cached_crossref_lookup(
  title: str,
  cache: dict[str, Any],
  mailto: str,
  timeout: int,
  sleep: float,
) -> tuple[dict[str, Any], bool]:
  key = normalize_title(title)
  title_cache = cache["crossrefTitleLookups"]
  if key in title_cache:
    return title_cache[key], True

  payload = crossref_get(
    "/works",
    {
      "query.title": compact_text(title),
      "rows": str(CROSSREF_SEARCH_ROWS),
    },
    mailto,
    timeout,
    sleep,
  )
  sleep_if_needed(sleep)
  candidates = (payload.get("message") or {}).get("items") or []
  matched = next((item for item in candidates if titles_match(title, crossref_item_title(item))), None)
  result = {"matched": bool(matched), "work": matched}
  if not matched:
    result["candidates"] = [crossref_item_title(item) for item in candidates[:3]]
  title_cache[key] = result
  return result, False


def count_bucket(bucket: dict[str, dict[str, int]], label: str, ref_count: int) -> None:
  if not label:
    return
  item = bucket.setdefault(label, {"records": 0, "references": 0})
  item["records"] += 1
  item["references"] += ref_count


def sorted_bucket(bucket: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
  return [
    {"label": label, **counts}
    for label, counts in sorted(bucket.items(), key=lambda item: (-item[1]["references"], item[0].lower()))
  ]


def merge_count_bucket(bucket: dict[str, dict[str, int]], entries: list[dict[str, Any]]) -> None:
  for entry in entries:
    label = str(entry.get("label") or "")
    if not label:
      continue
    item = bucket.setdefault(label, {"records": 0, "references": 0})
    item["records"] += int(entry.get("records") or 0)
    item["references"] += int(entry.get("references") or 0)


def merge_reference_count_buckets(
  buckets: dict[str, dict[str, dict[str, int]]],
  reference_counts: dict[str, Any],
) -> None:
  merge_count_bucket(buckets["type"], reference_counts.get("byType") or [])
  merge_count_bucket(buckets["area"], reference_counts.get("byArea") or [])
  merge_count_bucket(buckets["domain"], reference_counts.get("byDomain") or [])
  merge_count_bucket(buckets["category"], reference_counts.get("byCategory") or [])


def has_reference_bucket_metadata(entry: dict[str, Any], payload: dict[str, Any]) -> bool:
  return any(key in entry or key in payload for key in ("category", "areaTags", "domainTags"))


def limited_records(index: dict[str, Any], offset: int, limit: Optional[int], record_types: set[str] | None = None) -> list[dict[str, Any]]:
  records = [record for record in index.get("records", []) if isinstance(record, dict)]
  if record_types:
    records = [record for record in records if str(record.get("type") or "") in record_types]
  start = max(0, offset)
  if limit is None:
    return records[start:]
  return records[start:start + max(0, limit)]


def build_manifest(
  index_path: Path,
  out_root: Path,
  index: dict[str, Any],
  records: list[dict[str, Any]],
  refs_by_record: dict[str, list[dict[str, Any]]],
  source: dict[str, Any],
  errors: list[dict[str, str]],
) -> dict[str, Any]:
  out_records = out_root / "records"
  out_records.mkdir(parents=True, exist_ok=True)
  for stale in out_records.glob("*.json"):
    stale.unlink()

  ref_counter: Counter[str] = Counter()
  author_counter: Counter[str] = Counter()
  ref_samples: dict[str, dict[str, Any]] = {}
  record_keys: dict[str, set[str]] = {}
  record_payloads: dict[str, dict[str, Any]] = {}
  manifest_records: dict[str, dict[str, Any]] = {}
  buckets: dict[str, dict[str, dict[str, int]]] = {"type": {}, "area": {}, "domain": {}, "category": {}}
  for record in records:
    record_id = str(record.get("id") or "")
    entries = [entry for entry in refs_by_record.get(record_id, []) if entry.get("key")]
    keys = {str(entry["key"]) for entry in entries}
    if keys:
      record_keys[record_id] = keys
    for entry in entries:
      key = str(entry["key"])
      ref_counter[key] += 1
      ref_samples.setdefault(key, entry)
      for author in entry.get("authors") or []:
        author_counter[author] += 1

    ref_count = len(entries)
    record_payloads[record_id] = {
      "id": record_id,
      "type": record.get("type"),
      "title": record.get("title"),
      "category": record.get("category"),
      "areaTags": record.get("areaTags") or [],
      "domainTags": record.get("domainTags") or [],
      "referenceCount": ref_count,
      "referenceKeys": sorted(keys),
      "references": entries[:MAX_REFERENCE_SAMPLE],
      "overlaps": [],
    }

  overlaps_by_record: dict[str, list[dict[str, Any]]] = defaultdict(list)
  for left_id, right_id in combinations(sorted(record_keys), 2):
    shared = record_keys[left_id] & record_keys[right_id]
    if len(shared) < 2:
      continue
    left_keys = record_keys[left_id]
    right_keys = record_keys[right_id]
    score = len(shared) / max(1, len(left_keys | right_keys))
    shared_refs = sorted(shared, key=lambda key: (-ref_counter[key], key))[:MAX_SHARED_REFS_PER_OVERLAP]
    for source_id, target_id in ((left_id, right_id), (right_id, left_id)):
      target_payload = record_payloads.get(target_id, {})
      overlaps_by_record[source_id].append({
        "recordId": target_id,
        "title": target_payload.get("title", ""),
        "sharedCount": len(shared),
        "score": round(score, 4),
        "references": [
          {
            "key": key,
            "title": ref_samples.get(key, {}).get("title", ""),
            "raw": ref_samples.get(key, {}).get("raw", ""),
          }
          for key in shared_refs
        ],
      })

  for record_id, payload in record_payloads.items():
    overlaps = sorted(
      overlaps_by_record.get(record_id, []),
      key=lambda item: (-int(item["sharedCount"]), -float(item["score"]), str(item["title"])),
    )[:MAX_OVERLAPS_PER_RECORD]
    payload["overlaps"] = overlaps
    if not payload["referenceCount"] and not overlaps:
      continue
    count_bucket(buckets["type"], str(payload.get("type") or ""), int(payload["referenceCount"]))
    count_bucket(buckets["category"], str(payload.get("category") or ""), int(payload["referenceCount"]))
    for area in payload.get("areaTags") or []:
      count_bucket(buckets["area"], str(area), int(payload["referenceCount"]))
    for domain in payload.get("domainTags") or []:
      count_bucket(buckets["domain"], str(domain), int(payload["referenceCount"]))
    filename = record_filename(record_id)
    write_json(out_records / filename, payload)
    manifest_records[record_id] = {
      "url": f"site/data/references/records/{filename}",
      "type": payload.get("type") or "",
      "category": payload.get("category") or "",
      "areaTags": payload.get("areaTags") or [],
      "domainTags": payload.get("domainTags") or [],
      "referenceCount": payload["referenceCount"],
      "overlapCount": len(overlaps),
    }

  generated_at = datetime.now(timezone.utc).isoformat()
  total_refs = sum(payload["referenceCount"] for payload in record_payloads.values())
  top_references = [
    {
      "key": key,
      "count": count,
      "title": ref_samples.get(key, {}).get("title", ""),
      "authors": ref_samples.get(key, {}).get("authors", []),
      "raw": ref_samples.get(key, {}).get("raw", ""),
    }
    for key, count in ref_counter.most_common(TOP_REFERENCES)
  ]
  manifest = {
    "generatedAt": generated_at,
    "source": {
      "indexPath": rel(index_path),
      "indexGeneratedAt": index.get("generatedAt", ""),
      **source,
    },
    "limits": {
      "referencesPerRecord": MAX_REFERENCES_PER_RECORD,
      "referenceSample": MAX_REFERENCE_SAMPLE,
      "referenceTextChars": MAX_REFERENCE_TEXT,
      "overlapsPerRecord": MAX_OVERLAPS_PER_RECORD,
      "sharedRefsPerOverlap": MAX_SHARED_REFS_PER_OVERLAP,
    },
    "summary": {
      "recordCount": len(manifest_records),
      "manifestRecords": len(manifest_records),
      "offset": int(source.get("offset") or 0),
      "limit": source.get("limit"),
      "fallbacks": source.get("fallbacks", ""),
      "matchedRecords": int(source.get("matchedRecords") or 0),
      "unmatchedRecords": int(source.get("unmatchedRecords") or 0),
      "cachedRecords": int(source.get("cachedRecords") or 0),
      "crossrefMatchedRecords": int(source.get("crossrefMatchedRecords") or 0),
      "fallbackRecords": int(source.get("fallbackRecords") or 0),
      "pdfFallbackRecords": int(source.get("pdfFallbackRecords") or 0),
      "remotePdfRecords": int(source.get("remotePdfRecords") or 0),
      "crossrefReferenceRecords": int(source.get("crossrefReferenceRecords") or 0),
      "recordsWithReferences": sum(1 for payload in record_payloads.values() if payload["referenceCount"]),
      "referenceStrings": total_refs,
      "uniqueReferenceKeys": len(ref_counter),
      "recordsWithOverlaps": sum(1 for values in overlaps_by_record.values() if values),
      "extractionErrors": len(errors),
      "errors": len(errors),
    },
    "records": manifest_records,
    "analysis": {
      "topReferences": top_references,
      "topAuthors": [{"author": author, "count": count} for author, count in author_counter.most_common(TOP_AUTHORS)],
      "referenceCounts": {
        "byType": sorted_bucket(buckets["type"]),
        "byArea": sorted_bucket(buckets["area"]),
        "byDomain": sorted_bucket(buckets["domain"]),
        "byCategory": sorted_bucket(buckets["category"]),
      },
    },
    "errors": errors[:50],
  }
  write_json(out_root / "manifest.json", manifest)
  return manifest


def manifest_record_path(chunk_root: Path, entry: dict[str, Any]) -> Path:
  url = str(entry.get("url") or "")
  prefix = "site/data/references/"
  if not url.startswith(prefix):
    raise SystemExit(f"Invalid chunk reference URL: {url}")
  return chunk_root / url.removeprefix(prefix)


def summary_int(summary: dict[str, Any], key: str) -> int:
  return int(summary.get(key) or 0)


def parse_record_types(value: str) -> set[str] | None:
  record_types = {item.strip() for item in value.split(",") if item.strip()}
  return record_types or None


def chunk_manifest_paths(chunk_dir: Path) -> list[Path]:
  paths = sorted(path / "manifest.json" for path in chunk_dir.iterdir() if (path / "manifest.json").is_file())
  if not paths:
    raise SystemExit(f"No chunk manifests found under {chunk_dir}")
  return paths


def merged_limits(manifests: list[dict[str, Any]]) -> dict[str, int]:
  limits = {
    "referencesPerRecord": MAX_REFERENCES_PER_RECORD,
    "referenceSample": MAX_REFERENCE_SAMPLE,
    "referenceTextChars": MAX_REFERENCE_TEXT,
    "overlapsPerRecord": MAX_OVERLAPS_PER_RECORD,
    "sharedRefsPerOverlap": MAX_SHARED_REFS_PER_OVERLAP,
  }
  for manifest in manifests:
    for key in list(limits):
      limits[key] = max(limits[key], int((manifest.get("limits") or {}).get(key) or limits[key]))
  return limits


def merge_chunks(chunk_dir: Path, out_root: Path) -> dict[str, Any]:
  manifest_paths = chunk_manifest_paths(chunk_dir)
  chunk_manifests: list[dict[str, Any]] = []
  manifest_records: dict[str, dict[str, Any]] = {}
  record_payloads: dict[str, dict[str, Any]] = {}
  record_entries: dict[str, dict[str, Any]] = {}
  record_keys: dict[str, set[str]] = {}
  ref_counter: Counter[str] = Counter()
  author_counter: Counter[str] = Counter()
  ref_samples: dict[str, dict[str, Any]] = {}
  type_bucket: dict[str, dict[str, int]] = {}
  merged_buckets: dict[str, dict[str, dict[str, int]]] = {"type": {}, "area": {}, "domain": {}, "category": {}}
  errors: list[dict[str, Any]] = []

  out_records = out_root / "records"
  out_records.mkdir(parents=True, exist_ok=True)
  for stale in out_records.glob("*.json"):
    stale.unlink()

  for manifest_path in manifest_paths:
    chunk_root = manifest_path.parent
    manifest = read_json(manifest_path)
    validate(manifest, chunk_root)
    chunk_manifests.append(manifest)
    errors.extend(manifest.get("errors") or [])
    legacy_bucket_fallback = False
    legacy_accepted_records = 0
    metadata_accepted_records = 0
    legacy_duplicate_records = 0
    for record_id, entry in sorted((manifest.get("records") or {}).items()):
      record_id = str(record_id)
      payload = read_json(manifest_record_path(chunk_root, entry))
      if payload.get("id") != record_id:
        raise SystemExit(f"Reference payload id mismatch for {record_id}")
      existing_payload = record_payloads.get(record_id)
      if existing_payload is not None and existing_payload != payload:
        raise SystemExit(f"Conflicting duplicate chunk payload for {record_id}")

      if existing_payload is not None:
        legacy_duplicate_records += 1
        continue
      record_payloads[record_id] = payload
      record_entries[record_id] = dict(entry)
      references = [ref for ref in (payload.get("references") or []) if ref.get("key")]
      reference_keys = payload.get("referenceKeys") or [ref["key"] for ref in references]
      keys = {str(key) for key in reference_keys if key}
      reference_count = int(payload.get("referenceCount") or entry.get("referenceCount") or len(keys))
      if keys:
        record_keys[record_id] = keys
      for key in keys:
        ref_counter[key] += 1
      count_bucket(type_bucket, str(payload.get("type") or ""), reference_count)
      if has_reference_bucket_metadata(entry, payload):
        metadata_accepted_records += 1
        count_bucket(merged_buckets["type"], str(entry.get("type") or payload.get("type") or ""), reference_count)
        count_bucket(merged_buckets["category"], str(entry.get("category") or payload.get("category") or ""), reference_count)
        for area in entry.get("areaTags") or payload.get("areaTags") or []:
          count_bucket(merged_buckets["area"], str(area), reference_count)
        for domain in entry.get("domainTags") or payload.get("domainTags") or []:
          count_bucket(merged_buckets["domain"], str(domain), reference_count)
      else:
        legacy_bucket_fallback = True
        legacy_accepted_records += 1
      for ref in references:
        key = str(ref["key"])
        ref_samples.setdefault(key, ref)
        for author in ref.get("authors") or []:
          author_counter[str(author)] += 1
    if legacy_bucket_fallback:
      if metadata_accepted_records:
        raise SystemExit(
          f"Cannot accurately merge mixed legacy/current chunk buckets in {display_path(chunk_root)}; rebuild chunks with the current script."
        )
      if legacy_duplicate_records:
        raise SystemExit(
          f"Cannot accurately merge legacy chunk buckets with duplicate records in {display_path(chunk_root)}; rebuild chunks with the current script."
        )
      if legacy_accepted_records:
        merge_reference_count_buckets(merged_buckets, (manifest.get("analysis") or {}).get("referenceCounts") or {})

  overlaps_by_record: dict[str, list[dict[str, Any]]] = defaultdict(list)
  for left_id, right_id in combinations(sorted(record_keys), 2):
    shared = record_keys[left_id] & record_keys[right_id]
    if len(shared) < 2:
      continue
    left_keys = record_keys[left_id]
    right_keys = record_keys[right_id]
    score = len(shared) / max(1, len(left_keys | right_keys))
    shared_refs = sorted(shared, key=lambda key: (-ref_counter[key], key))[:MAX_SHARED_REFS_PER_OVERLAP]
    for source_id, target_id in ((left_id, right_id), (right_id, left_id)):
      target_payload = record_payloads.get(target_id, {})
      overlaps_by_record[source_id].append({
        "recordId": target_id,
        "title": target_payload.get("title", ""),
        "sharedCount": len(shared),
        "score": round(score, 4),
        "references": [
          {
            "key": key,
            "title": ref_samples.get(key, {}).get("title", ""),
            "raw": ref_samples.get(key, {}).get("raw", ""),
          }
          for key in shared_refs
        ],
      })

  for record_id, payload in record_payloads.items():
    overlaps = sorted(
      overlaps_by_record.get(record_id, []),
      key=lambda item: (-int(item["sharedCount"]), -float(item["score"]), str(item["title"])),
    )[:MAX_OVERLAPS_PER_RECORD]
    payload = {**payload, "overlaps": overlaps}
    filename = record_filename(record_id)
    write_json(out_records / filename, payload)
    merged_entry = record_entries.get(record_id, {})
    merged_entry["url"] = f"site/data/references/records/{filename}"
    merged_entry["referenceCount"] = int(payload.get("referenceCount") or 0)
    merged_entry["overlapCount"] = len(overlaps)
    manifest_records[record_id] = merged_entry

  summaries = [manifest.get("summary") or {} for manifest in chunk_manifests]
  reference_strings = sum(int(payload.get("referenceCount") or 0) for payload in record_payloads.values())
  top_references = [
    {
      "key": key,
      "count": count,
      "title": ref_samples.get(key, {}).get("title", ""),
      "authors": ref_samples.get(key, {}).get("authors", []),
      "raw": ref_samples.get(key, {}).get("raw", ""),
    }
    for key, count in ref_counter.most_common(TOP_REFERENCES)
  ]
  manifest = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "source": {
      "kind": "openalex-chunked",
      "description": "Merged OpenAlex reference chunks",
      "chunkCount": len(chunk_manifests),
      "chunkDir": display_path(chunk_dir),
    },
    "limits": merged_limits(chunk_manifests),
    "summary": {
      "recordCount": len(manifest_records),
      "manifestRecords": len(manifest_records),
      "offset": 0,
      "limit": None,
      "fallbacks": ",".join(sorted({str(summary.get("fallbacks") or "") for summary in summaries if summary.get("fallbacks")})),
      "matchedRecords": sum(summary_int(summary, "matchedRecords") for summary in summaries),
      "unmatchedRecords": sum(summary_int(summary, "unmatchedRecords") for summary in summaries),
      "cachedRecords": sum(summary_int(summary, "cachedRecords") for summary in summaries),
      "crossrefMatchedRecords": sum(summary_int(summary, "crossrefMatchedRecords") for summary in summaries),
      "fallbackRecords": sum(summary_int(summary, "fallbackRecords") for summary in summaries),
      "pdfFallbackRecords": sum(summary_int(summary, "pdfFallbackRecords") for summary in summaries),
      "remotePdfRecords": sum(summary_int(summary, "remotePdfRecords") for summary in summaries),
      "crossrefReferenceRecords": sum(summary_int(summary, "crossrefReferenceRecords") for summary in summaries),
      "recordsWithReferences": sum(1 for payload in record_payloads.values() if int(payload.get("referenceCount") or 0)),
      "referenceStrings": reference_strings,
      "uniqueReferenceKeys": len(ref_counter),
      "recordsWithOverlaps": sum(1 for values in overlaps_by_record.values() if values),
      "extractionErrors": sum(summary_int(summary, "extractionErrors") for summary in summaries),
      "errors": sum(summary_int(summary, "errors") for summary in summaries),
    },
    "records": manifest_records,
    "analysis": {
      "topReferences": top_references,
      "topAuthors": [{"author": author, "count": count} for author, count in author_counter.most_common(TOP_AUTHORS)],
      "referenceCounts": {
        "byType": sorted_bucket(merged_buckets["type"] or type_bucket),
        "byArea": sorted_bucket(merged_buckets["area"]),
        "byDomain": sorted_bucket(merged_buckets["domain"]),
        "byCategory": sorted_bucket(merged_buckets["category"]),
      },
    },
    "errors": errors[:50],
  }
  write_json(out_root / "manifest.json", manifest)
  return manifest


def build_pdf(index_path: Path, out_root: Path, extractor: str, timeout: int, offset: int, limit: Optional[int], record_types: set[str] | None) -> dict[str, Any]:
  index = read_json(index_path)
  extractor_path = shutil.which(extractor) if "/" not in extractor else extractor
  if not extractor_path:
    raise SystemExit("pdftotext not found; install poppler or pass --pdftotext")

  records = [record for record in limited_records(index, offset, limit, record_types) if record.get("localPdfPath")]
  errors: list[dict[str, str]] = []
  refs_by_record: dict[str, list[dict[str, Any]]] = {}
  for record in records:
    record_id = str(record.get("id") or "")
    pdf_path = ROOT / str(record.get("localPdfPath"))
    if not pdf_path.exists():
      errors.append({"id": record_id, "path": str(record.get("localPdfPath")), "error": "missing_pdf"})
      continue
    try:
      refs_by_record[record_id] = reference_entries_from_pdf_path(pdf_path, str(extractor_path), timeout)
    except (RuntimeError, subprocess.SubprocessError, TimeoutError) as exc:
      errors.append({"id": record_id, "path": rel(pdf_path), "error": compact_text(exc)})
      refs_by_record[record_id] = []

  source = {
    "kind": "pdf",
    "description": "PDF reference extraction fallback via pdftotext",
    "offset": offset,
    "limit": limit,
    "fallbacks": "none",
    "pdftotext": str(extractor_path),
    "pdfRecords": len(records),
    "matchedRecords": sum(1 for refs in refs_by_record.values() if refs),
    "unmatchedRecords": sum(1 for refs in refs_by_record.values() if not refs),
    "cachedRecords": 0,
  }
  return build_manifest(index_path, out_root, index, records, refs_by_record, source, errors)


def build_openalex(
  index_path: Path,
  out_root: Path,
  cache_path: Path,
  mailto: str,
  timeout: int,
  sleep: float,
  offset: int,
  limit: Optional[int],
  fallbacks: str,
  record_types: set[str] | None,
  pdf_fallback: bool,
  extractor: str,
) -> dict[str, Any]:
  index = read_json(index_path)
  extractor_path = shutil.which(extractor) if "/" not in extractor else extractor
  if pdf_fallback and not extractor_path:
    raise SystemExit("pdftotext not found; install poppler or pass --pdftotext")
  records = limited_records(index, offset, limit, record_types)
  cache = load_openalex_cache(cache_path)
  errors: list[dict[str, str]] = []
  refs_by_record: dict[str, list[dict[str, Any]]] = {}
  cached_records = 0
  matched_records = 0
  crossref_matched_records = 0
  fallback_records = 0
  pdf_fallback_records = 0
  remote_pdf_records = 0
  crossref_reference_records = 0
  title_entries: dict[str, dict[str, Any]] = {}
  total_records = len(records)

  print(
    f"Collecting references: offset={offset} limit={limit or 'all'} records={total_records} "
    f"fallbacks={fallbacks} pdfFallback={pdf_fallback}",
    flush=True,
  )

  def print_progress(processed: int) -> None:
    if processed == 1 or processed % 25 == 0 or processed == total_records:
      print(
        f"Reference progress {processed}/{total_records}: "
        f"matched={matched_records} cached={cached_records} "
        f"fallback={fallback_records} pdfFallback={pdf_fallback_records} "
        f"remotePdf={remote_pdf_records} errors={len(errors)}",
        flush=True,
      )

  def collect_pdf_fallback_entries(record: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    pdf_path = ROOT / str(record.get("localPdfPath") or "")
    if record.get("localPdfPath") and pdf_path.exists():
      return reference_entries_from_pdf_path(pdf_path, str(extractor_path), timeout), False
    entries = reference_entries_from_remote_pdf(record, str(extractor_path), timeout, sleep)
    return entries, bool(entries)

  for processed, record in enumerate(records, start=1):
    record_id = str(record.get("id") or "")
    title = str(record.get("title") or "")
    title_key = normalize_title(title)
    if not title_key:
      refs_by_record[record_id] = []
      print_progress(processed)
      continue
    if title_key in title_entries:
      cached = title_entries[title_key]
      refs_by_record[record_id] = cached["entries"]
      cached_records += 1
      if cached["matched"]:
        matched_records += 1
      if cached.get("crossrefMatched"):
        crossref_matched_records += 1
      if cached.get("fallback"):
        fallback_records += 1
        crossref_reference_records += len(cached["entries"])
      print_progress(processed)
      continue
    pdf_attempted = False
    if pdf_fallback and record_pdf_url(record):
      pdf_attempted = True
      try:
        entries, was_remote_pdf = collect_pdf_fallback_entries(record)
        if entries:
          if was_remote_pdf:
            remote_pdf_records += 1
          fallback_records += 1
          pdf_fallback_records += 1
          title_entries[title_key] = {
            "entries": entries,
            "matched": False,
            "crossrefMatched": False,
            "fallback": True,
          }
          refs_by_record[record_id] = entries
          print_progress(processed)
          continue
      except (urllib.error.URLError, RuntimeError, subprocess.SubprocessError, TimeoutError) as exc:
        errors.append({"id": record_id, "title": title[:140], "source": "pdf_first", "error": compact_text(exc)})
    try:
      lookup, was_cached = cached_openalex_lookup(title, cache, mailto, timeout, sleep)
      if was_cached:
        cached_records += 1
      matched = bool(lookup.get("matched") and lookup.get("work"))
      if lookup.get("matched") and lookup.get("work"):
        matched_records += 1
        entries = openalex_reference_entries(lookup["work"], cache, mailto, timeout, sleep)
      else:
        entries = []
      crossref_matched = False
      fallback = False
      if matched and not entries and fallbacks == "crossref":
        try:
          crossref_lookup, _ = cached_crossref_lookup(title, cache, mailto, timeout, sleep)
          crossref_matched = bool(crossref_lookup.get("matched") and crossref_lookup.get("work"))
          if crossref_matched:
            crossref_matched_records += 1
            entries = crossref_reference_entries(crossref_lookup["work"])
            if entries:
              fallback = True
              fallback_records += 1
              crossref_reference_records += len(entries)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
          errors.append({"id": record_id, "title": title[:140], "source": "crossref", "error": compact_text(exc)})
      if pdf_fallback and not entries and not pdf_attempted:
        try:
          entries, was_remote_pdf = collect_pdf_fallback_entries(record)
          if was_remote_pdf:
            remote_pdf_records += 1
          if entries:
            fallback = True
            fallback_records += 1
            pdf_fallback_records += 1
        except (urllib.error.URLError, RuntimeError, subprocess.SubprocessError, TimeoutError) as exc:
          errors.append({"id": record_id, "title": title[:140], "source": "pdf_fallback", "error": compact_text(exc)})
      title_entries[title_key] = {
        "entries": entries,
        "matched": matched,
        "crossrefMatched": crossref_matched,
        "fallback": fallback,
      }
      refs_by_record[record_id] = entries
      write_json(cache_path, cache)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
      entries = []
      if pdf_fallback and not pdf_attempted:
        try:
          entries, was_remote_pdf = collect_pdf_fallback_entries(record)
          if was_remote_pdf:
            remote_pdf_records += 1
          if entries:
            fallback_records += 1
            pdf_fallback_records += 1
        except (urllib.error.URLError, RuntimeError, subprocess.SubprocessError, TimeoutError) as pdf_exc:
          errors.append({"id": record_id, "title": title[:140], "source": "pdf_fallback_after_lookup_error", "error": compact_text(pdf_exc)})
      errors.append({"id": record_id, "title": title[:140], "source": "openalex", "error": compact_text(exc)})
      title_entries[title_key] = {"entries": entries, "matched": False, "fallback": bool(entries)}
      refs_by_record[record_id] = entries
      write_json(cache_path, cache)
    print_progress(processed)

  source = {
    "kind": "openalex",
    "description": "Online OpenAlex bibliographic lookup by conservative title match",
    "api": OPENALEX_API,
    "crossrefApi": CROSSREF_API,
    "offset": offset,
    "limit": limit,
    "fallbacks": fallbacks,
    "openAlexApiKey": bool(os.environ.get("OPENALEX_API_KEY")),
    "cachePath": display_path(cache_path),
    "matchedRecords": matched_records,
    "unmatchedRecords": len(records) - matched_records,
    "cachedRecords": cached_records,
    "crossrefMatchedRecords": crossref_matched_records,
    "fallbackRecords": fallback_records,
    "pdfFallbackRecords": pdf_fallback_records,
    "remotePdfRecords": remote_pdf_records,
    "crossrefReferenceRecords": crossref_reference_records,
  }
  return build_manifest(index_path, out_root, index, records, refs_by_record, source, errors)


def build(
  index_path: Path,
  out_root: Path,
  source: str,
  extractor: str,
  cache_path: Path,
  mailto: str,
  timeout: int,
  sleep: float,
  offset: int,
  limit: Optional[int],
  fallbacks: str,
  record_types: set[str] | None,
  pdf_fallback: bool,
) -> dict[str, Any]:
  if source == "openalex":
    return build_openalex(index_path, out_root, cache_path, mailto, timeout, sleep, offset, limit, fallbacks, record_types, pdf_fallback, extractor)
  if source == "pdf":
    return build_pdf(index_path, out_root, extractor, timeout, offset, limit, record_types)
  raise SystemExit(f"Unsupported source: {source}")


def validate(manifest: dict[str, Any], root: Path) -> None:
  if not isinstance(manifest.get("records"), dict):
    raise SystemExit("Invalid references manifest: records must be an object")
  limits = manifest.get("limits") or {}
  max_sample = int(limits.get("referenceSample") or MAX_REFERENCE_SAMPLE)
  max_overlaps = int(limits.get("overlapsPerRecord") or MAX_OVERLAPS_PER_RECORD)
  max_chars = int(limits.get("referenceTextChars") or MAX_REFERENCE_TEXT)
  for record_id, entry in manifest["records"].items():
    url = str(entry.get("url") or "")
    if not url.startswith("site/data/references/records/"):
      raise SystemExit(f"Invalid reference URL for {record_id}")
    payload_path = root / url.removeprefix("site/data/references/")
    payload = read_json(payload_path)
    if payload.get("id") != record_id:
      raise SystemExit(f"Reference payload id mismatch for {record_id}")
    refs = payload.get("references") or []
    overlaps = payload.get("overlaps") or []
    if len(refs) > max_sample:
      raise SystemExit(f"Reference sample exceeds bound for {record_id}")
    if len(overlaps) > max_overlaps:
      raise SystemExit(f"Overlap list exceeds bound for {record_id}")
    for ref in refs:
      if len(str(ref.get("raw") or "")) > max_chars:
        raise SystemExit(f"Reference text exceeds bound for {record_id}")


def self_check() -> None:
  assert [record["id"] for record in limited_records({"records": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}, 1, 1)] == ["b"]
  assert [record["id"] for record in limited_records({"records": [{"id": "a", "type": "paper"}, {"id": "b", "type": "poster"}]}, 0, None, {"paper"})] == ["a"]
  assert parse_record_types("paper,workshop") == {"paper", "workshop"}
  assert openreview_id_from_record({"id": "openreview:abc123;icml:1"}) == "abc123"
  assert record_pdf_url({"id": "openreview:abc123;icml:1"}) == "https://openreview.net/pdf?id=abc123"
  old_api_key = os.environ.get("OPENALEX_API_KEY")
  try:
    os.environ.pop("OPENALEX_API_KEY", None)
    params = openalex_params({"filter": "title.search:test"}, "test@example.com")
    assert params == {"filter": "title.search:test", "mailto": "test@example.com"}
    os.environ["OPENALEX_API_KEY"] = "__self_check_openalex_key__"
    keyed_params = openalex_params({"filter": "title.search:test"}, "")
    assert keyed_params == {"filter": "title.search:test", "api_key": "__self_check_openalex_key__"}
  finally:
    if old_api_key is None:
      os.environ.pop("OPENALEX_API_KEY", None)
    else:
      os.environ["OPENALEX_API_KEY"] = old_api_key

  retry_error = urllib.error.HTTPError("https://example.test", 429, "rate limited", {"Retry-After": "2"}, None)
  assert retry_after_seconds(retry_error, 1.0) == 2.0
  assert titles_match(r"$\alpha$-PFN: Fast Entropy Search via In-Context Learning", "alpha-PFN: Fast Entropy Search via In-Context Learning")
  assert not titles_match("Fast Entropy Search via In-Context Learning", "A Tutorial on the Cross-Entropy Method")
  assert is_checked_in_reference_root(OUT_ROOT)
  assert not is_checked_in_reference_root(Path(tempfile.gettempdir()) / "icml_refs_smoke")
  entry = openalex_reference_entry({
    "id": "https://openalex.org/W123",
    "display_name": "A Small Test Work",
    "publication_year": 2024,
    "authorships": [{"author": {"display_name": "Ada Lovelace"}}],
    "primary_location": {"source": {"display_name": "Test Venue"}},
  })
  assert entry["key"] == "a small test work"
  assert entry["openAlexId"] == "W123"
  assert entry["authors"] == ["Ada Lovelace"]
  crossref_entries = crossref_reference_entries({
    "reference": [
      {
        "DOI": "10.5555/example",
        "article-title": "A Crossref Test Work",
        "author": "Lovelace, Ada and Hopper, Grace",
        "year": "2025",
        "unstructured": "Lovelace, Ada and Hopper, Grace. A Crossref Test Work. 2025. doi:10.5555/example",
      }
    ],
  })
  assert crossref_entries[0]["key"] == "10 5555 example"
  assert crossref_entries[0]["source"] == "Crossref"
  assert crossref_entries[0]["doi"] == "10.5555/example"
  assert crossref_entries[0]["authors"] == ["Lovelace, Ada", "Hopper, Grace"]

  with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    manifest = build_manifest(
      INDEX_PATH,
      root / "single",
      {"generatedAt": "test", "records": []},
      [
        {"id": "with-refs", "type": "paper", "title": "With References", "category": "LLMs", "areaTags": ["LLMs"], "domainTags": ["General"]},
        {"id": "empty", "type": "paper", "title": "Empty References", "category": "Vision", "areaTags": ["Vision"], "domainTags": ["Biology"]},
      ],
      {"with-refs": [{"key": "one-ref", "raw": "One Ref", "title": "One Ref", "authors": []}]},
      {"kind": "self-check"},
      [],
    )
    assert manifest["summary"]["recordCount"] == 1
    assert manifest["summary"]["manifestRecords"] == 1
    assert set(manifest["records"]) == {"with-refs"}
    assert manifest["analysis"]["referenceCounts"]["byArea"] == [{"label": "LLMs", "records": 1, "references": 1}]
    assert manifest["analysis"]["referenceCounts"]["byDomain"] == [{"label": "General", "records": 1, "references": 1}]

    chunk_dir = root / "chunks"
    for chunk_index, (record_index, record_id) in enumerate(((0, "paper-a"), (1, "paper-b"), (0, "paper-a"))):
      chunk_root = chunk_dir / f"chunk-{chunk_index}"
      filename = record_filename(record_id)
      references = [
        {"key": "shared-ref-0", "raw": "Shared Reference 0", "title": "Shared Reference 0", "authors": ["Ada Lovelace"]},
        {"key": "shared-ref-1", "raw": "Shared Reference 1", "title": "Shared Reference 1", "authors": ["Grace Hopper"]},
      ]
      reference_keys = [ref["key"] for ref in references]
      payload = {
        "id": record_id,
        "type": "paper",
        "title": f"Paper {record_index}",
        "referenceCount": len(reference_keys),
        "referenceKeys": reference_keys,
        "references": references[:1],
        "overlaps": [],
      }
      write_json(chunk_root / "records" / filename, payload)
      write_json(chunk_root / "manifest.json", {
        "limits": {
          "referencesPerRecord": MAX_REFERENCES_PER_RECORD,
          "referenceSample": MAX_REFERENCE_SAMPLE,
          "referenceTextChars": MAX_REFERENCE_TEXT,
          "overlapsPerRecord": MAX_OVERLAPS_PER_RECORD,
          "sharedRefsPerOverlap": MAX_SHARED_REFS_PER_OVERLAP,
        },
        "summary": {
          "recordCount": 1,
          "manifestRecords": 1,
          "matchedRecords": 1,
          "unmatchedRecords": 0,
          "cachedRecords": record_index,
        },
        "records": {
          record_id: {
            "url": f"site/data/references/records/{filename}",
            "type": "paper",
            "category": "LLMs",
            "areaTags": [f"Area {record_index}"],
            "domainTags": ["General"],
            "referenceCount": len(reference_keys),
            "overlapCount": 0,
          },
        },
        "analysis": {
          "referenceCounts": {
            "byType": [{"label": "paper", "records": 1, "references": 2}],
            "byArea": [{"label": f"Area {record_index}", "records": 1, "references": 2}],
            "byDomain": [{"label": "General", "records": 1, "references": 2}],
            "byCategory": [{"label": "LLMs", "records": 1, "references": 2}],
          },
        },
        "errors": [],
      })
    merged = merge_chunks(chunk_dir, root / "merged")
    validate(merged, root / "merged")
    assert merged["source"]["kind"] == "openalex-chunked"
    assert merged["source"]["chunkCount"] == 3
    assert merged["summary"]["recordCount"] == 2
    assert merged["summary"]["manifestRecords"] == 2
    assert merged["summary"]["cachedRecords"] == 1
    assert merged["summary"]["uniqueReferenceKeys"] == 2
    assert merged["summary"]["recordsWithOverlaps"] == 2
    assert [item["label"] for item in merged["analysis"]["referenceCounts"]["byArea"]] == ["Area 0", "Area 1"]
    assert merged["analysis"]["referenceCounts"]["byDomain"] == [{"label": "General", "records": 2, "references": 4}]
    assert merged["analysis"]["referenceCounts"]["byCategory"] == [{"label": "LLMs", "records": 2, "references": 4}]
    assert merged["records"]["paper-a"]["overlapCount"] == 1
    paper_a = read_json(root / "merged" / "records" / record_filename("paper-a"))
    assert len(paper_a["references"]) == 1
    assert paper_a["referenceKeys"] == reference_keys
    assert paper_a["overlaps"][0]["recordId"] == "paper-b"
    assert paper_a["overlaps"][0]["sharedCount"] == 2

    legacy_chunk_dir = root / "legacy-chunks"
    legacy_root = legacy_chunk_dir / "chunk-0"
    legacy_id = "legacy-paper"
    legacy_filename = record_filename(legacy_id)
    legacy_refs = [{"key": "legacy-ref", "raw": "Legacy Reference", "title": "Legacy Reference", "authors": []}]
    write_json(legacy_root / "records" / legacy_filename, {
      "id": legacy_id,
      "type": "paper",
      "title": "Legacy Paper",
      "referenceCount": 1,
      "referenceKeys": ["legacy-ref"],
      "references": legacy_refs,
      "overlaps": [],
    })
    write_json(legacy_root / "manifest.json", {
      "limits": {
        "referencesPerRecord": MAX_REFERENCES_PER_RECORD,
        "referenceSample": MAX_REFERENCE_SAMPLE,
        "referenceTextChars": MAX_REFERENCE_TEXT,
        "overlapsPerRecord": MAX_OVERLAPS_PER_RECORD,
        "sharedRefsPerOverlap": MAX_SHARED_REFS_PER_OVERLAP,
      },
      "summary": {
        "recordCount": 1,
        "manifestRecords": 1,
        "matchedRecords": 1,
        "unmatchedRecords": 0,
        "cachedRecords": 0,
      },
      "records": {
        legacy_id: {
          "url": f"site/data/references/records/{legacy_filename}",
          "type": "paper",
          "referenceCount": 1,
          "overlapCount": 0,
        },
      },
      "analysis": {
        "referenceCounts": {
          "byType": [{"label": "paper", "records": 1, "references": 1}],
          "byArea": [{"label": "Legacy Area", "records": 1, "references": 1}],
          "byDomain": [{"label": "Legacy Domain", "records": 1, "references": 1}],
          "byCategory": [{"label": "Legacy Category", "records": 1, "references": 1}],
        },
      },
      "errors": [],
    })
    legacy_merged = merge_chunks(legacy_chunk_dir, root / "legacy-merged")
    validate(legacy_merged, root / "legacy-merged")
    assert legacy_merged["analysis"]["referenceCounts"]["byArea"] == [{"label": "Legacy Area", "records": 1, "references": 1}]
    assert legacy_merged["analysis"]["referenceCounts"]["byDomain"] == [{"label": "Legacy Domain", "records": 1, "references": 1}]
    assert legacy_merged["analysis"]["referenceCounts"]["byCategory"] == [{"label": "Legacy Category", "records": 1, "references": 1}]


def main() -> None:
  parser = argparse.ArgumentParser(description="Build lazy-loaded ICML reference overlap data.")
  parser.add_argument("--index", type=Path, default=INDEX_PATH)
  parser.add_argument("--out-root", type=Path, default=None)
  parser.add_argument("--source", choices=["openalex", "pdf"], default="openalex")
  parser.add_argument("--offset", type=int, default=0)
  parser.add_argument("--limit", type=int, default=None)
  parser.add_argument("--record-types", default="", help="Comma-separated record types to include before offset/limit slicing.")
  parser.add_argument("--pdf-fallback", action="store_true", help="For online lookup, extract references from local/OpenReview PDFs when bibliography APIs do not expose references.")
  parser.add_argument("--fallbacks", choices=["crossref", "none"], default="crossref")
  parser.add_argument("--cache-path", type=Path, default=DEFAULT_CACHE_PATH)
  parser.add_argument("--mailto", default="")
  parser.add_argument("--pdftotext", default="pdftotext")
  parser.add_argument("--timeout", type=int, default=30)
  parser.add_argument("--sleep", type=float, default=0.1)
  parser.add_argument("--merge-chunks", type=Path, help="Merge chunk subdirectories containing manifest.json and records/*.json.")
  parser.add_argument("--publish", action="store_true", help="Allow writing the checked-in docs/site/data/references artifact.")
  parser.add_argument("--self-check", action="store_true")
  parser.add_argument("--validate", nargs="?", const=str(MANIFEST_PATH), help="Validate an existing manifest and exit.")
  args = parser.parse_args()

  if args.self_check:
    self_check()
    print("self-check ok")
    return

  if args.validate:
    manifest = read_json(Path(args.validate))
    validate(manifest, Path(args.validate).parent)
    print(json.dumps(manifest.get("summary", {}), indent=2, ensure_ascii=False))
    return

  if args.merge_chunks:
    if args.out_root is None:
      raise SystemExit("--merge-chunks requires explicit --out-root")
    if is_checked_in_reference_root(args.out_root) and not args.publish:
      raise SystemExit("--publish is required to write docs/site/data/references")
    manifest = merge_chunks(args.merge_chunks, args.out_root)
    validate(manifest, args.out_root)
    print(f"Wrote {display_path(args.out_root / 'manifest.json')}")
    print(json.dumps(manifest["summary"], indent=2, ensure_ascii=False))
    return

  out_root = args.out_root or OUT_ROOT
  if (args.offset != 0 or args.limit is not None) and is_checked_in_reference_root(out_root):
    out_root = DEFAULT_SMOKE_OUT_ROOT
    print(f"Bounded run writes {display_path(out_root)} to preserve {rel(OUT_ROOT)}")
  elif args.source == "openalex" and is_checked_in_reference_root(out_root) and not args.publish:
    out_root = DEFAULT_SMOKE_OUT_ROOT
    print(f"Online run writes {display_path(out_root)}; pass --publish to replace {rel(OUT_ROOT)}")

  manifest = build(
    args.index,
    out_root,
    args.source,
    args.pdftotext,
    args.cache_path,
    args.mailto,
    args.timeout,
    args.sleep,
    args.offset,
    args.limit,
    args.fallbacks,
    parse_record_types(args.record_types),
    args.pdf_fallback,
  )
  validate(manifest, out_root)
  print(f"Wrote {display_path(out_root / 'manifest.json')}")
  print(json.dumps(manifest["summary"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
  main()
