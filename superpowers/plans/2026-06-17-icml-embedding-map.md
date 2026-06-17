# ICML Embedding Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline-generated semantic embedding map with `areaTags`, `domainTags`, 2D/3D coordinates, nearest neighbors, and a static GitHub Pages UI.

**Architecture:** Keep GitHub Pages static. Build semantic metadata offline from existing manifests/index data, cache local scientific embeddings, export `docs/site/data/icml2026_map.json`, and enrich `docs/site/data/icml2026_index.json` with semantic fields. The browser loads both JSON files, adds a dedicated Map tab, and shows a nearest-neighbor mini map in the selected-record viewer.

**Tech Stack:** Python 3 scripts, `sentence-transformers` with a SPECTER/SPECTER2-style local model, NumPy/scikit-learn/UMAP for offline analysis, static HTML/CSS/vanilla JS for the browser, Playwright for deployed UI checks.

---

## File Structure

- Create `scripts/icml_semantic_config.py`: controlled `AREA_TAGS`, `DOMAIN_TAGS`, keyword hints, embedding model id, cache constants, and helper validation.
- Create `scripts/build_icml_embedding_map.py`: offline builder for text payloads, local scientific embeddings, nearest neighbors, UMAP coordinates, clusters, controlled tags, and static JSON export.
- Create `scripts/verify_embedding_map.py`: validates `icml2026_index.json` and `icml2026_map.json` consistency.
- Modify `scripts/build_site.sh`: run site index builder, embedding map builder in fast cached mode, and both verifiers.
- Modify `scripts/build_icml_site.py`: carry semantic fields if a semantic sidecar already exists, while still working before the map exists.
- Modify `docs/site/app.js`: load map JSON, add Map tab behavior, map filtering, selected-point panel, and viewer mini map.
- Modify `docs/site/styles.css`: add map layout, scatter plot, tooltip, panel, mini map, and responsive behavior.
- Modify `docs/index.html`: add `Map` tab button and a map panel container.
- Create `scripts/test_embedding_map_units.py`: fast Python unit tests for text quality, taxonomy validation, map JSON shape, neighbor resolution, and deterministic smoke-mode build.
- Update `README.md` and `GITHUB_PAGES.md`: document semantic map generation, model/cache behavior, and verification commands.

## Implementation Tasks

### Task 1: Add Semantic Config And Unit Test Harness

**Files:**
- Create: `scripts/icml_semantic_config.py`
- Create: `scripts/test_embedding_map_units.py`

- [ ] **Step 1: Create failing tests for taxonomy constants and validators**

Create `scripts/test_embedding_map_units.py` with:

```python
#!/usr/bin/env python3
from __future__ import annotations

import importlib


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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
python3 scripts/test_embedding_map_units.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.icml_semantic_config'`.

- [ ] **Step 3: Implement semantic config**

Create `scripts/icml_semantic_config.py` with:

```python
#!/usr/bin/env python3
"""Shared semantic-map configuration for the ICML 2026 browser."""

from __future__ import annotations

from pathlib import Path


EMBEDDING_MODEL_ID = "allenai/specter2_base"
EMBEDDING_MODEL_KIND = "specter-like"
MAP_RANDOM_SEED = 42
NEIGHBOR_COUNT = 12
ROOT = Path(__file__).resolve().parents[1]
SEMANTIC_CACHE = ROOT / ".cache" / "icml_semantic"
INDEX_PATH = ROOT / "docs" / "site" / "data" / "icml2026_index.json"
MAP_PATH = ROOT / "docs" / "site" / "data" / "icml2026_map.json"
SEMANTIC_SIDECAR_PATH = ROOT / "docs" / "site" / "data" / "icml2026_semantic_sidecar.json"

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
    "Vision": ("vision", "image", "video", "3d", "segmentation", "visual"),
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
```

- [ ] **Step 4: Make `scripts` importable for tests**

Create `scripts/__init__.py` with:

```python
"""Local script modules for the ICML 2026 Materials Browser."""
```

- [ ] **Step 5: Run the tests and verify they pass**

