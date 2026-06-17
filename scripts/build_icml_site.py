#!/usr/bin/env python3
"""Build the static ICML 2026 browser data used by the GitHub Pages UI."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "icml_2026_materials"
OUT = ROOT / os.environ.get("ICML_SITE_INDEX", "docs/site/data/icml2026_index.json")
SEMANTIC_SIDECAR = ROOT / "docs" / "site" / "data" / "icml2026_semantic_sidecar.json"
GENERIC_WORKSHOP_TITLES = {
    "call for papers",
    "official workshop page",
    "program",
    "schedule",
    "workshop program or schedule page",
}


CATEGORIES: list[tuple[str, tuple[str, ...]]] = [
    ("Medical & Health", ("clinical", "medical", "health", "patient", "disease", "ehr", "radiology", "diagnosis")),
    ("Biology & Drug Discovery", ("protein", "rna", "dna", "genomic", "gene", "molecule", "molecular", "drug", "peptide", "cell", "bio", "binder")),
    ("AI4Science", ("science", "scientific", "discovery", "equation", "microscopy", "materials", "chemistry", "physics", "simulation", "pde")),
    ("Agents & Tools", ("agent", "tool", "workflow", "planning", "orchestration", "autonomous")),
    ("LLMs & Foundation Models", ("llm", "language model", "foundation model", "transformer", "token", "prompt", "reasoning", "alignment")),
    ("Vision & Multimodal", ("vision", "image", "video", "multimodal", "vlm", "3d", "point cloud", "segmentation")),
    ("Reinforcement Learning", ("reinforcement", "rl", "policy", "reward", "bandit", "control")),
    ("Optimization", ("optimization", "bayesian optimization", "gradient", "optimizer", "search", "sampling")),
    ("Theory & Math", ("theory", "theorem", "proof", "bound", "geometry", "graph", "math")),
    ("Robustness & Safety", ("robust", "safety", "privacy", "fairness", "uncertainty", "adversarial", "calibration", "security")),
    ("Climate & Earth", ("climate", "weather", "earth", "forecast", "extreme weather")),
    ("Systems & Efficiency", ("efficient", "compression", "quantization", "pruning", "cache", "serving", "inference", "systems")),
    ("Evaluation & Benchmarks", ("benchmark", "evaluation", "dataset", "metric", "test-time", "assessment")),
]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def read_semantic_sidecar() -> dict[str, dict[str, Any]]:
    if not SEMANTIC_SIDECAR.exists():
        return {}
    payload = json.loads(SEMANTIC_SIDECAR.read_text(encoding="utf-8"))
    records = payload.get("records", {})
    return records if isinstance(records, dict) else {}


def as_author_string(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if v)
    return str(value or "")


def rel(path: str | None) -> str:
    if not path:
        return ""
    return path.replace("\\", "/").lstrip("/")


def classify_availability(
    *,
    has_pdf: bool,
    has_poster: bool,
    has_slide: bool,
    status: str,
    failure_reason: str,
) -> tuple[str, str]:
    if has_pdf or has_poster or has_slide:
        return "downloaded", "Downloaded"

    text = f"{status} {failure_reason}".lower()
    if "blocked" in text or "403" in text or "429" in text or "rate limit" in text:
        return "blocked", "Blocked"
    if status in {"skipped", "failed"} or "not a direct downloadable file" in text:
        return "unavailable", "Unavailable / skipped"
    return "metadata", "Metadata only"


def infer_categories(title: str, group: str) -> list[str]:
    haystack = f"{title} {group}".lower()
    matches: list[str] = []
    for category, keywords in CATEGORIES:
        if any(keyword in haystack for keyword in keywords):
            matches.append(category)
    return matches or ["Other"]


def should_include_workshop_row(source: dict[str, Any]) -> bool:
    source_type = source.get("source_type")
    title = str(source.get("title") or "").strip().lower()
    return (
        source_type == "openreview_submission"
        and source.get("status") == "accepted_public"
        and title not in GENERIC_WORKSHOP_TITLES
    )


def should_include_paper_row(source: dict[str, Any]) -> bool:
    page_url = str(source.get("paper_url") or "")
    has_public_pdf = bool(source.get("local_pdf_path") or source.get("pdf_url"))
    return has_public_pdf and "/poster/" not in page_url


def compact_record(source: dict[str, Any], item_type: str, group: str, semantic: dict[str, dict[str, Any]]) -> dict[str, Any]:
    title = str(source.get("title") or "Untitled")
    local_pdf = rel(source.get("local_pdf_path"))
    local_poster = rel(source.get("local_poster_path"))
    local_slide = rel(source.get("local_slide_path"))
    local_supplementals = [rel(p) for p in source.get("local_supplemental_paths", []) if p]
    pdf_url = str(source.get("pdf_url") or "")

    if item_type == "paper":
        item_id = str(source.get("openreview_id_or_icml_id") or source.get("paper_url") or title)
    elif item_type == "poster":
        item_id = str(source.get("icml_poster_id") or source.get("poster_page_url") or title)
    else:
        item_id = str(source.get("openreview_id") or source.get("paper_url") or title)
    semantic_fields = semantic.get(item_id, {})

    has_pdf = bool(local_pdf)
    has_poster = bool(local_poster)
    has_slide = bool(local_slide)
    status = str(source.get("status") or "")
    failure_reason = str(source.get("failure_reason") or "")
    availability_status, availability_label = classify_availability(
        has_pdf=has_pdf,
        has_poster=has_poster,
        has_slide=has_slide,
        status=status,
        failure_reason=failure_reason,
    )

    best_asset = ""
    best_asset_kind = ""
    if has_pdf:
        best_asset = local_pdf
        best_asset_kind = "pdf"
    elif has_slide:
        best_asset = local_slide
        best_asset_kind = "slide"
    elif has_poster:
        best_asset = local_poster
        best_asset_kind = "poster"

    page_url = str(
        source.get("paper_url")
        or source.get("poster_page_url")
        or source.get("workshop_page_url")
        or source.get("openreview_url")
        or ""
    )

    category_tags = infer_categories(title, group)

    return {
        "id": item_id,
        "type": item_type,
        "title": title,
        "authors": as_author_string(source.get("authors")),
        "group": group,
        "category": category_tags[0],
        "categoryTags": category_tags,
        "areaTags": semantic_fields.get("areaTags", []),
        "domainTags": semantic_fields.get("domainTags", []),
        "clusterId": semantic_fields.get("clusterId"),
        "clusterLabel": semantic_fields.get("clusterLabel"),
        "classificationConfidence": semantic_fields.get("classificationConfidence"),
        "classificationReason": semantic_fields.get("classificationReason", ""),
        "embeddingTextQuality": semantic_fields.get("embeddingTextQuality", "unavailable"),
        "mapAvailable": bool(semantic_fields.get("mapAvailable", False)),
        "status": status,
        "sourceType": str(source.get("source_type") or ""),
        "failureReason": failure_reason,
        "availabilityStatus": availability_status,
        "availabilityLabel": availability_label,
        "pageUrl": page_url,
        "openreviewUrl": str(source.get("openreview_url") or ""),
        "projectPageUrl": str(source.get("project_page_url") or ""),
        "pdfUrl": pdf_url,
        "localPdfPath": local_pdf,
        "localPosterPath": local_poster,
        "localSlidePath": local_slide,
        "localSupplementalPaths": local_supplementals,
        "bestAsset": best_asset,
        "bestAssetKind": best_asset_kind,
        "hasPdf": has_pdf,
        "hasPoster": has_poster,
        "hasSlide": has_slide,
        "sourceCheckedAt": str(source.get("source_checked_at") or ""),
    }


def build() -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    semantic = read_semantic_sidecar()

    for row in read_jsonl(MATERIALS / "papers" / "manifest.jsonl"):
        if not should_include_paper_row(row):
            continue
        records.append(compact_record(row, "paper", "Main Conference", semantic))

    for row in read_jsonl(MATERIALS / "posters" / "manifest.jsonl"):
        if row.get("source_type") and row.get("source_type") != "official_icml_virtual_poster":
            continue
        records.append(compact_record(row, "poster", "Main Conference", semantic))

    workshop_root = MATERIALS / "workshops"
    for manifest in sorted(workshop_root.glob("*/manifest.jsonl")):
        slug = manifest.parent.name
        for row in read_jsonl(manifest):
            if not should_include_workshop_row(row):
                continue
            group = str(row.get("workshop_name") or slug)
            records.append(compact_record(row, "workshop", group, semantic))

    type_counts: dict[str, int] = {}
    asset_counts = {"pdf": 0, "poster": 0, "slide": 0}
    availability_counts = {"downloaded": 0, "blocked": 0, "metadata": 0, "unavailable": 0}
    categories: set[str] = set()
    groups: dict[str, set[str]] = {"paper": set(), "poster": set(), "workshop": set()}

    for record in records:
        item_type = record["type"]
        type_counts[item_type] = type_counts.get(item_type, 0) + 1
        availability_counts[record["availabilityStatus"]] = availability_counts.get(record["availabilityStatus"], 0) + 1
        categories.update(record.get("categoryTags") or [record["category"]])
        groups[item_type].add(record["group"])
        if record["hasPdf"]:
            asset_counts["pdf"] += 1
        if record["hasPoster"]:
            asset_counts["poster"] += 1
        if record["hasSlide"]:
            asset_counts["slide"] += 1

    return {
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "records": records,
        "summary": {
            "total": len(records),
            "typeCounts": type_counts,
            "assetCounts": asset_counts,
            "availabilityCounts": availability_counts,
            "categories": sorted(categories),
            "groups": {key: sorted(value) for key, value in groups.items()},
        },
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(json.dumps(payload["summary"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
