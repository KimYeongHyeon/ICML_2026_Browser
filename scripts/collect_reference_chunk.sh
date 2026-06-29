#!/usr/bin/env sh
set -eu

offset="$1"
out="/tmp/icml_refs_local/chunks/chunk-${offset}"
log="/tmp/icml_refs_local/logs/chunk-${offset}.log"
sleep_seconds="${ICML_REF_SLEEP:-1}"
timeout_seconds="${ICML_REF_TIMEOUT:-30}"

: "${ICML_REF_HTTP_RETRIES:=3}"
export ICML_REF_HTTP_RETRIES

echo "START ${offset} $(date -u +%FT%TZ)" > "$log"
python3 scripts/build_icml_references.py \
  --source openreview-pdf \
  --record-types paper,workshop \
  --offset "$offset" \
  --limit 25 \
  --sleep "$sleep_seconds" \
  --timeout "$timeout_seconds" \
  --out-root "$out" >> "$log" 2>&1
code=$?
echo "END ${offset} code=${code} $(date -u +%FT%TZ)" >> "$log"
exit "$code"