Run:

```bash
python3 scripts/test_embedding_map_units.py
```

Expected: command exits with status 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/__init__.py scripts/icml_semantic_config.py scripts/test_embedding_map_units.py
git commit -m "Add semantic map configuration"
```

### Task 2: Build Text Payloads And Deterministic Smoke Embeddings

**Files:**
- Modify: `scripts/test_embedding_map_units.py`
- Create: `scripts/build_icml_embedding_map.py`

- [ ] **Step 1: Add tests for text payload quality and smoke embeddings**

Append to `scripts/test_embedding_map_units.py`:

```python
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 scripts/test_embedding_map_units.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.build_icml_embedding_map'`.

- [ ] **Step 3: Implement text payload builder and smoke embedder**

Create `scripts/build_icml_embedding_map.py` with:

```python
#!/usr/bin/env python3
"""Build semantic map data for the static ICML 2026 browser."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts import icml_semantic_config as config


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def build_embedding_text(record: dict[str, Any]) -> dict[str, str]:
    parts: list[str] = []
    title = normalize_text(record.get("title"))
    abstract = normalize_text(record.get("abstract"))
    group = normalize_text(record.get("group"))
    category = normalize_text(record.get("category"))
    item_type = normalize_text(record.get("type"))

    if title:
        parts.append(f"Title: {title}")
    if abstract:
        parts.append(f"Abstract: {abstract}")
        quality = "title_abstract"
    elif group or category:
        fallback = " ".join(part for part in [category, group] if part)
        parts.append(f"Context: {fallback}")
        quality = "title_topic"
    elif title:
        quality = "title_only"
    else:
        quality = "unavailable"
    if item_type:
        parts.append(f"Record type: {item_type}")

    return {"text": "\n".join(parts), "quality": quality}


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", help="Use deterministic smoke embeddings instead of the local scientific model.")
    parser.add_argument("--limit", type=int, default=0, help="Limit records for fast development checks. Zero means all records.")
    args = parser.parse_args()
    index = read_json(config.INDEX_PATH)
    records = index.get("records", [])
    if args.limit:
        records = records[: args.limit]
    payloads = [build_embedding_text(record) for record in records]
    embedder = SmokeEmbedder() if args.smoke else SmokeEmbedder()
    vectors = embedder.encode([payload["text"] for payload in payloads])
    map_records = [
        {
            "id": record["id"],
            "x": vector[0],
            "y": vector[1],
            "z": vector[2],
            "clusterId": "cluster-smoke",
            "nearestNeighbors": [],
        }
        for record, vector in zip(records, vectors)
    ]
    map_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": {
            "id": "smoke-deterministic" if args.smoke else config.EMBEDDING_MODEL_ID,
            "kind": "smoke" if args.smoke else config.EMBEDDING_MODEL_KIND,
            "dimension": len(vectors[0]) if vectors else 0,
        },
        "projection": {"method": "smoke", "randomSeed": config.MAP_RANDOM_SEED},
        "records": map_records,
        "clusters": [{"id": "cluster-smoke", "label": "Smoke cluster", "size": len(map_records), "topTerms": []}],
    }
    semantic_sidecar = {
        record["id"]: {
            "areaTags": record.get("categoryTags") or [record.get("category") or "Other"],
            "domainTags": ["General"],
            "clusterId": "cluster-smoke",
            "clusterLabel": "Smoke cluster",
            "classificationConfidence": 0.1,
            "classificationReason": "Deterministic smoke-mode metadata.",
            "embeddingTextQuality": payload["quality"],
            "mapAvailable": True,
        }
        for record, payload in zip(records, payloads)
    }
    write_json(config.MAP_PATH, map_payload)
    write_json(config.SEMANTIC_SIDECAR_PATH, {"records": semantic_sidecar})
    counts = Counter(item["embeddingTextQuality"] for item in semantic_sidecar.values())
    print(f"Wrote {config.MAP_PATH.relative_to(config.ROOT)}")
    print(f"Wrote {config.SEMANTIC_SIDECAR_PATH.relative_to(config.ROOT)}")
    print(json.dumps({"records": len(map_records), "textQuality": counts}, default=dict, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests and smoke builder**

Run:

```bash
python3 scripts/test_embedding_map_units.py
python3 scripts/build_icml_embedding_map.py --smoke --limit 25
```

Expected: tests pass and builder writes `docs/site/data/icml2026_map.json` plus `docs/site/data/icml2026_semantic_sidecar.json`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_icml_embedding_map.py scripts/test_embedding_map_units.py docs/site/data/icml2026_map.json docs/site/data/icml2026_semantic_sidecar.json
git commit -m "Add semantic map smoke builder"
```

