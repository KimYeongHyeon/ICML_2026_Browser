"""Collect ICML 2026 paper abstracts from the public virtual site.

The ICML virtual site exposes:
  * a static, unauthenticated metadata list:
      https://icml.cc/static/virtual/data/icml-2026-orals-posters.json
  * server-rendered poster pages whose HTML embeds the abstract in a
      <div class="abstract-section"> ... </div> block.

Neither requires authentication or a JS runtime, so a plain HTTP GET works.
Abstracts are written to a JSONL file keyed by event id. The run is resumable:
ids already present in the output file are skipped.

Usage:
    python3 scripts/collect_icml_2026_abstracts.py [--limit N] [--workers 8]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "icml_2026_materials" / "abstracts.jsonl"
METADATA_URL = "https://icml.cc/static/virtual/data/icml-2026-orals-posters.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"

ABSTRACT_RE = re.compile(
    r'<div[^>]*class="[^"]*abstract-section[^"]*"[^>]*>(.*?)</div>', re.I | re.S
)
ABSTRACT_FALLBACK_RE = re.compile(
    r'class="[^"]*abstract[^"]*"[^>]*>(.*?)</div>', re.I | re.S
)


def curl(url: str, timeout: int = 40) -> str:
    result = subprocess.run(
        ["curl", "-s", "--max-time", str(timeout), "-A", UA, url],
        capture_output=True,
        text=True,
    )
    return result.stdout


def extract_abstract(html: str) -> str:
    match = ABSTRACT_RE.search(html) or ABSTRACT_FALLBACK_RE.search(html)
    if not match:
        return ""
    text = re.sub(r"<[^>]+>", " ", match.group(1))
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"^Abstract\s*", "", text)


def load_metadata() -> list[dict]:
    raw = curl(METADATA_URL, timeout=120)
    return json.loads(raw)["results"]


def load_done_ids() -> set[str]:
    if not OUTPUT_PATH.exists():
        return set()
    done = set()
    for line in OUTPUT_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            done.add(str(json.loads(line)["id"]))
        except (json.JSONDecodeError, KeyError):
            continue
    return done


def scrape_one(item: dict) -> dict:
    url = "https://icml.cc" + item["virtualsite_url"]
    html = curl(url)
    abstract = extract_abstract(html)
    return {
        "id": item["id"],
        "name": item.get("name", ""),
        "abstract": abstract,
        "paper_url": item.get("paper_url", ""),
        "event_type": item.get("event_type", ""),
        "virtualsite_url": item.get("virtualsite_url", ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="Max items (0 = all).")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent requests.")
    args = parser.parse_args()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    items = load_metadata()
    done = load_done_ids()
    pending = [it for it in items if str(it["id"]) not in done]
    if args.limit:
        pending = pending[: args.limit]

    print(f"total={len(items)} done={len(done)} pending={len(pending)} workers={args.workers}")
    if not pending:
        print("nothing to do")
        return 0

    written = 0
    missing = 0
    with OUTPUT_PATH.open("a", encoding="utf-8") as out:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(scrape_one, it): it for it in pending}
            for i, future in enumerate(as_completed(futures), 1):
                record = future.result()
                if len(record["abstract"]) < 80:
                    missing += 1
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                written += 1
                if i % 100 == 0 or i == len(pending):
                    print(f"  {i}/{len(pending)} written (missing-so-far={missing})", flush=True)

    print(f"done: wrote {written} records, {missing} without usable abstract")
    return 0


if __name__ == "__main__":
    sys.exit(main())
