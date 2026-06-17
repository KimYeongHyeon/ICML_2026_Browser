#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INDEX_PATH="${ICML_SITE_INDEX:-docs/site/data/icml2026_index.json}"

python3 scripts/build_icml_site.py
if [[ "${ICML_BUILD_SEMANTIC_MAP:-1}" == "1" ]]; then
  python3 scripts/build_icml_embedding_map.py ${ICML_SEMANTIC_ARGS:---smoke}
  python3 scripts/build_icml_site.py
  python3 scripts/verify_embedding_map.py "$INDEX_PATH" docs/site/data/icml2026_map.json
fi
scripts/verify_site_contract.sh "$INDEX_PATH"

python3 - "$INDEX_PATH" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
summary = data["summary"]
availability = summary.get("availabilityCounts", {})

print("ICML 2026 site index")
print(f"- records: {summary['total']:,}")
print(f"- papers: {summary['typeCounts'].get('paper', 0):,}")
print(f"- posters: {summary['typeCounts'].get('poster', 0):,}")
print(f"- workshops: {summary['typeCounts'].get('workshop', 0):,}")
print(f"- downloaded: {availability.get('downloaded', 0):,}")
print(f"- blocked: {availability.get('blocked', 0):,}")
print(f"- metadata only: {availability.get('metadata', 0):,}")
print(f"- unavailable/skipped: {availability.get('unavailable', 0):,}")
PY
