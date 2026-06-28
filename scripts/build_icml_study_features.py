#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config


OUT_PATH: Final = config.ROOT / "docs" / "site" / "data" / "icml2026_study_features.json"
STAGES: Final = ("intro", "core", "applied", "broader")
BANNED_WORDS: Final = ("novel", "breakthrough", "sota", "state-of-the-art", "first-of-its-kind")


@dataclass(frozen=True, slots=True)
class StudySources:
    index: dict[str, Any]
    map_data: dict[str, Any]
    trends: dict[str, Any]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def aliases(record_id: str) -> set[str]:
    values = {record_id}
    values.update(part for part in re.split(r"[;:]", record_id) if part)
    match = re.search(r";icml:(\d+)", record_id)
    if match:
        values.add(match.group(1))
    return values


def resolve_id(value: str, alias_to_id: dict[str, str]) -> str:
    return alias_to_id.get(value, value)


def overlap(left: list[str], right: list[str]) -> int:
    return len(set(left) & set(right))


def point_distance(record: dict[str, Any], center: tuple[float, float, float]) -> float:
    return math.sqrt(sum((float(record.get(axis) or 0) - center[index]) ** 2 for index, axis in enumerate(("x", "y", "z"))))


def cluster_center(records: list[dict[str, Any]]) -> tuple[float, float, float]:
    count = max(1, len(records))
    return tuple(sum(float(record.get(axis) or 0) for record in records) / count for axis in ("x", "y", "z"))


def stage_for(seed: dict[str, Any], candidate: dict[str, Any], central_ids: set[str]) -> str:
    if str(candidate.get("id")) in central_ids:
        return "intro"
    if seed.get("embeddingClusterId") and seed.get("embeddingClusterId") == candidate.get("embeddingClusterId"):
        return "core"
    if overlap(seed.get("areaTags") or [], candidate.get("areaTags") or []) and not overlap(seed.get("domainTags") or [], candidate.get("domainTags") or []):
        return "applied"
    return "broader"


def reason_for(stage: str, seed: dict[str, Any], candidate: dict[str, Any]) -> str:
    shared_areas = [tag for tag in candidate.get("areaTags") or [] if tag in set(seed.get("areaTags") or [])]
    shared_domains = [tag for tag in candidate.get("domainTags") or [] if tag in set(seed.get("domainTags") or [])]
    if stage == "intro":
        return "central representative in the same embedding region"
    if stage == "core":
        return "closest semantic neighbor in the same embedding cluster"
    if stage == "applied":
        area = shared_areas[0] if shared_areas else "method area"
        return f"same {area} direction across a different domain"
    if shared_domains:
        return f"bridge from shared {shared_domains[0]} context to a broader area"
    return "broader semantic bridge from nearby map geometry"


def clean_reason(value: str) -> str:
    cleaned = value
    for word in BANNED_WORDS:
        cleaned = re.sub(re.escape(word), "unusual", cleaned, flags=re.IGNORECASE)
    return cleaned


def ranked_candidates(
    seed_id: str,
    records_by_id: dict[str, dict[str, Any]],
    map_by_id: dict[str, dict[str, Any]],
    cluster_central: dict[str, list[str]],
    trend_reps: dict[str, list[str]],
) -> list[tuple[float, str]]:
    seed = records_by_id[seed_id]
    seed_map = map_by_id[seed_id]
    scores: dict[str, float] = {}

    def add(record_id: str, score: float) -> None:
        if record_id == seed_id or record_id not in records_by_id:
            return
        scores[record_id] = max(scores.get(record_id, 0), score)

    for index, item in enumerate(seed_map.get("nearestNeighbors") or []):
        add(str(item.get("id") or ""), float(item.get("score") or 0) + max(0, 0.12 - index * 0.008))
    for item in (seed_map.get("nearestNeighbors") or [])[:6]:
        neighbor_map = map_by_id.get(str(item.get("id") or ""))
        for second in (neighbor_map or {}).get("nearestNeighbors") or []:
            add(str(second.get("id") or ""), float(second.get("score") or 0) * 0.92)
    for index, record_id in enumerate(cluster_central.get(str(seed.get("embeddingClusterId") or ""), [])[:10]):
        add(record_id, 0.9 - index * 0.01)
    for index, record_id in enumerate(trend_reps.get(str(seed.get("embeddingClusterId") or ""), [])[:8]):
        add(record_id, 0.86 - index * 0.01)

    ranked = []
    for record_id, base_score in scores.items():
        candidate = records_by_id[record_id]
        bonus = 0.0
        if candidate.get("embeddingClusterId") == seed.get("embeddingClusterId"):
            bonus += 0.08
        if overlap(seed.get("areaTags") or [], candidate.get("areaTags") or []):
            bonus += 0.06
        if overlap(seed.get("domainTags") or [], candidate.get("domainTags") or []):
            bonus += 0.04
        if candidate.get("embeddingTextQuality") == "title_abstract":
            bonus += 0.03
        ranked.append((base_score + bonus, record_id))
    ranked.sort(key=lambda item: (-item[0], records_by_id[item[1]].get("title") or item[1]))
    return ranked


