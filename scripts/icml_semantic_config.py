#!/usr/bin/env python3
"""Shared semantic-map configuration for the ICML 2026 browser."""

from __future__ import annotations

from pathlib import Path


EMBEDDING_MODEL_ID = "allenai/specter2_base"
EMBEDDING_MODEL_KIND = "specter-like"
QUERY_EMBEDDING_MODEL_ID = "benchoi93/specter2-base-onnx-web"
MAP_RANDOM_SEED = 42
NEIGHBOR_COUNT = 12
EMBEDDING_CLUSTER_MIN_SIZE = 30
EMBEDDING_CLUSTER_MIN_SAMPLES = 8
ROOT = Path(__file__).resolve().parents[1]
SEMANTIC_CACHE = ROOT / ".cache" / "icml_semantic"
INDEX_PATH = ROOT / "docs" / "site" / "data" / "icml2026_index.json"
MAP_PATH = ROOT / "docs" / "site" / "data" / "icml2026_map.json"
SEMANTIC_SIDECAR_PATH = ROOT / "docs" / "site" / "data" / "icml2026_semantic_sidecar.json"
SEARCH_EMBEDDINGS_PATH = ROOT / "docs" / "site" / "data" / "icml2026_search_embeddings.json"
TRENDS_PATH = ROOT / "docs" / "site" / "data" / "icml2026_trends.json"

AREA_TAGS = [
    "LLMs",
    "Reinforcement Learning",
    "Vision",
    "Optimization",
    "Theory",
    "Systems",
    "Safety",
    "Generative Models",
    "Agents",
    "Evaluation",
    "Multimodal Learning",
    "Probabilistic Methods",
    "Other",
]

DOMAIN_TAGS = [
    "Biology",
    "Medical",
    "Climate",
    "Robotics",
    "Chemistry",
    "Materials",
    "Education",
    "Social Science",
    "Finance",
    "Scientific Discovery",
    "General",
]

AREA_KEYWORDS = {
    "LLMs": ("llm", "language model", "transformer", "token", "prompt", "reasoning"),
    "Reinforcement Learning": ("reinforcement", "policy", "reward", "bandit", "control"),
    "Vision": ("vision", "image", "video", "3d", "segmentation", "visual", "multimodal"),
    "Optimization": ("optimization", "optimizer", "gradient", "bayesian optimization", "search"),
    "Theory": ("theorem", "proof", "bound", "geometry", "graph", "convergence"),
    "Systems": ("efficient", "serving", "cache", "compression", "quantization", "systems"),
    "Safety": ("safety", "privacy", "fairness", "robust", "adversarial", "uncertainty"),
    "Generative Models": ("diffusion", "generation", "generative", "flow", "vae"),
    "Agents": ("agent", "tool", "planning", "workflow", "autonomous"),
    "Evaluation": ("benchmark", "evaluation", "metric", "dataset", "assessment"),
    "Multimodal Learning": ("multimodal", "vision-language", "vlm", "audio-visual"),
    "Probabilistic Methods": ("bayesian", "probabilistic", "posterior", "uncertainty"),
}

DOMAIN_KEYWORDS = {
    "Biology": ("protein", "rna", "dna", "gene", "cell", "bio", "drug", "molecule"),
    "Medical": ("clinical", "medical", "health", "patient", "disease", "ehr", "diagnosis"),
    "Climate": ("climate", "weather", "earth", "forecast", "carbon"),
    "Robotics": ("robot", "robotics", "manipulation", "navigation", "embodied"),
    "Chemistry": ("chemistry", "chemical", "molecular", "reaction"),
    "Materials": ("material", "crystal", "polymer", "alloy"),
    "Education": ("education", "student", "tutor", "learning analytics"),
    "Social Science": ("social", "human", "culture", "policy", "survey"),
    "Finance": ("finance", "market", "trading", "portfolio"),
    "Scientific Discovery": ("science", "scientific", "discovery", "experiment", "simulation"),
}


def validate_area_tags(tags: list[str]) -> list[str]:
    allowed = set(AREA_TAGS)
    return [tag for tag in tags if tag not in allowed]


def validate_domain_tags(tags: list[str]) -> list[str]:
    allowed = set(DOMAIN_TAGS)
    return [tag for tag in tags if tag not in allowed]