### Task 3: Add Real Local Scientific Embedding Backend

**Files:**
- Modify: `scripts/build_icml_embedding_map.py`
- Modify: `README.md`

- [ ] **Step 1: Add dependency check behavior**

Modify `scripts/build_icml_embedding_map.py` by replacing the `embedder = ...` line in `main()` with:

```python
    embedder = SmokeEmbedder() if args.smoke else ScientificEmbedder(config.EMBEDDING_MODEL_ID)
```

Then add this class above `main()`:

```python
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
```

- [ ] **Step 2: Document dependency installation**

Add this section to `README.md`:

````markdown
## Semantic Map Build

The semantic map is generated offline. For real scientific embeddings, install:

```bash
python3 -m pip install sentence-transformers umap-learn scikit-learn numpy
```

For fast smoke checks without model downloads:

```bash
python3 scripts/build_icml_embedding_map.py --smoke --limit 100
```
````

- [ ] **Step 3: Verify smoke mode still works**

Run:

```bash
python3 scripts/test_embedding_map_units.py
python3 scripts/build_icml_embedding_map.py --smoke --limit 25
```

Expected: both commands pass without downloading a model.

- [ ] **Step 4: Commit**

```bash
git add scripts/build_icml_embedding_map.py README.md
git commit -m "Add scientific embedding backend"
```

### Task 4: Implement Neighbors, UMAP Coordinates, Clusters, And Tags

**Files:**
- Modify: `scripts/build_icml_embedding_map.py`
- Modify: `scripts/test_embedding_map_units.py`

- [ ] **Step 1: Add tests for tag inference and neighbor links**

Append to `scripts/test_embedding_map_units.py`:

```python
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 scripts/test_embedding_map_units.py
```

Expected: FAIL because `infer_controlled_tags` and `compute_neighbors` do not exist.

- [ ] **Step 3: Add tag inference and cosine neighbors**

Add these functions to `scripts/build_icml_embedding_map.py`:

```python
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
```

- [ ] **Step 4: Add UMAP projection with deterministic fallback**

Add:

```python
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
```

- [ ] **Step 5: Wire real neighbors/tags/projections into `main()`**

Replace the `map_records = [...]` block in `main()` with:

```python
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
```

Then replace the `clusters` value inside `map_payload` with:

```python
        "clusters": clusters,
```

Remove the old `semantic_sidecar = {...}` block.

- [ ] **Step 6: Run tests and smoke build**

Run:

```bash
python3 scripts/test_embedding_map_units.py
python3 scripts/build_icml_embedding_map.py --smoke --limit 200
```

Expected: tests pass; smoke builder exports map records with neighbor links and controlled tags.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_icml_embedding_map.py scripts/test_embedding_map_units.py docs/site/data/icml2026_map.json docs/site/data/icml2026_semantic_sidecar.json
git commit -m "Generate semantic map metadata"
```

### Task 5: Merge Semantic Sidecar Into Site Index And Verify Contract

**Files:**
- Modify: `scripts/build_icml_site.py`
- Create: `scripts/verify_embedding_map.py`
- Modify: `scripts/build_site.sh`

- [ ] **Step 1: Add sidecar loading to `build_icml_site.py`**

Add near the top after `OUT = ...`:

```python
SEMANTIC_SIDECAR = ROOT / "docs" / "site" / "data" / "icml2026_semantic_sidecar.json"
```

Add:

```python
def read_semantic_sidecar() -> dict[str, dict[str, Any]]:
    if not SEMANTIC_SIDECAR.exists():
        return {}
    payload = json.loads(SEMANTIC_SIDECAR.read_text(encoding="utf-8"))
    records = payload.get("records", {})
    return records if isinstance(records, dict) else {}
