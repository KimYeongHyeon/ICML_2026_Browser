#!/usr/bin/env python3
"""Build the static ICML 2026 browser data used by the GitHub Pages UI."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.icml_embedding_contract import embedding_fingerprint

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT / "icml_2026_materials"
OUT = ROOT / os.environ.get("ICML_SITE_INDEX", "docs/site/data/icml2026_index.json")
DATA_ROOT = OUT.parent
MANIFEST_OUT = DATA_ROOT / "icml2026_index.manifest.json"
STARTUP_OUT = DATA_ROOT / "icml2026_startup.json"
SHARDS_ROOT = DATA_ROOT / "shards"
MAP_PATH = DATA_ROOT / "icml2026_map.json"
SEARCH_EMBEDDINGS_PATH = DATA_ROOT / "icml2026_search_embeddings.json"
SEMANTIC_SIDECAR = ROOT / "docs" / "site" / "data" / "icml2026_semantic_sidecar.json"
ICML_WEB = "https://icml.cc"
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


def read_semantic_sidecar_payload() -> dict[str, Any]:
    if not SEMANTIC_SIDECAR.exists():
        return {}
    return json.loads(SEMANTIC_SIDECAR.read_text(encoding="utf-8"))


def read_semantic_sidecar() -> dict[str, dict[str, Any]]:
    records = read_semantic_sidecar_payload().get("records", {})
    return records if isinstance(records, dict) else {}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def as_author_string(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if v)
    return str(value or "")


def rel(path: str | None) -> str:
    if not path:
        return ""
    return path.replace("\\", "/").lstrip("/")


def normalize_key(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


def extract_openreview_id(value: Any) -> str:
    text = str(value or "")
    match = re.search(r"(?:openreview:|[?&]id=)([^;&\s]+)", text)
    return match.group(1) if match else ""


def extract_icml_id(value: Any) -> str:
    text = str(value or "")
    match = re.search(r"(?:icml:|/poster/|/oral/)(\d+)", text)
    return match.group(1) if match else ""


def unique_values(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        for part in re.split(r"\s+(?:·|\+)\s+", str(value or "")):
            part = part.strip()
            if part and part not in seen:
                seen.add(part)
                result.append(part)
    return result


def read_embedding_source(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return read_json(path).get("embeddingSource") or {}


def semantic_freshness_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    expected = embedding_fingerprint(records)
    artifact_exists = {
        "map": MAP_PATH.exists(),
        "search": SEARCH_EMBEDDINGS_PATH.exists(),
        "sidecar": SEMANTIC_SIDECAR.exists(),
    }
    sources = {
        "map": read_embedding_source(MAP_PATH),
        "search": read_embedding_source(SEARCH_EMBEDDINGS_PATH),
        "sidecar": read_semantic_sidecar_payload().get("embeddingSource") or {},
    }
    actuals = {key: str(value.get("sourceFingerprint") or "") for key, value in sources.items()}
    reasons: list[str] = []
    for key, actual in actuals.items():
        if not actual:
            suffix = "legacy_metadata" if artifact_exists[key] else "missing"
            reasons.append(f"{key}_{suffix}")
        elif actual != expected:
            reasons.append(f"{key}_fingerprint_mismatch")
    if not reasons:
        status = "fresh"
    elif all(not actual for actual in actuals.values()) and any(artifact_exists.values()):
        status = "legacy"
    elif all(not actual for actual in actuals.values()):
        status = "missing"
    else:
        status = "stale"
    return {
        "status": status,
        "expectedFingerprint": expected,
        "actualFingerprints": actuals,
        "artifactExists": artifact_exists,
        "staleReasons": reasons,
        "mapGeneratedAt": read_json(MAP_PATH).get("generatedAt", "") if MAP_PATH.exists() else "",
        "searchGeneratedAt": read_json(SEARCH_EMBEDDINGS_PATH).get("generatedAt", "") if SEARCH_EMBEDDINGS_PATH.exists() else "",
        "recordCount": len(records),
    }


def slim_record(record: dict[str, Any]) -> dict[str, Any]:
    omit = {"abstract", "localSupplementalPaths"}
    return {key: value for key, value in record.items() if key not in omit}


def relative_site_data_url(path: Path) -> str:
    return "site/data/" + path.relative_to(DATA_ROOT).as_posix()


def write_json_payload(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_sharded_payload(payload: dict[str, Any]) -> None:
    records = payload.get("records", [])
    startup_payload = {
        "generatedAt": payload.get("generatedAt"),
        "summary": payload.get("summary", {}),
        "records": [slim_record(record) for record in records],
    }
    write_json_payload(STARTUP_OUT, startup_payload)

    shards = []
    for item_type in ("paper", "poster", "workshop"):
        shard_records = [record for record in records if record.get("type") == item_type]
        shard_path = SHARDS_ROOT / f"{item_type}.json"
        write_json_payload(shard_path, {
            "generatedAt": payload.get("generatedAt"),
            "type": item_type,
            "records": shard_records,
        })
        shards.append({
            "type": item_type,
            "url": relative_site_data_url(shard_path),
            "count": len(shard_records),
        })

    write_json_payload(MANIFEST_OUT, {
        "generatedAt": payload.get("generatedAt"),
        "summary": payload.get("summary", {}),
        "startupUrl": relative_site_data_url(STARTUP_OUT),
        "fallbackUrl": relative_site_data_url(OUT),
        "shards": shards,
    })


def canonical_presentation_types(values: list[str]) -> list[str]:
    priority = {"Oral": 0, "Poster": 1}
    return sorted(unique_values(values), key=lambda value: (priority.get(value, 99), value.lower()))


def event_presentation_labels(event: dict[str, Any]) -> list[str]:
    decision = str(event.get("decision") or "")
    event_type = str(event.get("event_type") or event.get("eventtype") or "")
    labels: list[str] = []
    if "spotlight" in decision.lower():
        labels.append("Spotlight")
    if event_type.lower() == "oral":
        labels.append("Oral")
    return labels


def event_meta(event: dict[str, Any]) -> dict[str, Any]:
    virtual_path = str(event.get("virtualsite_url") or "")
    openreview_url = str(event.get("paper_url") or "")
    return {
        "decision": str(event.get("decision") or ""),
        "presentationType": str(event.get("event_type") or event.get("eventtype") or ""),
        "presentationLabels": event_presentation_labels(event),
        "session": str(event.get("session") or ""),
        "roomName": str(event.get("room_name") or ""),
        "startTime": str(event.get("starttime") or ""),
        "endTime": str(event.get("endtime") or ""),
        "officialPageUrl": f"{ICML_WEB}{virtual_path}" if virtual_path.startswith("/") else virtual_path,
        "openreviewUrl": openreview_url if "openreview.net/" in openreview_url else "",
    }


def merge_meta(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    if not left:
        return dict(right)
    merged = dict(left)
    for key in ("decision", "presentationType", "officialPageUrl", "openreviewUrl"):
        if not merged.get(key) and right.get(key):
            merged[key] = right[key]
    for key in ("session", "roomName", "startTime", "endTime"):
        merged[key] = " · ".join(unique_values([str(merged.get(key) or ""), str(right.get(key) or "")]))
    merged["presentationLabels"] = unique_values([
        *(merged.get("presentationLabels") or []),
        *(right.get("presentationLabels") or []),
    ])
    types = canonical_presentation_types([str(merged.get("presentationType") or ""), str(right.get("presentationType") or "")])
    if len(types) > 1:
        merged["presentationType"] = " + ".join(types)
    return merged


def read_abstracts() -> dict[str, str]:
    """Map ICML event id / OpenReview id / normalized title -> abstract text.

    Abstracts are scraped separately by scripts/collect_icml_2026_abstracts.py into
    icml_2026_materials/abstracts.jsonl. The file may be absent (none collected yet)
    or partial (collection in progress); both are handled gracefully by read_jsonl.
    """
    abstracts: dict[str, str] = {}
    for row in read_jsonl(MATERIALS / "abstracts.jsonl"):
        text = " ".join(str(row.get("abstract") or "").split())
        if len(text) < 40:
            continue
        icml_id = str(row.get("id") or "")
        if icml_id:
            abstracts.setdefault(f"icml:{icml_id}", text)
        openreview_id = extract_openreview_id(row.get("paper_url"))
        if openreview_id:
            abstracts.setdefault(f"openreview:{openreview_id}", text)
        name_key = normalize_key(row.get("name"))
        if name_key:
            abstracts.setdefault(f"title:{name_key}", text)
    return abstracts


def lookup_abstract(
    abstracts: dict[str, str],
    *,
    icml_id: str = "",
    openreview_id: str = "",
    title: str = "",
) -> str:
    for key in (
        f"icml:{icml_id}" if icml_id else "",
        f"openreview:{openreview_id}" if openreview_id else "",
        f"title:{normalize_key(title)}" if title else "",
    ):
        if key and key in abstracts:
            return abstracts[key]
    return ""


def read_paper_event_metadata() -> dict[str, dict[str, Any]]:
    payload = read_json(MATERIALS / "papers" / "source_icml_2026_orals_posters.json")
    indexes: dict[str, dict[str, Any]] = {}
    for event in payload.get("results", []):
        meta = event_meta(event)
        keys = [
            f"icml:{event.get('id')}",
            f"title:{normalize_key(event.get('name'))}",
        ]
        openreview_id = extract_openreview_id(event.get("paper_url"))
        if openreview_id:
            keys.append(f"openreview:{openreview_id}")
        for key in keys:
            indexes[key] = merge_meta(indexes.get(key, {}), meta)
    return indexes


def enrich_paper_row(source: dict[str, Any], paper_events: dict[str, dict[str, Any]]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    openreview_id = extract_openreview_id(source.get("openreview_id_or_icml_id"))
    icml_id = extract_icml_id(source.get("openreview_id_or_icml_id")) or extract_icml_id(source.get("paper_url"))
    for key in (
        f"title:{normalize_key(source.get('title'))}",
        f"openreview:{openreview_id}" if openreview_id else "",
        f"icml:{icml_id}" if icml_id else "",
    ):
        if key:
            meta = merge_meta(meta, paper_events.get(key, {}))
    enriched = dict(source)
    enriched["status"] = "accepted_public"
    enriched["decision"] = meta.get("decision") or "Accept"
    enriched["presentation_type"] = meta.get("presentationType") or ""
    enriched["presentation_labels"] = meta.get("presentationLabels") or []
    enriched["session"] = meta.get("session") or ""
    enriched["room_name"] = meta.get("roomName") or ""
    enriched["start_time"] = meta.get("startTime") or ""
    enriched["end_time"] = meta.get("endTime") or ""
    enriched["openreview_url"] = meta.get("openreviewUrl") or (f"https://openreview.net/forum?id={openreview_id}" if openreview_id else "")
    if meta.get("officialPageUrl"):
        enriched["paper_url"] = meta["officialPageUrl"]
    return enriched


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
    if source.get("source_type") == "official_icml_virtual_accepted_main_conference_metadata":
        return True
    page_url = str(source.get("paper_url") or "")
    has_public_pdf = bool(source.get("local_pdf_path") or source.get("pdf_url"))
    return has_public_pdf and "/poster/" not in page_url


def compact_record(source: dict[str, Any], item_type: str, group: str, semantic: dict[str, dict[str, Any]], abstracts: dict[str, str]) -> dict[str, Any]:
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

    if item_type == "paper":
        abstract = lookup_abstract(
            abstracts,
            icml_id=extract_icml_id(source.get("openreview_id_or_icml_id")) or extract_icml_id(source.get("paper_url")),
            openreview_id=extract_openreview_id(source.get("openreview_id_or_icml_id")) or extract_openreview_id(source.get("openreview_url")),
            title=title,
        )
    elif item_type == "poster":
        abstract = lookup_abstract(
            abstracts,
            icml_id=str(source.get("icml_poster_id") or "") or extract_icml_id(source.get("poster_page_url")),
            title=title,
        )
    else:
        abstract = lookup_abstract(abstracts, title=title)

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
        "abstract": abstract,
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
        "decision": str(source.get("decision") or ""),
        "presentationType": str(source.get("presentation_type") or ""),
        "presentationLabels": source.get("presentation_labels") or [],
        "session": str(source.get("session") or ""),
        "roomName": str(source.get("room_name") or ""),
        "startTime": str(source.get("start_time") or ""),
        "endTime": str(source.get("end_time") or ""),
    }


def build() -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    semantic = read_semantic_sidecar()
    paper_events = read_paper_event_metadata()
    abstracts = read_abstracts()

    for row in read_jsonl(MATERIALS / "papers" / "manifest.jsonl"):
        if not should_include_paper_row(row):
            continue
        records.append(compact_record(enrich_paper_row(row, paper_events), "paper", "Main Conference", semantic, abstracts))

    for row in read_jsonl(MATERIALS / "posters" / "manifest.jsonl"):
        if row.get("source_type") and row.get("source_type") != "official_icml_virtual_poster":
            continue
        records.append(compact_record(row, "poster", "Main Conference", semantic, abstracts))

    workshop_root = MATERIALS / "workshops"
    for manifest in sorted(workshop_root.glob("*/manifest.jsonl")):
        slug = manifest.parent.name
        for row in read_jsonl(manifest):
            if not should_include_workshop_row(row):
                continue
            group = str(row.get("workshop_name") or slug)
            records.append(compact_record(row, "workshop", group, semantic, abstracts))

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

    semantic_summary = semantic_freshness_summary(records)
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
            "embedding": semantic_summary,
        },
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    write_json_payload(OUT, payload)
    write_sharded_payload(payload)
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"Wrote {MANIFEST_OUT.relative_to(ROOT)}")
    print(json.dumps(payload["summary"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
