#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = ROOT / "docs/site/data/references"

MAX_COMMUNITIES = 12
MAX_BRIDGES = 24
MAX_FOUNDATIONS = 24
MAX_REPRESENTATIVES = 8
MAX_SHARED_REFS = 6


def read_json(path: Path) -> dict[str, Any]:
  with path.open(encoding="utf-8") as handle:
    return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
    handle.write("\n")


def compact(value: str) -> str:
  return re.sub(r"\s+", " ", str(value or "")).strip()


def display_text(item: dict[str, Any]) -> str:
  return compact(item.get("title") or item.get("raw") or item.get("key") or "")


def looks_like_citation_title(value: str, has_title: bool = False) -> bool:
  text = compact(value)
  if not text:
    return False
  if re.match(r"^(url\s+https?:|https?:|arxiv preprint|openreview\.net|association for computational linguistics)$", text, re.I):
    return False
  if re.match(r"^(and|[a-z]\.)\s+", text, re.I):
    return False
  if re.match(r"^[A-Za-z]{1,3},\s*[A-Z]\.", text):
    return False
  if re.search(r"[a-z]{3,}[A-Z]\.,", text):
    return False
  if re.match(r"^(?:[A-Z][\w'’.-]+,\s*(?:[A-Z]\.|[A-Z][a-z]+|et al\.?)\s*){2,}$", text):
    return False
  if re.match(r"^[A-Z]\.,?\s+", text) or re.match(r"^[A-Z][\w'’.-]+,\s+[A-Z]\.?[, ]", text):
    return False
  words = [word for word in re.split(r"\s+", text) if word]
  if len(words) < 3 and not has_title:
    return False
  if len(text) < 18 and not has_title:
    return False
  return bool(re.search(r"[a-z]{3,}", text, re.I))


def clean_reference(item: dict[str, Any]) -> str:
  text = display_text(item)
  has_title = bool(compact(item.get("title") or ""))
  return text if looks_like_citation_title(text, has_title) else ""


def record_path(root: Path, entry: dict[str, Any]) -> Path:
  url = str(entry.get("url") or "")
  prefix = "site/data/references/"
  if not url.startswith(prefix):
    raise SystemExit(f"Invalid reference record url: {url}")
  return root / url.removeprefix(prefix)


def union_tags(records: dict[str, dict[str, Any]], ids: list[str], key: str) -> list[str]:
  counter: Counter[str] = Counter()
  for record_id in ids:
    for value in records.get(record_id, {}).get(key) or []:
      counter[str(value)] += 1
  return [value for value, _ in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:4]]


