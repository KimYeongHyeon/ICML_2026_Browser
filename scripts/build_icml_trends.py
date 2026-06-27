#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import icml_semantic_config as config
from scripts.build_icml_embedding_map import tokenize


STOP_PHRASE_TOKENS = {
    "across", "also", "approach", "based", "can", "data", "framework",
    "how", "its", "method", "model", "models", "more", "our", "paper",
    "propose", "results", "show", "task", "than", "that", "their", "these",
    "they", "those", "training", "using", "via", "when", "where", "which",
    "while", "will",
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def record_text(record: dict[str, Any]) -> str:
    return " ".join(str(record.get(key) or "") for key in ("title", "abstract"))


def phrases(text: str) -> list[str]:
    tokens = [token for token in tokenize(text) if token not in STOP_PHRASE_TOKENS]
    values = list(tokens)
    values.extend(
        f"{left} {right}"
        for left, right in zip(tokens, tokens[1:])
        if left not in STOP_PHRASE_TOKENS and right not in STOP_PHRASE_TOKENS
    )
    return values


def split_sentences(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", " ".join(str(text or "").split()))
    return [sentence for sentence in sentences if 70 <= len(sentence) <= 280]


def clean_keyword(value: str) -> str:
    replacements = {
        "llm": "LLM",
        "llms": "LLMs",
        "rl": "RL",
        "vlm": "VLM",
        "vlms": "VLMs",
        "rag": "RAG",
        "pfn": "PFN",
    }
    return " ".join(replacements.get(part, part) for part in value.split())


def short_title(record: dict[str, Any]) -> str:
    title = " ".join(str(record.get("title") or "").replace("$", "").split())
    return title if len(title) <= 96 else f"{title[:93]}..."


def top_counts(records: list[dict[str, Any]], key: str, limit: int = 4) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for record in records:
        for tag in record.get(key) or []:
            counts[str(tag)] += 1
    return [{"label": label, "count": count} for label, count in counts.most_common(limit)]


def build_trends(index: dict[str, Any], map_data: dict[str, Any], limit: int = 12) -> dict[str, Any]:
    index_by_id = {
        str(record.get("id")): record
        for record in index.get("records", [])
        if record.get("type") != "poster"
    }
    map_by_id = {str(record.get("id")): record for record in map_data.get("records", [])}
    cluster_by_id = {str(cluster.get("id")): cluster for cluster in map_data.get("embeddingClusters", [])}
    records = [
        {**index_by_id[record_id], "_map": map_record}
        for record_id, map_record in map_by_id.items()
        if record_id in index_by_id and index_by_id[record_id].get("mapAvailable")
    ]

    cluster_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        cluster_id = str(record.get("_map", {}).get("embeddingClusterId") or record.get("embeddingClusterId") or "")
        if not cluster_id:
            raise SystemExit(f"Missing embeddingClusterId for mapped record {record.get('id')}")
        cluster_records[cluster_id].append(record)

    document_frequency: Counter[str] = Counter()
    record_phrases: dict[str, list[str]] = {}
    for record in records:
        values = phrases(record_text(record))
        record_phrases[str(record["id"])] = values
        document_frequency.update(set(values))

    total_documents = max(1, len(records))
    trends = []
    for cluster_id, members in cluster_records.items():
        if len(members) < 5:
            continue
        center_x = sum(float(record["_map"].get("x") or 0) for record in members) / len(members)
        center_y = sum(float(record["_map"].get("y") or 0) for record in members) / len(members)
        center_z = sum(float(record["_map"].get("z") or 0) for record in members) / len(members)

        def distance(record: dict[str, Any]) -> float:
            point = record["_map"]
            return (
                (float(point.get("x") or 0) - center_x) ** 2
                + (float(point.get("y") or 0) - center_y) ** 2
                + (float(point.get("z") or 0) - center_z) ** 2
            )

        central = sorted(members, key=distance)
        representative = central[:5]
        keyword_counts: Counter[str] = Counter()
        for record in central[: min(40, len(central))]:
            keyword_counts.update(record_phrases.get(str(record["id"]), []))
        scored_keywords = []
        for phrase, count in keyword_counts.items():
            if len(phrase) < 4 or phrase.isdigit():
                continue
            idf = math.log((1 + total_documents) / (1 + document_frequency.get(phrase, 0))) + 1
            phrase_bonus = 1.25 if " " in phrase else 1.0
            scored_keywords.append((count * idf * phrase_bonus, phrase))
        scored_keywords.sort(key=lambda item: (-item[0], item[1]))
        keywords = [clean_keyword(keyword) for _, keyword in scored_keywords[:8]]
        cluster = cluster_by_id.get(cluster_id, {})
        cluster_label = str(
            cluster.get("label")
            or members[0].get("clusterLabel")
            or cluster_id.replace("embedding-cluster-", "Cluster ").replace("cluster-", "").replace("-", " ").title()
        )
        name_terms = [cluster_label]
        name_terms.extend(keyword for keyword in keywords if keyword.lower() != cluster_label.lower())
        name = " + ".join(name_terms[:2])

        sentence_scores = []
        keyword_set = {keyword.lower() for keyword in keywords[:8]}
        for rank, record in enumerate(central[:24]):
            rank_weight = 1 / (rank + 1)
            for sentence in split_sentences(str(record.get("abstract") or "")):
                sentence_tokens = set(phrases(sentence))
                score = len(sentence_tokens & keyword_set) + rank_weight
                if score > 0:
                    sentence_scores.append((score, sentence))
        sentence_scores.sort(key=lambda item: (-item[0], item[1]))
        sentences = []
        seen_sentences = set()
        for _, sentence in sentence_scores:
            normalized = sentence.lower()
            if normalized in seen_sentences:
                continue
            seen_sentences.add(normalized)
            sentences.append(sentence)
            if len(sentences) >= 3:
                break

        trend_keywords = keywords[:5] or [str(cluster.get("label") or members[0].get("clusterLabel") or "mapped records")]
        trends.append({
            "id": cluster_id,
            "clusterId": cluster_id,
            "clusterLabel": cluster_label,
            "clusterMethod": str(cluster.get("method") or ""),
            "name": name,
            "size": len(members),
            "keywords": trend_keywords,
            "summary": f"This trend groups papers around {', '.join(trend_keywords[:3])}, with representative work on {short_title(representative[0])}.",
            "representativeSentences": sentences,
            "representativeRecordIds": [str(record["id"]) for record in representative],
            "areaCounts": top_counts(members, "areaTags"),
            "domainCounts": top_counts(members, "domainTags"),
        })

    trends.sort(key=lambda trend: (-int(trend["size"]), str(trend["name"])))
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "indexGeneratedAt": index.get("generatedAt", ""),
            "mapGeneratedAt": map_data.get("generatedAt", ""),
            "embeddingSource": map_data.get("embeddingSource", {}),
        },
        "trends": trends[:limit],
    }


def main() -> None:
    payload = build_trends(read_json(config.INDEX_PATH), read_json(config.MAP_PATH))
    write_json(config.TRENDS_PATH, payload)
    print(f"Wrote {config.TRENDS_PATH.relative_to(config.ROOT)}")
    print(json.dumps({"trends": len(payload["trends"])}, indent=2))


if __name__ == "__main__":
    main()