```

Change `def compact_record(source: dict[str, Any], item_type: str, group: str) -> dict[str, Any]:` to:

```python
def compact_record(source: dict[str, Any], item_type: str, group: str, semantic: dict[str, dict[str, Any]]) -> dict[str, Any]:
```

Before `return {`, add:

```python
    semantic_fields = semantic.get(item_id, {})
```

Inside the returned dict, add:

```python
        "areaTags": semantic_fields.get("areaTags", []),
        "domainTags": semantic_fields.get("domainTags", []),
        "clusterId": semantic_fields.get("clusterId"),
        "clusterLabel": semantic_fields.get("clusterLabel"),
        "classificationConfidence": semantic_fields.get("classificationConfidence"),
        "classificationReason": semantic_fields.get("classificationReason", ""),
        "embeddingTextQuality": semantic_fields.get("embeddingTextQuality", "unavailable"),
        "mapAvailable": bool(semantic_fields.get("mapAvailable", False)),
```

In `build()`, add:

```python
    semantic = read_semantic_sidecar()
```

Pass `semantic` to every `compact_record(...)` call.

- [ ] **Step 2: Create map verifier**

Create `scripts/verify_embedding_map.py` with:

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from scripts import icml_semantic_config as config


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    index_path = Path(sys.argv[1]) if len(sys.argv) > 1 else config.INDEX_PATH
    map_path = Path(sys.argv[2]) if len(sys.argv) > 2 else config.MAP_PATH
    index = load(index_path)
    map_data = load(map_path)
    index_records = index.get("records", [])
    visible_ids = {str(record["id"]) for record in index_records}
    map_records = map_data.get("records", [])
    map_ids = {str(record["id"]) for record in map_records}
    errors: list[str] = []

    for record in map_records:
        record_id = str(record.get("id"))
        if record_id not in visible_ids:
            errors.append(f"map record does not exist in index: {record_id}")
        for key in ("x", "y", "z"):
            value = record.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                errors.append(f"invalid coordinate {key} for {record_id}: {value}")
        for neighbor in record.get("nearestNeighbors", []):
            neighbor_id = str(neighbor.get("id"))
            if neighbor_id not in visible_ids:
                errors.append(f"neighbor target missing for {record_id}: {neighbor_id}")

    for record in index_records:
        record_id = str(record["id"])
        if record.get("mapAvailable"):
            if record_id not in map_ids:
                errors.append(f"index says mapAvailable but map record is missing: {record_id}")
            errors.extend(f"unknown area tag for {record_id}: {tag}" for tag in config.validate_area_tags(record.get("areaTags") or []))
            errors.extend(f"unknown domain tag for {record_id}: {tag}" for tag in config.validate_domain_tags(record.get("domainTags") or []))
            if record.get("embeddingTextQuality") not in {"title_abstract", "title_topic", "title_only"}:
                errors.append(f"invalid embeddingTextQuality for {record_id}: {record.get('embeddingTextQuality')}")

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


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Update build script**

In `scripts/build_site.sh`, after `python3 scripts/build_icml_site.py`, add:

```bash
if [[ "${ICML_BUILD_SEMANTIC_MAP:-1}" == "1" ]]; then
  python3 scripts/build_icml_embedding_map.py ${ICML_SEMANTIC_ARGS:---smoke}
  python3 scripts/build_icml_site.py
  python3 scripts/verify_embedding_map.py "$INDEX_PATH" docs/site/data/icml2026_map.json
fi
```

- [ ] **Step 4: Verify full smoke build**

Run:

```bash
ICML_SEMANTIC_ARGS="--smoke --limit 500" scripts/build_site.sh
```

Expected: site contract verification and embedding map verification both pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_icml_site.py scripts/build_site.sh scripts/verify_embedding_map.py docs/site/data/icml2026_index.json docs/site/data/icml2026_map.json docs/site/data/icml2026_semantic_sidecar.json
git commit -m "Merge semantic map metadata into site index"
```

### Task 6: Add Map Tab UI

**Files:**
- Modify: `docs/index.html`
- Modify: `docs/site/app.js`
- Modify: `docs/site/styles.css`

- [ ] **Step 1: Add Map tab and panel container**

In `docs/index.html`, add after the Workshops tab:

```html
<button class="tab" data-tab="map" type="button">Map</button>
```

Inside `<section class="browser-panel" ...>`, after the `results` div, add:

```html
<div class="map-view" id="mapView" hidden>
  <div class="map-toolbar">
    <label>
      <span>Color</span>
      <select id="mapColorSelect">
        <option value="area">Area</option>
        <option value="domain">Domain</option>
        <option value="cluster">Cluster</option>
        <option value="quality">Text quality</option>
        <option value="availability">Availability</option>
      </select>
    </label>
    <label>
      <span>Mode</span>
      <select id="mapModeSelect">
        <option value="2d">2D</option>
        <option value="3d">3D</option>
      </select>
    </label>
  </div>
  <div class="map-canvas" id="mapCanvas" aria-label="Semantic paper map"></div>
</div>
```

- [ ] **Step 2: Extend JS state and element bindings**

In `docs/site/app.js`, add:

```js
const MAP_URL = "site/data/icml2026_map.json";
```

Extend `state` with:

```js
  mapData: null,
  mapColor: "area",
  mapMode: "2d",
```

Extend `els` with:

```js
  mapView: document.querySelector("#mapView"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapColor: document.querySelector("#mapColorSelect"),
  mapMode: document.querySelector("#mapModeSelect"),
```

- [ ] **Step 3: Load map data**

In `init()`, after loading the main index:

```js
  try {
    const mapResponse = await fetch(MAP_URL);
    state.mapData = mapResponse.ok ? await mapResponse.json() : null;
  } catch {
    state.mapData = null;
  }
```

- [ ] **Step 4: Add map rendering helpers**

Add to `docs/site/app.js`:

```js
function mapRecordById() {
  const records = state.mapData?.records || [];
  return new Map(records.map((record) => [record.id, record]));
}

function mapColorValue(record) {
  if (state.mapColor === "domain") return (record.domainTags || ["General"])[0] || "General";
  if (state.mapColor === "cluster") return record.clusterLabel || "Cluster";
  if (state.mapColor === "quality") return record.embeddingTextQuality || "unavailable";
  if (state.mapColor === "availability") return record.availabilityLabel || "Metadata";
  return (record.areaTags || record.categoryTags || ["Other"])[0] || "Other";
}

function colorForValue(value) {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 68% 42%)`;
}

