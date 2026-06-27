#!/usr/bin/env python3
"""Fast unit checks for the ICML semantic-map pipeline."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_semantic_config_exports_taxonomies() -> None:
    config = importlib.import_module("scripts.icml_semantic_config")
    assert "LLMs" in config.AREA_TAGS
    assert "Biology" in config.DOMAIN_TAGS
    assert config.EMBEDDING_MODEL_ID
    assert config.MAP_RANDOM_SEED == 42


def test_validate_tags_rejects_unknown_values() -> None:
    config = importlib.import_module("scripts.icml_semantic_config")
    assert config.validate_area_tags(["LLMs", "Theory"]) == []
    assert config.validate_domain_tags(["Biology"]) == []
    assert config.validate_area_tags(["Made Up Area"]) == ["Made Up Area"]
    assert config.validate_domain_tags(["Made Up Domain"]) == ["Made Up Domain"]


def test_build_embedding_text_quality_levels() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    title_only = {"id": "r1", "title": "A Paper", "group": "", "type": "poster"}
    title_topic = {"id": "r2", "title": "A Paper", "group": "AI4Science Workshop", "type": "workshop"}
    title_abstract = {"id": "r3", "title": "A Paper", "abstract": "This is the abstract.", "group": "", "type": "poster"}
    assert builder.build_embedding_text(title_only)["quality"] == "title_only"
    assert builder.build_embedding_text(title_topic)["quality"] == "title_topic"
    assert builder.build_embedding_text(title_abstract)["quality"] == "title_abstract"


def test_smoke_embedder_is_deterministic() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    embedder = builder.SmokeEmbedder(dimension=8)
    first = embedder.encode(["same text"])[0]
    second = embedder.encode(["same text"])[0]
    assert first == second
    assert len(first) == 8


def test_lexical_embedder_prefers_shared_terms() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    embedder = builder.LexicalEmbedder(dimension=64)
    query, close, far = embedder.encode([
        "protein language model for drug discovery",
        "drug discovery with protein foundation models",
        "reinforcement learning for robot navigation",
    ])
    assert builder.dot(query, close) > builder.dot(query, far)


def test_infer_controlled_tags_uses_area_and_domain_keywords() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    result = builder.infer_controlled_tags("LLM agent for protein design and drug discovery")
    assert "LLMs" in result["areaTags"]
    assert "Agents" in result["areaTags"]
    assert "Biology" in result["domainTags"]


def test_compute_neighbors_resolves_known_ids() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    ids = ["a", "b", "c"]
    vectors = [[1.0, 0.0], [0.9, 0.1], [-1.0, 0.0]]
    neighbors = builder.compute_neighbors(ids, vectors, top_k=1)
    assert neighbors["a"][0]["id"] == "b"
    assert 0.0 <= neighbors["a"][0]["score"] <= 1.0


def test_embedding_clusters_are_not_area_aliases() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    titles = [
        "Reasoning Language Benchmarks",
        "Prompt Reasoning Evaluation",
        "Agent Planning Benchmarks",
        "Language Reasoning Agents",
        "Mechanistic Circuit Analysis",
        "Representation Geometry for Interpretability",
        "Feature Circuits in Transformers",
        "Activation Patching for Interpretability",
    ]
    records = [
        {"id": f"llm-{index}", "type": "paper", "title": title, "abstract": title, "group": "Main Conference"}
        for index, title in enumerate(titles)
    ]
    payloads = [
        {"text": "LLM reasoning language model benchmark", "quality": "title_abstract"},
        {"text": "LLM reasoning language model evaluation", "quality": "title_abstract"},
        {"text": "LLM reasoning prompt planning", "quality": "title_abstract"},
        {"text": "LLM reasoning agent benchmark", "quality": "title_abstract"},
        {"text": "LLM mechanistic interpretability circuit analysis", "quality": "title_abstract"},
        {"text": "LLM mechanistic interpretability representation geometry", "quality": "title_abstract"},
        {"text": "LLM mechanistic interpretability feature circuits", "quality": "title_abstract"},
        {"text": "LLM mechanistic interpretability activation patching", "quality": "title_abstract"},
    ]
    vectors = [
        [1.0, 0.0, 0.0],
        [0.98, 0.02, 0.0],
        [0.96, -0.01, 0.02],
        [0.94, 0.03, -0.01],
        [-1.0, 0.0, 0.0],
        [-0.98, -0.02, 0.0],
        [-0.96, 0.01, -0.02],
        [-0.94, -0.03, 0.01],
    ]
    def fake_embedding_clusters(ids, vectors, records, min_cluster_size=2, min_samples=1):
        clusters = [
            {"id": "embedding-cluster-001", "label": "Cluster 01: reasoning / language", "size": 4, "topTerms": ["reasoning", "language"], "method": "hdbscan-test"},
            {"id": "embedding-cluster-002", "label": "Cluster 02: mechanistic / interpretability", "size": 4, "topTerms": ["mechanistic", "interpretability"], "method": "hdbscan-test"},
        ]
        assignments = {}
        for record_id, vector in zip(ids, vectors):
            cluster = clusters[0] if vector[0] > 0 else clusters[1]
            assignments[record_id] = {
                "id": cluster["id"],
                "label": cluster["label"],
                "size": cluster["size"],
                "keywords": cluster["topTerms"],
                "method": cluster["method"],
            }
        return assignments, clusters

    original_project_vectors = builder.project_vectors
    original_build_embedding_clusters = builder.build_embedding_clusters
    builder.project_vectors = lambda source, dimension: [
        (vector + [0.0] * dimension)[:dimension]
        for vector in source
    ]
    builder.build_embedding_clusters = fake_embedding_clusters
    try:
        map_payload, sidecar = builder.build_semantic_payload(
            records,
            vectors,
            payloads,
            {"sourceFingerprint": "sha256:test"},
            embedding_cluster_min_size=2,
            embedding_cluster_min_samples=1,
        )
    finally:
        builder.project_vectors = original_project_vectors
        builder.build_embedding_clusters = original_build_embedding_clusters
    area_cluster_ids = {record["clusterId"] for record in map_payload["records"]}
    embedding_cluster_ids = {
        record["embeddingClusterId"]
        for record in map_payload["records"]
        if record["embeddingClusterId"] != "embedding-noise"
    }
    sidecar_cluster_ids = {
        item["embeddingClusterId"]
        for item in sidecar["records"].values()
        if item["embeddingClusterId"] != "embedding-noise"
    }
    assert area_cluster_ids == {"cluster-llms"}
    assert len(embedding_cluster_ids) >= 2
    assert embedding_cluster_ids == sidecar_cluster_ids
    assert map_payload["embeddingClusters"]
    assert [level["k"] for level in map_payload["embeddingClusterLevels"]] == [5, 8, 8, 8, 8, 8]
    assert len(map_payload["embeddingClusterLevels"][0]["assignments"]) == len(records)
    label_tokens = " ".join(
        token
        for cluster in map_payload["embeddingClusters"]
        for token in cluster.get("topTerms", [])
    )
    assert "conference" not in label_tokens
    assert "paper" not in label_tokens


def test_search_embedding_payload_is_quantized_and_excludes_posters() -> None:
    builder = importlib.import_module("scripts.build_icml_embedding_map")
    records = [
        {"id": "paper-1", "type": "paper"},
        {"id": "poster-1", "type": "poster"},
        {"id": "workshop-1", "type": "workshop"},
    ]
    vectors = [[1.0, -1.0], [0.0, 1.0], [0.25, -0.25]]
    payloads = [{"quality": "title_only"}, {"quality": "title_only"}, {"quality": "title_topic"}]
    source = {"sourceFingerprint": "sha256:test"}
    payload = builder.build_search_embeddings_payload(records, vectors, payloads, "m", "k", source)
    assert payload["model"]["quantization"] == "int8_symmetric_base64"
    assert payload["embeddingSource"] == source
    assert [item["id"] for item in payload["records"]] == ["paper-1", "workshop-1"]
    assert payload["records"][0]["vector"]


def run() -> None:
    test_semantic_config_exports_taxonomies()
    test_validate_tags_rejects_unknown_values()
    test_build_embedding_text_quality_levels()
    test_smoke_embedder_is_deterministic()
    test_lexical_embedder_prefers_shared_terms()
    test_infer_controlled_tags_uses_area_and_domain_keywords()
    test_compute_neighbors_resolves_known_ids()
    test_embedding_clusters_are_not_area_aliases()
    test_search_embedding_payload_is_quantized_and_excludes_posters()
    print("embedding map unit tests passed")


if __name__ == "__main__":
    run()
