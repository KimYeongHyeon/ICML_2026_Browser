#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "docs/site/data/icml2026_index.json"
OUT_ROOT = ROOT / "docs/site/data/references"
MANIFEST_PATH = OUT_ROOT / "manifest.json"
RECORDS_ROOT = OUT_ROOT / "records"

MAX_REFERENCES_PER_RECORD = 64
MAX_REFERENCE_TEXT = 220
MAX_REFERENCE_SAMPLE = 12
MAX_OVERLAPS_PER_RECORD = 16
MAX_SHARED_REFS_PER_OVERLAP = 5
TOP_REFERENCES = 80
TOP_AUTHORS = 80

REFERENCE_HEADING_RE = re.compile(r"^\s*(?:\d+\s+)?(references|bibliography|works cited)\b", re.I)
STOP_HEADING_RE = re.compile(r"^\s*(?:\d+\s+)?(appendix|supplementary material|checklist|acknowledg(e)?ments?)\b", re.I)
NUMBERED_REF_RE = re.compile(r"^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s+")
AUTHOR_START_RE = re.compile(r"^[A-Z][A-Za-z'`-]+,\s+(?:[A-Z]\.|[A-Z][a-z])")
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b")
URL_RE = re.compile(r"https?://\S+|doi:\S+", re.I)


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


def rel(path: Path) -> str:
  return path.relative_to(ROOT).as_posix()


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
  key_source = title or ref
  return {
    "key": normalize_key(key_source),
    "raw": ref,
    "title": title,
    "authors": parse_authors(ref),
  }


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


def build(index_path: Path, out_root: Path, extractor: str, timeout: int) -> dict[str, Any]:
  index = read_json(index_path)
  records = index.get("records", [])
  extractor_path = shutil.which(extractor) if "/" not in extractor else extractor
  if not extractor_path:
    raise SystemExit("pdftotext not found; install poppler or pass --pdftotext")

  out_records = out_root / "records"
  out_records.mkdir(parents=True, exist_ok=True)
  for stale in out_records.glob("*.json"):
    stale.unlink()

  errors: list[dict[str, str]] = []
  ref_counter: Counter[str] = Counter()
  author_counter: Counter[str] = Counter()
  ref_samples: dict[str, dict[str, Any]] = {}
  record_keys: dict[str, set[str]] = {}
  record_payloads: dict[str, dict[str, Any]] = {}
  manifest_records: dict[str, dict[str, Any]] = {}
  buckets: dict[str, dict[str, dict[str, int]]] = {"type": {}, "area": {}, "domain": {}, "category": {}}

  pdf_records = [record for record in records if record.get("localPdfPath")]
  for record in pdf_records:
    record_id = str(record.get("id") or "")
    pdf_path = ROOT / str(record.get("localPdfPath"))
    if not pdf_path.exists():
      errors.append({"id": record_id, "path": str(record.get("localPdfPath")), "error": "missing_pdf"})
      continue

    try:
      refs = split_references(reference_section(extract_pdf_text(pdf_path, str(extractor_path), timeout)))
    except Exception as exc:
      errors.append({"id": record_id, "path": rel(pdf_path), "error": compact_text(exc)})
      refs = []

    entries = [entry for entry in (reference_entry(ref) for ref in refs) if entry["key"]]
    keys = {str(entry["key"]) for entry in entries}
    record_keys[record_id] = keys
    for entry in entries:
      key = str(entry["key"])
      ref_counter[key] += 1
      ref_samples.setdefault(key, entry)
      for author in entry.get("authors") or []:
        author_counter[author] += 1

    ref_count = len(entries)
    count_bucket(buckets["type"], str(record.get("type") or ""), ref_count)
    count_bucket(buckets["category"], str(record.get("category") or ""), ref_count)
    for area in record.get("areaTags") or []:
      count_bucket(buckets["area"], str(area), ref_count)
    for domain in record.get("domainTags") or []:
      count_bucket(buckets["domain"], str(domain), ref_count)

    record_payloads[record_id] = {
      "id": record_id,
      "type": record.get("type"),
      "title": record.get("title"),
      "referenceCount": ref_count,
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
    filename = record_filename(record_id)
    write_json(out_records / filename, payload)
    manifest_records[record_id] = {
      "url": f"site/data/references/records/{filename}",
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
      "pdftotext": str(extractor_path),
      "pdfRecords": len(pdf_records),
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
      "pdfRecords": len(pdf_records),
      "recordsWithReferences": sum(1 for payload in record_payloads.values() if payload["referenceCount"]),
      "referenceStrings": total_refs,
      "uniqueReferenceKeys": len(ref_counter),
      "recordsWithOverlaps": sum(1 for values in overlaps_by_record.values() if values),
      "extractionErrors": len(errors),
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


def main() -> None:
  parser = argparse.ArgumentParser(description="Build lazy-loaded ICML reference overlap data.")
  parser.add_argument("--index", type=Path, default=INDEX_PATH)
  parser.add_argument("--out-root", type=Path, default=OUT_ROOT)
  parser.add_argument("--pdftotext", default="pdftotext")
  parser.add_argument("--timeout", type=int, default=30)
  parser.add_argument("--validate", nargs="?", const=str(MANIFEST_PATH), help="Validate an existing manifest and exit.")
  args = parser.parse_args()

  if args.validate:
    manifest = read_json(Path(args.validate))
    validate(manifest, Path(args.validate).parent)
    print(json.dumps(manifest.get("summary", {}), indent=2, ensure_ascii=False))
    return

  manifest = build(args.index, args.out_root, args.pdftotext, args.timeout)
  validate(manifest, args.out_root)
  print(f"Wrote {rel(args.out_root / 'manifest.json')}")
  print(json.dumps(manifest["summary"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
  main()