function renderMap() {
  if (state.tab !== "map") return;
  if (!state.mapData?.records?.length) {
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No map data</strong><span>Run the semantic map builder.</span></div>`;
    return;
  }
  const mapById = mapRecordById();
  const visibleRecords = getFilteredRecords().filter((record) => record.mapAvailable && mapById.has(record.id));
  if (!visibleRecords.length) {
    els.mapCanvas.innerHTML = `<div class="empty-state"><strong>No mapped records</strong><span>Adjust the filters.</span></div>`;
    return;
  }
  const points = visibleRecords.map((record) => ({ record, map: mapById.get(record.id) }));
  const xs = points.map((item) => item.map.x);
  const ys = points.map((item) => item.map.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = (value, min, max) => max === min ? 50 : 5 + ((value - min) / (max - min)) * 90;
  els.mapCanvas.innerHTML = points.map(({ record, map }) => {
    const colorValue = mapColorValue(record);
    const left = scale(map.x, minX, maxX);
    const top = 100 - scale(map.y, minY, maxY);
    return `<button class="map-point" type="button" data-id="${escapeHtml(record.id)}" style="left:${left}%;top:${top}%;background:${colorForValue(colorValue)}" title="${escapeHtml(plainMathTitle(record.title))}"></button>`;
  }).join("");
  els.mapCanvas.querySelectorAll(".map-point").forEach((point) => {
    point.addEventListener("click", () => {
      state.selectedId = point.dataset.id;
      const selected = state.data.records.find((record) => record.id === state.selectedId);
      renderViewer(selected);
      renderResults();
    });
  });
}
```

- [ ] **Step 5: Wire tab visibility**

In `renderAll()`, add:

```js
  const isMap = state.tab === "map";
  els.results.hidden = isMap;
  els.mapView.hidden = !isMap;
```

Then call `renderMap()` at the end of `renderAll()` and after filter changes.

- [ ] **Step 6: Add map styles**

Add to `docs/site/styles.css`:

```css
.map-view {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  flex: 1;
}

.map-view[hidden] {
  display: none;
}

.map-toolbar {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.map-canvas {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: #f8fafc;
}

.map-point {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid white;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgb(15 23 42 / 0.22);
  transform: translate(-50%, -50%);
  cursor: pointer;
}

.map-point:hover,
.map-point:focus-visible {
  width: 14px;
  height: 14px;
  z-index: 2;
}
```

- [ ] **Step 7: Run local UI smoke**

Run:

```bash
ICML_SEMANTIC_ARGS="--smoke --limit 500" scripts/build_site.sh
python3 -m http.server 8795
```

Then use Playwright to assert that Map tab exists and points render.

- [ ] **Step 8: Commit**

```bash
git add docs/index.html docs/site/app.js docs/site/styles.css docs/site/data/icml2026_index.json docs/site/data/icml2026_map.json docs/site/data/icml2026_semantic_sidecar.json
git commit -m "Add semantic map tab"
```

### Task 7: Add Viewer Mini Map And Neighbor Navigation

**Files:**
- Modify: `docs/site/app.js`
- Modify: `docs/site/styles.css`

- [ ] **Step 1: Add mini map renderer**

Add to `docs/site/app.js`:

```js
function renderMiniMap(record) {
  if (!record?.mapAvailable || !state.mapData?.records?.length) return "";
  const mapById = mapRecordById();
  const center = mapById.get(record.id);
  if (!center) return "";
  const neighborIds = (center.nearestNeighbors || []).slice(0, 6).map((item) => item.id);
  const neighbors = neighborIds
    .map((id) => ({ record: state.data.records.find((item) => item.id === id), map: mapById.get(id), score: (center.nearestNeighbors || []).find((item) => item.id === id)?.score }))
    .filter((item) => item.record && item.map);
  const points = [{ record, map: center, score: 1, center: true }, ...neighbors];
  return `
    <section class="mini-map-panel">
      <h3>Related papers</h3>
      <div class="mini-map">
        ${points.map((item) => `<button class="mini-map-point ${item.center ? "is-center" : ""}" type="button" data-id="${escapeHtml(item.record.id)}" style="left:${50 + (item.map.x - center.x) * 18}%;top:${50 - (item.map.y - center.y) * 18}%;" title="${escapeHtml(plainMathTitle(item.record.title))}"></button>`).join("")}
      </div>
      <div class="neighbor-list">
        ${neighbors.map((item) => `<button type="button" class="neighbor-item" data-id="${escapeHtml(item.record.id)}"><strong>${escapeHtml(plainMathTitle(item.record.title))}</strong><span>${Number(item.score || 0).toFixed(2)} similarity</span></button>`).join("")}
      </div>
    </section>
  `;
}
```

- [ ] **Step 2: Insert mini map in `renderViewer(record)`**

After setting `els.viewerFrame.innerHTML`, add:

```js
  const miniMap = renderMiniMap(record);
  if (miniMap) {
    els.viewerFrame.insertAdjacentHTML("beforeend", miniMap);
    els.viewerFrame.querySelectorAll(".mini-map-point, .neighbor-item").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = state.data.records.find((item) => item.id === button.dataset.id);
        state.selectedId = button.dataset.id;
        renderResults();
        renderViewer(selected);
      });
    });
  }
```

- [ ] **Step 3: Add mini map styles**

Add to `docs/site/styles.css`:

```css
.mini-map-panel {
  margin: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.mini-map-panel h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.mini-map {
  position: relative;
  height: 160px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f8fafc;
}

.mini-map-point {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid white;
  border-radius: 50%;
  background: var(--accent);
  transform: translate(-50%, -50%);
  cursor: pointer;
}

.mini-map-point.is-center {
  width: 14px;
  height: 14px;
  background: var(--bad);
}

.neighbor-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.neighbor-item {
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}

.neighbor-item span {
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 4: Verify mini map behavior**

Run Playwright against local server:

```bash
node - <<'NODE'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto('http://localhost:8795/docs/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.result-item');
  await page.locator('.result-item').first().click();
  await page.waitForSelector('.mini-map-panel');
  const count = await page.locator('.neighbor-item').count();
  if (count === 0) throw new Error('Expected neighbor items');
  console.log({ neighborItems: count });
  await browser.close();
})();
NODE
```

Expected: prints a positive neighbor item count.

- [ ] **Step 5: Commit**

```bash
git add docs/site/app.js docs/site/styles.css
git commit -m "Add related papers mini map"
```

### Task 8: Final Verification, Deploy, And Document

**Files:**
- Modify: `README.md`
- Modify: `GITHUB_PAGES.md`

- [ ] **Step 1: Update docs**

Add to `GITHUB_PAGES.md`:

````markdown
## Semantic Map

The Map tab is static. Generate semantic data before deploying:

```bash
ICML_SEMANTIC_ARGS="--smoke --limit 500" scripts/build_site.sh
```

For a full scientific embedding build, install the semantic dependencies listed in `README.md` and run:

```bash
ICML_SEMANTIC_ARGS="" scripts/build_site.sh
```
````

- [ ] **Step 2: Run all local verification**

Run:

```bash
python3 scripts/test_embedding_map_units.py
ICML_SEMANTIC_ARGS="--smoke --limit 500" scripts/build_site.sh
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Run local browser QA**