def choose_trail(seed_id: str, ranked: list[tuple[float, str]], records_by_id: dict[str, dict[str, Any]], central_ids: set[str]) -> list[dict[str, str]]:
    seed = records_by_id[seed_id]
    chosen: list[dict[str, str]] = []
    seen_domains: Counter[str] = Counter()
    for _, record_id in ranked:
        candidate = records_by_id[record_id]
        stage = stage_for(seed, candidate, central_ids)
        if len(chosen) >= 5 and seen_domains[(candidate.get("domainTags") or ["General"])[0]] >= 3:
            continue
        chosen.append({"recordId": record_id, "stage": stage, "reason": clean_reason(reason_for(stage, seed, candidate))})
        seen_domains[(candidate.get("domainTags") or ["General"])[0]] += 1
        if len(chosen) >= 10:
            break
    present = {item["stage"] for item in chosen}
    for stage in STAGES:
        if stage in present:
            continue
        for _, record_id in ranked:
            if any(item["recordId"] == record_id for item in chosen):
                continue
            candidate_stage = stage_for(seed, records_by_id[record_id], central_ids)
            if candidate_stage == stage and len(chosen) < 10:
                chosen.append({"recordId": record_id, "stage": stage, "reason": clean_reason(reason_for(stage, seed, records_by_id[record_id]))})
                break
    if len(chosen) >= 5:
        for index, stage in enumerate(STAGES):
            if stage not in {item["stage"] for item in chosen}:
                chosen[index]["stage"] = stage
                chosen[index]["reason"] = clean_reason(reason_for(stage, seed, records_by_id[chosen[index]["recordId"]]))
    return chosen[:10]


