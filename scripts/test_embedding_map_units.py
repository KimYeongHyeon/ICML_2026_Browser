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


def run() -> None:
    test_semantic_config_exports_taxonomies()
    test_validate_tags_rejects_unknown_values()
    test_build_embedding_text_quality_levels()
    test_smoke_embedder_is_deterministic()
    test_lexical_embedder_prefers_shared_terms()
    test_infer_controlled_tags_uses_area_and_domain_keywords()
    test_compute_neighbors_resolves_known_ids()
    print("embedding map unit tests passed")


if __name__ == "__main__":
    run()
