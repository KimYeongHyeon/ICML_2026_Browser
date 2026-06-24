#!/usr/bin/env python3
"""Build semantic map data for the static ICML 2026 browser."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import random
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.icml_embedding_contract import build_embedding_text, embedding_source_metadata
from scripts import icml_semantic_config as config


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


class SmokeEmbedder:
    def __init__(self, dimension: int = 64) -> None:
        self.dimension = dimension

    def encode(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            seed = int.from_bytes(digest[:8], "big")
            rng = random.Random(seed)
            vector = [rng.uniform(-1.0, 1.0) for _ in range(self.dimension)]
            norm = math.sqrt(sum(value * value for value in vector)) or 1.0
            vectors.append([round(value / norm, 8) for value in vector])
        return vectors


class LexicalEmbedder:
    """Deterministic sparse lexical fallback when scientific embeddings are unavailable."""

    def __init__(self, dimension: int = 256) -> None:
        self.dimension = dimension

    def encode(self, texts: list[str]) -> list[list[float]]:
        return [self.encode_one(text) for text in texts]

    def encode_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dimension
        tokens = tokenize(text)
        counts = Counter(tokens)
        for token, count in counts.items():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self.dimension
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            weight = 1.0 + math.log1p(count)
            if len(token) > 8:
                weight += 0.25
            vector[index] += sign * weight
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [round(value / norm, 8) for value in vector]


class ScientificEmbedder:
    def __init__(self, model_id: str) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise SystemExit(
                "sentence-transformers is required for semantic map builds. "
                "Install it, or run with --smoke for deterministic test data."
            ) from exc
        self.model_id = model_id
        self.model = SentenceTransformer(model_id)

    def encode(self, texts: list[str]) -> list[list[float]]:
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=True)
        return [[float(value) for value in row] for row in embeddings]


def tokenize(text: str) -> list[str]:
    stopwords = {
        "and", "are", "based", "for", "from", "into", "of", "on", "or", "the",
        "this", "through", "to", "towards", "using", "via", "with",
        "context", "record", "title", "type", "poster", "workshop",
    }
    raw_tokens = re.findall(r"[a-z0-9][a-z0-9+\-]{1,}", text.lower())
    tokens = [token.strip("-+") for token in raw_tokens]
    return [token for token in tokens if len(token) > 2 and token not in stopwords]


def infer_controlled_tags(text: str) -> dict[str, list[str]]:
    lower = text.lower()
    area_tags = [
        tag for tag, keywords in config.AREA_KEYWORDS.items()
        if any(keyword in lower for keyword in keywords)
    ]
    domain_tags = [
        tag for tag, keywords in config.DOMAIN_KEYWORDS.items()
        if any(keyword in lower for keyword in keywords)
    ]
    return {
        "areaTags": area_tags or ["Other"],
        "domainTags": domain_tags or ["General"],
    }


def dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def compute_neighbors(ids: list[str], vectors: list[list[float]], top_k: int) -> dict[str, list[dict[str, float | str]]]:
    try:
        import numpy as np
    except ImportError:
        return compute_neighbors_python(ids, vectors, top_k)

    matrix = np.asarray(vectors, dtype=np.float32)
    result: dict[str, list[dict[str, float | str]]] = {}
    chunk_size = 512
    for start in range(0, len(ids), chunk_size):
        stop = min(start + chunk_size, len(ids))
        scores = matrix[start:stop] @ matrix.T
        for local_index, row in enumerate(scores):
            global_index = start + local_index
            row[global_index] = -np.inf
            limit = min(top_k, len(ids) - 1)
            if limit <= 0:
                result[ids[global_index]] = []
                continue
            candidate_indexes = np.argpartition(row, -limit)[-limit:]
            ordered = candidate_indexes[np.argsort(row[candidate_indexes])[::-1]]
            result[ids[global_index]] = [
                {"id": ids[int(index)], "score": round(float(max(0.0, min(1.0, row[index]))), 4)}
                for index in ordered
            ]
    return result


def compute_neighbors_python(ids: list[str], vectors: list[list[float]], top_k: int) -> dict[str, list[dict[str, float | str]]]:
    result: dict[str, list[dict[str, float | str]]] = {}
    for index, record_id in enumerate(ids):
        scored: list[tuple[float, str]] = []
        for other_index, other_id in enumerate(ids):
            if other_index == index:
                continue
            score = dot(vectors[index], vectors[other_index])
            scored.append((score, other_id))
        scored.sort(reverse=True)
        result[record_id] = [
            {"id": other_id, "score": round(max(0.0, min(1.0, score)), 4)}
            for score, other_id in scored[:top_k]
        ]
    return result


def project_vectors(vectors: list[list[float]], dimension: int) -> list[list[float]]:
    if not vectors:
        return []
    try:
        import umap
        reducer = umap.UMAP(n_components=dimension, random_state=config.MAP_RANDOM_SEED, metric="cosine")
        projected = reducer.fit_transform(vectors)
        return [[float(value) for value in row] for row in projected]
    except ImportError:
        return [vector[:dimension] + [0.0] * max(0, dimension - len(vector)) for vector in vectors]


def build_semantic_payload(
    records: list[dict[str, Any]],
    vectors: list[list[float]],
    payloads: list[dict[str, str]],
    embedding_source: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    ids = [str(record["id"]) for record in records]
    projected_2d = project_vectors(vectors, 2)
    projected_3d = project_vectors(vectors, 3)
    neighbors = compute_neighbors(ids, vectors, config.NEIGHBOR_COUNT)
    map_records = []
    semantic_sidecar = {}

    for record, payload, point_2d, point_3d in zip(records, payloads, projected_2d, projected_3d):
        record_id = str(record["id"])
        tags = infer_controlled_tags(payload["text"])
        cluster_id = f"cluster-{tags['areaTags'][0].lower().replace(' ', '-')}"
        cluster_label = tags["areaTags"][0]
        map_records.append({
            "id": record_id,
            "x": round(point_2d[0], 6),
            "y": round(point_2d[1], 6),
            "z": round(point_3d[2] if len(point_3d) > 2 else 0.0, 6),
            "clusterId": cluster_id,
            "nearestNeighbors": neighbors[record_id],
        })
        semantic_sidecar[record_id] = {
            "areaTags": tags["areaTags"],
            "domainTags": tags["domainTags"],
            "clusterId": cluster_id,
            "clusterLabel": cluster_label,
            "classificationConfidence": 0.6 if payload["quality"] == "title_abstract" else 0.35,
            "classificationReason": f"Keyword-supported semantic classification from {payload['quality']} text.",
            "embeddingTextQuality": payload["quality"],
            "mapAvailable": True,
        }

    cluster_counts = Counter(item["clusterId"] for item in map_records)
    clusters = [
        {"id": cluster_id, "label": cluster_id.replace("cluster-", "").replace("-", " ").title(), "size": size, "topTerms": []}
        for cluster_id, size in sorted(cluster_counts.items())
    ]
    map_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "embeddingSource": embedding_source,
        "model": {
            "id": "smoke-deterministic",
            "kind": "smoke",
            "dimension": len(vectors[0]) if vectors else 0,
        },
        "projection": {"method": "umap-or-vector-fallback", "randomSeed": config.MAP_RANDOM_SEED},
        "records": map_records,
        "clusters": clusters,
    }
    return map_payload, {"embeddingSource": embedding_source, "records": semantic_sidecar}


def quantized_vector_base64(vector: list[float]) -> str:
    values = []
    for value in vector:
        clipped = max(-1.0, min(1.0, float(value)))
        values.append(int(round(clipped * 127)) & 0xFF)
    return base64.b64encode(bytes(values)).decode("ascii")


def build_search_embeddings_payload(
    records: list[dict[str, Any]],
    vectors: list[list[float]],
    payloads: list[dict[str, str]],
    model_id: str,
    model_kind: str,
    embedding_source: dict[str, Any],
) -> dict[str, Any]:
    searchable_records = []
    for record, vector, payload in zip(records, vectors, payloads):
        if record.get("type") == "poster":
            continue
        searchable_records.append({
            "id": str(record["id"]),
            "quality": payload["quality"],
            "vector": quantized_vector_base64(vector),
        })
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "embeddingSource": embedding_source,
        "model": {
            "id": model_id,
            "kind": model_kind,
            "queryModelId": config.QUERY_EMBEDDING_MODEL_ID,
            "dimension": len(vectors[0]) if vectors else 0,
            "normalized": True,
            "quantization": "int8_symmetric_base64",
            "scale": 127,
        },
        "records": searchable_records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", help="Use deterministic random smoke embeddings for test speed only.")
    parser.add_argument("--lexical", action="store_true", help="Use deterministic lexical hash embeddings when no scientific model is installed.")
    parser.add_argument("--limit", type=int, default=0, help="Limit records for fast development checks. Zero means all records.")
    args = parser.parse_args()

    index = read_json(config.INDEX_PATH)
    records = index.get("records", [])
    if args.limit:
        records = records[: args.limit]
    payloads = [build_embedding_text(record) for record in records]
    searchable_count = sum(1 for record in records if record.get("type") != "poster")
    embedding_source = embedding_source_metadata(
        records,
        searchable_record_count=searchable_count,
        index_generated_at=str(index.get("generatedAt") or ""),
    )
    if args.smoke:
        embedder = SmokeEmbedder()
        model_id = "smoke-deterministic"
        model_kind = "smoke"
    elif args.lexical:
        embedder = LexicalEmbedder()
        model_id = "lexical-hash-tfidf"
        model_kind = "lexical"
    else:
        embedder = ScientificEmbedder(config.EMBEDDING_MODEL_ID)
        model_id = config.EMBEDDING_MODEL_ID
        model_kind = config.EMBEDDING_MODEL_KIND
    vectors = embedder.encode([payload["text"] for payload in payloads])
    map_payload, sidecar_payload = build_semantic_payload(records, vectors, payloads, embedding_source)
    map_payload["model"] = {
        "id": model_id,
        "kind": model_kind,
        "dimension": len(vectors[0]) if vectors else 0,
    }

    write_json(config.MAP_PATH, map_payload)
    write_json(config.SEMANTIC_SIDECAR_PATH, sidecar_payload)
    search_payload = build_search_embeddings_payload(records, vectors, payloads, model_id, model_kind, embedding_source)
    write_json(config.SEARCH_EMBEDDINGS_PATH, search_payload)
    counts = Counter(item["embeddingTextQuality"] for item in sidecar_payload["records"].values())
    print(f"Wrote {config.MAP_PATH.relative_to(config.ROOT)}")
    print(f"Wrote {config.SEMANTIC_SIDECAR_PATH.relative_to(config.ROOT)}")
    print(f"Wrote {config.SEARCH_EMBEDDINGS_PATH.relative_to(config.ROOT)}")
    print(json.dumps({"records": len(map_payload["records"]), "textQuality": counts}, default=dict, indent=2))


if __name__ == "__main__":
    main()