def choose_compare(seed_id: str, ranked: list[tuple[float, str]], records_by_id: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    seed = records_by_id[seed_id]
    values = []
    for _, record_id in ranked:
        candidate = records_by_id[record_id]
        if overlap(seed.get("domainTags") or [], candidate.get("domainTags") or []) and overlap(seed.get("areaTags") or [], candidate.get("areaTags") or []):
            reason = "same area and domain baseline"
        elif overlap(seed.get("areaTags") or [], candidate.get("areaTags") or []):
            reason = "same area with a different domain emphasis"
        else:
            reason = "nearby embedding neighbor with different tags"
        values.append({"recordId": record_id, "reason": reason})
        if len(values) >= 4:
            break
    return values


def build_study_features(sources: StudySources) -> dict[str, Any]:
    records_by_id = {
        str(record.get("id")): record
        for record in sources.index.get("records", [])
        if record.get("id") and record.get("type") != "poster"
    }
    alias_to_id = {alias: record_id for record_id in records_by_id for alias in aliases(record_id)}
    map_by_id: dict[str, dict[str, Any]] = {}
    for map_record in sources.map_data.get("records", []):
        record_id = resolve_id(str(map_record.get("id") or ""), alias_to_id)
        if record_id in records_by_id:
            map_by_id[record_id] = {**map_record, "id": record_id}
    for map_record in map_by_id.values():
        map_record["nearestNeighbors"] = [
            {**item, "id": resolved}
            for item in map_record.get("nearestNeighbors") or []
            for resolved in [resolve_id(str(item.get("id") or ""), alias_to_id)]
            if resolved in records_by_id and resolved != map_record["id"]
        ][:12]

    cluster_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record_id, map_record in map_by_id.items():
        cluster_id = str(records_by_id[record_id].get("embeddingClusterId") or map_record.get("embeddingClusterId") or "")
        if cluster_id and cluster_id != "embedding-noise":
            cluster_records[cluster_id].append(map_record)

    cluster_central: dict[str, list[str]] = {}
    outlier_candidates = []
    for cluster_id, members in cluster_records.items():
        if len(members) < 8:
            continue
        center = cluster_center(members)
        ranked_by_distance = sorted(members, key=lambda item: point_distance(item, center))
        cluster_central[cluster_id] = [str(item["id"]) for item in ranked_by_distance[:12]]
        distances = [(point_distance(item, center), item) for item in members]
        distances.sort(key=lambda item: (-item[0], str(records_by_id[str(item[1]["id"])].get("title") or "")))
        threshold = distances[max(0, min(len(distances) - 1, int(len(distances) * 0.08)))][0]
        for distance, item in distances[:3]:
            record = records_by_id[str(item["id"])]
            if distance < threshold or record.get("embeddingTextQuality") != "title_abstract":
                continue
            outlier_candidates.append({
                "recordId": str(item["id"]),
                "clusterId": cluster_id,
                "score": round(distance, 4),
                "reason": "far from cluster center while retaining title and abstract text",
            })

    trend_reps = {
        str(trend.get("clusterId") or trend.get("id") or ""): [
            resolve_id(str(record_id), alias_to_id)
            for record_id in trend.get("representativeRecordIds") or []
            if resolve_id(str(record_id), alias_to_id) in records_by_id
        ]
        for trend in sources.trends.get("trends", [])
    }

    record_payloads = {}
    for record_id in sorted(map_by_id):
        ranked = ranked_candidates(record_id, records_by_id, map_by_id, cluster_central, trend_reps)
        if not ranked:
            continue
        central_ids = set(cluster_central.get(str(records_by_id[record_id].get("embeddingClusterId") or ""), []))
        record_payloads[record_id] = {
            "studyTrail": choose_trail(record_id, ranked, records_by_id, central_ids),
            "compareCandidates": choose_compare(record_id, ranked, records_by_id),
        }

    trends_by_cluster = {str(trend.get("clusterId") or trend.get("id") or ""): str(trend.get("id") or "") for trend in sources.trends.get("trends", [])}
    topics = {}
    for cluster_id, members in cluster_records.items():
        record_members = [records_by_id[str(item["id"])] for item in members]
        areas = Counter(tag for record in record_members for tag in record.get("areaTags") or [])
        domains = Counter(tag for record in record_members for tag in record.get("domainTags") or [])
        topics[cluster_id] = {
            "dominantArea": areas.most_common(1)[0][0] if areas else "Other",
            "dominantDomain": domains.most_common(1)[0][0] if domains else "General",
            "nearbyTrendId": trends_by_cluster.get(cluster_id, ""),
            "representativeRecordIds": cluster_central.get(cluster_id, [])[:3],
        }

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "indexGeneratedAt": sources.index.get("generatedAt", ""),
            "mapGeneratedAt": sources.map_data.get("generatedAt", ""),
            "trendsGeneratedAt": sources.trends.get("generatedAt", ""),
        },
        "records": record_payloads,
        "topics": topics,
        "outliers": sorted(outlier_candidates, key=lambda item: (-float(item["score"]), item["recordId"]))[:30],
    }


def main() -> None:
    sources = StudySources(read_json(config.INDEX_PATH), read_json(config.MAP_PATH), read_json(config.TRENDS_PATH))
    payload = build_study_features(sources)
    write_json(OUT_PATH, payload)
    print(f"Wrote {OUT_PATH.relative_to(config.ROOT)}")
    print(json.dumps({
        "records": len(payload["records"]),
        "topics": len(payload["topics"]),
        "outliers": len(payload["outliers"]),
    }, indent=2))


if __name__ == "__main__":
    main()
