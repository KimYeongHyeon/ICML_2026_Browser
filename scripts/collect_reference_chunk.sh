#!/usr/bin/env sh
set -eu

offset="$1"
out="/tmp/icml_refs_local/chunks/chunk-${offset}"
log="/tmp/icml_refs_local/logs/chunk-${offset}.log"
lock="/tmp/icml_refs_local/locks/chunk-${offset}.lock"
sleep_seconds="${ICML_REF_SLEEP:-1}"
timeout_seconds="${ICML_REF_TIMEOUT:-30}"

: "${ICML_REF_HTTP_RETRIES:=3}"
export ICML_REF_HTTP_RETRIES

if [ -f "$out/manifest.json" ]; then
  exit 0
fi

mkdir -p /tmp/icml_refs_local/locks
while ! mkdir "$lock" 2>/dev/null; do
  if [ -f "$lock/pid" ] && ! kill -0 "$(cat "$lock/pid")" 2>/dev/null; then
    rm -rf "$lock"
    continue
  fi
  echo "SKIP ${offset} locked $(date -u +%FT%TZ)" >> "$log"
  exit 0
done
echo "$$" > "$lock/pid"
trap 'rm -rf "$lock"' EXIT INT TERM

if [ -f "$out/manifest.json" ]; then
  exit 0
fi

echo "START ${offset} $(date -u +%FT%TZ)" > "$log"
set +e
python3 scripts/build_icml_references.py \
  --source openreview-pdf \
  --record-types paper,workshop \
  --offset "$offset" \
  --limit 25 \
  --sleep "$sleep_seconds" \
  --timeout "$timeout_seconds" \
  --out-root "$out" >> "$log" 2>&1
code=$?
set -e
echo "END ${offset} code=${code} $(date -u +%FT%TZ)" >> "$log"
exit "$code"