Start local server:

```bash
python3 -m http.server 8795
```

Run Playwright checks for:

- Map tab visible
- map points render
- clicking a point selects a record
- mini map renders for selected mapped record
- Paper tab remains hidden when paper count is 0
- Workshop MoSE PDF still opens through PDF.js without download

- [ ] **Step 4: Commit docs**

```bash
git add README.md GITHUB_PAGES.md
git commit -m "Document semantic map build"
```

- [ ] **Step 5: Push main**

```bash
git push origin main
```

- [ ] **Step 6: Deploy `docs/` to `gh-pages`**

```bash
TMP_DIR="$(mktemp -d /tmp/icml-pages.XXXXXX)"
git fetch origin gh-pages
git worktree add -B gh-pages "$TMP_DIR" origin/gh-pages
rsync -a --delete --exclude=.git docs/ "$TMP_DIR"/
git -C "$TMP_DIR" add -A
git -C "$TMP_DIR" commit -m "Deploy semantic map"
git -C "$TMP_DIR" push origin gh-pages
git worktree remove "$TMP_DIR"
```

- [ ] **Step 7: Verify deployed site**

Run Playwright against:

```text
https://kimyeonghyeon.github.io/icml-2026-materials-browser/
```

Expected deployed evidence:

- Map tab appears
- map points render
- selecting a point opens record metadata
- selected record mini map shows related papers
- MoSE PDF still uses PDF.js and does not trigger browser download

## Plan Self-Review

- Spec coverage: data pipeline, taxonomies, static data interfaces, Map tab, mini map, failure handling, and verification each have implementation tasks.
- Placeholder scan: no unresolved placeholder markers are intentionally left in the plan.
- Type consistency: semantic field names match the design spec: `areaTags`, `domainTags`, `clusterId`, `clusterLabel`, `classificationConfidence`, `classificationReason`, `embeddingTextQuality`, `mapAvailable`.
