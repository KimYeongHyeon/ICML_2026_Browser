#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MAX_COMMUNITIES = 12
MAX_BRIDGES = 24
MAX_FOUNDATIONS = 24
MAX_REPRESENTATIVES = 8
MAX_SHARED_REFS = 6


def fail(message: str) -> None:
  raise SystemExit(message)


def read_json(path: Path) -> dict[str, Any]:
  with path.open(encoding="utf-8") as handle:
    return json.load(handle)


def require_keys(payload: dict[str, Any], keys: set[str], label: str) -> None:
  missing = sorted(keys - set(payload))
  if missing:
    fail(f"{label} missing keys: {', '.join(missing)}")


def ensure_list(value: Any, label: str, limit: int | None = None) -> list[Any]:
  if not isinstance(value, list):
    fail(f"{label} must be a list")
  if limit is not None and len(value) > limit:
    fail(f"{label} exceeds limit {limit}")
  return value


def ensure_record_ids(ids: list[str], known_ids: set[str], label: str) -> None:
  if not ids:
    fail(f"{label} must not be empty")
  for record_id in ids:
    if record_id not in known_ids:
      fail(f"{label} references unknown record id {record_id}")


def sorted_bridge_key(item: dict[str, Any]) -> tuple[float, float, str, str]:
  return (
    -int(item.get("sharedCount") or 0),
    -float(item.get("score") or 0),
    str(item.get("leftRecordId") or ""),
    str(item.get("rightRecordId") or ""),
  )


def sorted_foundation_key(item: dict[str, Any]) -> tuple[int, str, str]:
  return (
    -int(item.get("count") or 0),
    str(item.get("title") or ""),
    str(item.get("key") or ""),
  )


def verify(path: Path) -> None:
  payload = read_json(path)
  root = path.parent
  manifest = read_json(root / "manifest.json")
  known_ids = set((manifest.get("records") or {}).keys())
  require_keys(payload, {"generatedAt", "sourceManifestGeneratedAt", "summary", "communities", "bridgePairs", "sharedFoundations", "recordIndex"}, "insights")
  require_keys(payload["summary"], {"recordCount", "recordsWithReferences", "recordsWithOverlaps", "uniqueReferenceKeys", "edgeCount", "communityCount", "coverageLabel"}, "summary")
  if payload["sourceManifestGeneratedAt"] != manifest.get("generatedAt"):
    fail("sourceManifestGeneratedAt does not match manifest generatedAt")
  if set(payload["recordIndex"]) != known_ids:
    fail("recordIndex must contain exactly manifest record ids")

  communities = ensure_list(payload["communities"], "communities", MAX_COMMUNITIES)
  bridges = ensure_list(payload["bridgePairs"], "bridgePairs", MAX_BRIDGES)
  foundations = ensure_list(payload["sharedFoundations"], "sharedFoundations", MAX_FOUNDATIONS)

  bridge_pairs: set[tuple[str, str]] = set()
  for bridge in bridges:
    require_keys(bridge, {"id", "leftRecordId", "rightRecordId", "sharedCount", "score", "sharedReferences", "areaTags", "domainTags"}, "bridge")
    left_id = str(bridge["leftRecordId"])
    right_id = str(bridge["rightRecordId"])
    ensure_record_ids([left_id, right_id], known_ids, "bridge")
    pair = tuple(sorted((left_id, right_id)))
    if pair in bridge_pairs:
      fail(f"duplicate bridge pair {pair[0]}--{pair[1]}")
    bridge_pairs.add(pair)
    if pair != (left_id, right_id):
      fail(f"bridge ids must be sorted in {bridge['id']}")
    if int(bridge["sharedCount"]) < 2:
      fail(f"bridge {bridge['id']} sharedCount must be >= 2")
    shared_refs = ensure_list(bridge["sharedReferences"], "bridge.sharedReferences", MAX_SHARED_REFS)
    if not shared_refs:
      fail(f"bridge {bridge['id']} must include shared reference evidence")
    for reference in shared_refs:
      if not str(reference.get("title") or "").strip():
        fail(f"bridge {bridge['id']} has empty shared reference title")
  if bridges != sorted(bridges, key=sorted_bridge_key):
    fail("bridgePairs are not deterministically sorted")

  for community in communities:
    require_keys(community, {"id", "label", "recordIds", "representativeRecordIds", "topSharedReferences", "areaTags", "domainTags", "edgeCount", "maxSharedCount"}, "community")
    record_ids = ensure_list(community["recordIds"], "community.recordIds")
    if len(record_ids) < 2:
      fail(f"community {community['id']} must not be singleton")
    ensure_record_ids(record_ids, known_ids, "community.recordIds")
    ensure_record_ids(ensure_list(community["representativeRecordIds"], "community.representativeRecordIds", MAX_REPRESENTATIVES), known_ids, "community.representativeRecordIds")
    if not str(community.get("label") or "").strip():
      fail(f"community {community['id']} has empty label")
    if int(community.get("edgeCount") or 0) < 1:
      fail(f"community {community['id']} must include at least one edge")
    for reference in ensure_list(community["topSharedReferences"], "community.topSharedReferences", MAX_SHARED_REFS):
      if not str(reference.get("title") or "").strip():
        fail(f"community {community['id']} has empty shared reference title")

  for foundation in foundations:
    require_keys(foundation, {"key", "title", "count", "citingRecordIds", "areaTags", "domainTags"}, "foundation")
    if not str(foundation.get("title") or "").strip():
      fail(f"foundation {foundation.get('key')} has empty title")
    citing_ids = ensure_list(foundation["citingRecordIds"], "foundation.citingRecordIds")
    ensure_record_ids(citing_ids, known_ids, "foundation.citingRecordIds")
    if int(foundation["count"]) != len(citing_ids):
      fail(f"foundation {foundation['key']} count does not match citing ids")
  if foundations != sorted(foundations, key=sorted_foundation_key):
    fail("sharedFoundations are not deterministically sorted")

  community_ids = {community["id"] for community in communities}
  bridge_ids = {bridge["id"] for bridge in bridges}
  foundation_keys = {foundation["key"] for foundation in foundations}
  for record_id, entry in payload["recordIndex"].items():
    require_keys(entry, {"communityIds", "bridgePairIds", "sharedFoundationKeys", "referenceCount", "overlapCount"}, f"recordIndex.{record_id}")
    for community_id in entry["communityIds"]:
      if community_id not in community_ids:
        fail(f"recordIndex.{record_id} references unknown community {community_id}")
    for bridge_id in entry["bridgePairIds"]:
      if bridge_id not in bridge_ids:
        fail(f"recordIndex.{record_id} references unknown bridge {bridge_id}")
    for foundation_key in entry["sharedFoundationKeys"]:
      if foundation_key not in foundation_keys:
        fail(f"recordIndex.{record_id} references unknown foundation {foundation_key}")
  print(f"reference insights ok: {len(communities)} communities, {len(bridges)} bridges, {len(foundations)} foundations")


def main() -> None:
  parser = argparse.ArgumentParser(description="Verify ICML reference insight artifact.")
  parser.add_argument("path", nargs="?", default=str(ROOT / "docs/site/data/references/insights.json"))
  args = parser.parse_args()
  verify(Path(args.path))


if __name__ == "__main__":
  main()