def build(root: Path = DEFAULT_ROOT) -> dict[str, Any]:
  manifest_path = root / "manifest.json"
  manifest = read_json(manifest_path)
  manifest_records: dict[str, dict[str, Any]] = manifest.get("records") or {}
  payloads: dict[str, dict[str, Any]] = {
    record_id: read_json(record_path(root, entry))
    for record_id, entry in sorted(manifest_records.items())
  }

  foundation_records: dict[str, set[str]] = defaultdict(set)
  foundation_titles: dict[str, str] = {}
  for record_id, payload in payloads.items():
    seen_keys: set[str] = set()
    for reference in payload.get("references") or []:
      key = str(reference.get("key") or "")
      if not key or key in seen_keys:
        continue
      title = clean_reference(reference)
      if not title:
        continue
      seen_keys.add(key)
      foundation_records[key].add(record_id)
      foundation_titles.setdefault(key, title)

  edges_by_pair: dict[tuple[str, str], dict[str, Any]] = {}
  for left_id, payload in payloads.items():
    for overlap in payload.get("overlaps") or []:
      right_id = str(overlap.get("recordId") or "")
      if not right_id or right_id not in payloads or right_id == left_id:
        continue
      pair = tuple(sorted((left_id, right_id)))
      shared_refs = []
      seen_labels = set()
      for reference in overlap.get("references") or []:
        label = clean_reference(reference)
        if not label or label.lower() in seen_labels:
          continue
        seen_labels.add(label.lower())
        shared_refs.append({
          "key": str(reference.get("key") or label.lower()),
          "title": label,
        })
      candidate = {
        "id": f"{pair[0]}--{pair[1]}",
        "leftRecordId": pair[0],
        "rightRecordId": pair[1],
        "sharedCount": int(overlap.get("sharedCount") or 0),
        "score": float(overlap.get("score") or 0),
        "sharedReferences": shared_refs[:MAX_SHARED_REFS],
        "areaTags": union_tags(manifest_records, list(pair), "areaTags"),
        "domainTags": union_tags(manifest_records, list(pair), "domainTags"),
      }
      existing = edges_by_pair.get(pair)
      if not existing or (candidate["sharedCount"], candidate["score"]) > (existing["sharedCount"], existing["score"]):
        edges_by_pair[pair] = candidate

  all_edges = sorted(
    edges_by_pair.values(),
    key=lambda item: (-item["sharedCount"], -item["score"], item["leftRecordId"], item["rightRecordId"]),
  )
  bridge_pairs = all_edges[:MAX_BRIDGES]

  adjacency: dict[str, set[str]] = defaultdict(set)
  edge_lookup: dict[frozenset[str], dict[str, Any]] = {}
  for edge in all_edges:
    if edge["sharedCount"] < 2:
      continue
    left_id = edge["leftRecordId"]
    right_id = edge["rightRecordId"]
    adjacency[left_id].add(right_id)
    adjacency[right_id].add(left_id)
    edge_lookup[frozenset((left_id, right_id))] = edge

  components: list[list[str]] = []
  visited: set[str] = set()
  for record_id in sorted(adjacency):
    if record_id in visited or not adjacency[record_id]:
      continue
    stack = [record_id]
    visited.add(record_id)
    component = []
    while stack:
      current = stack.pop()
      component.append(current)
      for neighbor in sorted(adjacency[current]):
        if neighbor not in visited:
          visited.add(neighbor)
          stack.append(neighbor)
    if len(component) > 1:
      components.append(sorted(component))

  community_payloads = []
  for index, component in enumerate(sorted(components, key=lambda ids: (-len(ids), ids[0]))[:MAX_COMMUNITIES], start=1):
    component_edges = [
      edge
      for edge in all_edges
      if edge["leftRecordId"] in component and edge["rightRecordId"] in component
    ]
    ref_counter: Counter[str] = Counter()
    ref_titles: dict[str, str] = {}
    for edge in component_edges:
      for reference in edge.get("sharedReferences") or []:
        key = str(reference.get("key") or reference.get("title") or "")
        title = str(reference.get("title") or "")
        if key and title:
          ref_counter[key] += 1
          ref_titles.setdefault(key, title)
    top_refs = [
      {"key": key, "title": ref_titles[key], "count": count}
      for key, count in sorted(ref_counter.items(), key=lambda item: (-item[1], ref_titles[item[0]], item[0]))[:MAX_SHARED_REFS]
    ]
    degree = Counter()
    for edge in component_edges:
      degree[edge["leftRecordId"]] += 1
      degree[edge["rightRecordId"]] += 1
    representatives = sorted(
      component,
      key=lambda record_id: (
        -degree[record_id],
        -int(manifest_records.get(record_id, {}).get("referenceCount") or 0),
        compact(payloads.get(record_id, {}).get("title") or record_id),
      ),
    )[:MAX_REPRESENTATIVES]
    label_terms = [item["title"] for item in top_refs[:2]] or union_tags(manifest_records, component, "areaTags")[:2]
    community_payloads.append({
      "id": f"community-{index:02d}",
      "label": " / ".join(label_terms) if label_terms else f"Citation community {index}",
      "recordIds": component,
      "representativeRecordIds": representatives,
      "topSharedReferences": top_refs,
      "areaTags": union_tags(manifest_records, component, "areaTags"),
      "domainTags": union_tags(manifest_records, component, "domainTags"),
      "edgeCount": len(component_edges),
      "maxSharedCount": max([edge["sharedCount"] for edge in component_edges] or [0]),
    })

  shared_foundations = []
  for key, ids in sorted(foundation_records.items(), key=lambda item: (-len(item[1]), foundation_titles.get(item[0], ""), item[0])):
    if len(ids) < 2:
      continue
    sorted_ids = sorted(ids)
    shared_foundations.append({
      "key": key,
      "title": foundation_titles[key],
      "count": len(sorted_ids),
      "citingRecordIds": sorted_ids,
      "areaTags": union_tags(manifest_records, sorted_ids, "areaTags"),
      "domainTags": union_tags(manifest_records, sorted_ids, "domainTags"),
    })
    if len(shared_foundations) >= MAX_FOUNDATIONS:
      break

  record_index = {
    record_id: {
      "communityIds": [],
      "bridgePairIds": [],
      "sharedFoundationKeys": [],
      "referenceCount": int(entry.get("referenceCount") or 0),
      "overlapCount": int(entry.get("overlapCount") or 0),
    }
    for record_id, entry in sorted(manifest_records.items())
  }
  for community in community_payloads:
    for record_id in community["recordIds"]:
      record_index[record_id]["communityIds"].append(community["id"])
  for edge in bridge_pairs:
    record_index[edge["leftRecordId"]]["bridgePairIds"].append(edge["id"])
    record_index[edge["rightRecordId"]]["bridgePairIds"].append(edge["id"])
  for foundation in shared_foundations:
    for record_id in foundation["citingRecordIds"]:
      record_index[record_id]["sharedFoundationKeys"].append(foundation["key"])

  summary = manifest.get("summary") or {}
  total_candidates = int(summary.get("matchedRecords") or 0) + int(summary.get("unmatchedRecords") or 0)
  records_with_references = int(summary.get("recordsWithReferences") or 0)
  coverage_label = f"{records_with_references} / {total_candidates} candidate PDFs" if total_candidates else f"{records_with_references} extracted reference sets"
  generated_at = manifest.get("generatedAt") or datetime.now(timezone.utc).isoformat()
  return {
    "generatedAt": generated_at,
    "sourceManifestGeneratedAt": generated_at,
    "summary": {
      "recordCount": int(summary.get("recordCount") or len(manifest_records)),
      "recordsWithReferences": records_with_references,
      "recordsWithOverlaps": int(summary.get("recordsWithOverlaps") or 0),
      "uniqueReferenceKeys": int(summary.get("uniqueReferenceKeys") or 0),
      "edgeCount": len(all_edges),
      "communityCount": len(community_payloads),
      "coverageLabel": coverage_label,
    },
    "communities": community_payloads,
    "bridgePairs": bridge_pairs,
    "sharedFoundations": shared_foundations,
    "recordIndex": record_index,
  }


def main() -> None:
  parser = argparse.ArgumentParser(description="Build ICML reference insight artifact.")
  parser.add_argument("--root", default=str(DEFAULT_ROOT), help="Reference data root")
  parser.add_argument("--out", default="", help="Output JSON path")
  args = parser.parse_args()
  root = Path(args.root)
  out = Path(args.out) if args.out else root / "insights.json"
  write_json(out, build(root))
  print(f"wrote {out}")


if __name__ == "__main__":
  main()
