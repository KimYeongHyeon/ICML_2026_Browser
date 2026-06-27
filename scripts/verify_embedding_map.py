#!/usr/bin/env python3
"""Validate the static ICML semantic-map data contract."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_path", nargs="?", type=Path, default=config.INDEX_PATH)
    parser.add_argument("map_path", nargs="?", type=Path, default=config.MAP_PATH)
    parser.add_argument("--require-fresh", action="store_true")
    args = parser.parse_args()
    index_path = args.index_path
    map_path = args.map_path
    index = load(index_path)
    map_data = load(map_path)
    search_data = load(config.SEARCH_EMBEDDINGS_PATH) if config.SEARCH_EMBEDDINGS_PATH.exists() else None
    sidecar_data = load(config.SEMANTIC_SIDECAR_PATH) if config.SEMANTIC_SIDECAR_PATH.exists() else None
    trend_data = load(config.TRENDS_PATH) if config.TRENDS_PATH.exists() else None
    index_records = index.get("records", [])
    visible_ids = {str(record["id"]) for record in index_records}
    map_records = map_data.get("records", [])
    map_ids = {str(record["id"]) for record in map_records}
    embedding_clusters = map_data.get("embeddingClusters", [])
    embedding_cluster_ids = {str(cluster.get("id")) for cluster in embedding_clusters}
    embedding_cluster_counts: dict[str, int] = {}
    errors: list[str] = []

    if not embedding_clusters:
        errors.append("embeddingClusters is missing or empty; rebuild must use real HDBSCAN clusters")
    non_noise_clusters = [cluster for cluster in embedding_clusters if cluster.get("id") != "embedding-noise"]
    if len(non_noise_clusters) < 2:
        errors.append("embeddingClusters must include at least two non-noise HDBSCAN clusters")
    projection_method = str((map_data.get("projection") or {}).get("method") or "")
    if not projection_method or "fallback" in projection_method.lower():
        errors.append(f"projection method must not advertise fallback: {projection_method}")
    for cluster in embedding_clusters:
        cluster_id = str(cluster.get("id") or "")
        if not cluster_id:
            errors.append("embedding cluster missing id")
        if not str(cluster.get("method") or "").startswith("hdbscan"):
            errors.append(f"embedding cluster {cluster_id} has non-HDBSCAN method: {cluster.get('method')}")
        if not isinstance(cluster.get("size"), int) or int(cluster.get("size") or 0) <= 0:
            errors.append(f"embedding cluster {cluster_id} has invalid size: {cluster.get('size')}")
        if "fallback" in str(cluster.get("method") or "").lower():
            errors.append(f"embedding cluster {cluster_id} uses forbidden fallback method: {cluster.get('method')}")

    for record in map_records:
        record_id = str(record.get("id"))
        if record_id not in visible_ids:
            errors.append(f"map record does not exist in index: {record_id}")
        embedding_cluster_id = str(record.get("embeddingClusterId") or "")
        if not embedding_cluster_id:
            errors.append(f"map record missing embeddingClusterId: {record_id}")
        elif embedding_cluster_id not in embedding_cluster_ids:
            errors.append(f"map record has unknown embeddingClusterId for {record_id}: {embedding_cluster_id}")
        else:
            embedding_cluster_counts[embedding_cluster_id] = embedding_cluster_counts.get(embedding_cluster_id, 0) + 1
        for duplicate_key in ("embeddingClusterLabel", "embeddingClusterSize", "embeddingClusterMethod"):
            if duplicate_key in record:
                errors.append(f"map record should not duplicate {duplicate_key}: {record_id}")
        for key in ("x", "y", "z"):
            value = record.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                errors.append(f"invalid coordinate {key} for {record_id}: {value}")
        for neighbor in record.get("nearestNeighbors", []):
            neighbor_id = str(neighbor.get("id"))
            if neighbor_id not in visible_ids:
                errors.append(f"neighbor target missing for {record_id}: {neighbor_id}")
            score = neighbor.get("score")
            if not isinstance(score, (int, float)) or not math.isfinite(float(score)) or not 0 <= float(score) <= 1:
                errors.append(f"invalid neighbor score for {record_id}->{neighbor_id}: {score}")

    for record in index_records:
        record_id = str(record["id"])
        if record.get("mapAvailable"):
            if record_id not in map_ids:
                errors.append(f"index says mapAvailable but map record is missing: {record_id}")
            errors.extend(f"unknown area tag for {record_id}: {tag}" for tag in config.validate_area_tags(record.get("areaTags") or []))
            errors.extend(f"unknown domain tag for {record_id}: {tag}" for tag in config.validate_domain_tags(record.get("domainTags") or []))
            if record.get("embeddingTextQuality") not in {"title_abstract", "title_topic", "title_only"}:
                errors.append(f"invalid embeddingTextQuality for {record_id}: {record.get('embeddingTextQuality')}")
            embedding_cluster_id = str(record.get("embeddingClusterId") or "")
            if not embedding_cluster_id:
                errors.append(f"index record missing embeddingClusterId: {record_id}")
            elif embedding_cluster_id not in embedding_cluster_ids:
                errors.append(f"index record has unknown embeddingClusterId for {record_id}: {embedding_cluster_id}")
            for duplicate_key in ("embeddingClusterLabel", "embeddingClusterSize", "embeddingClusterMethod"):
                if duplicate_key in record:
                    errors.append(f"index record should not duplicate {duplicate_key}: {record_id}")

    for cluster in embedding_clusters:
        cluster_id = str(cluster.get("id") or "")
        expected_size = int(cluster.get("size") or 0)
        actual_size = embedding_cluster_counts.get(cluster_id, 0)
        if expected_size != actual_size:
            errors.append(f"embedding cluster size mismatch for {cluster_id}: listed={expected_size}, assigned={actual_size}")

    if search_data:
        search_ids = {str(record.get("id")) for record in search_data.get("records", [])}
        searchable_ids = {str(record["id"]) for record in index_records if record.get("type") != "poster" and record.get("mapAvailable")}
        missing_search = sorted(searchable_ids - search_ids)
        extra_search = sorted(search_ids - visible_ids)
        if missing_search:
            errors.append(f"search embeddings missing {len(missing_search)} mapped non-poster records; first={missing_search[:3]}")
        if extra_search:
            errors.append(f"search embeddings contain unknown records; first={extra_search[:3]}")
        dimension = int(search_data.get("model", {}).get("dimension") or 0)
        expected_bytes = math.ceil(dimension * 4 / 3) if dimension else 0
        for record in search_data.get("records", [])[:20]:
            vector = record.get("vector")
            if not isinstance(vector, str) or (expected_bytes and len(vector) < expected_bytes - 4):
                errors.append(f"invalid search vector encoding for {record.get('id')}")

    if trend_data:
        for trend in trend_data.get("trends", []):
            cluster_id = str(trend.get("clusterId") or "")
            if cluster_id not in embedding_cluster_ids:
                errors.append(f"trend references unknown embedding cluster: {cluster_id}")
            if not str(trend.get("clusterMethod") or "").startswith("hdbscan"):
                errors.append(f"trend has non-HDBSCAN clusterMethod for {cluster_id}: {trend.get('clusterMethod')}")
    embedding_summary = index.get("summary", {}).get("embedding") or {}
    expected = embedding_summary.get("expectedFingerprint")
    map_actual = (map_data.get("embeddingSource") or {}).get("sourceFingerprint")
    search_actual = (search_data.get("embeddingSource") or {}).get("sourceFingerprint") if search_data else ""
    sidecar_actual = (sidecar_data.get("embeddingSource") or {}).get("sourceFingerprint") if sidecar_data else ""
    stale = [
        name
        for name, actual in {"map": map_actual, "search": search_actual, "sidecar": sidecar_actual}.items()
        if expected and actual != expected
    ]
    if stale:
        message = f"semantic embedding artifacts are stale: {', '.join(stale)}"
        if args.require_fresh:
            errors.append(message)
        else:
            print(f"Warning: {message}", file=sys.stderr)

    if errors:
        print("ICML embedding map verification failed:", file=sys.stderr)
        for error in errors[:80]:
            print(f"- {error}", file=sys.stderr)
        if len(errors) > 80:
            print(f"- ... {len(errors) - 80} more", file=sys.stderr)
        raise SystemExit(1)

    print("ICML embedding map verification passed")
    print(f"- index records: {len(index_records):,}")
    print(f"- map records: {len(map_records):,}")
    print(f"- clusters: {len(map_data.get('clusters', [])):,}")
    print(f"- embedding clusters: {len(embedding_clusters):,}")
    if search_data:
        print(f"- search embeddings: {len(search_data.get('records', [])):,}")


if __name__ == "__main__":
    main()
