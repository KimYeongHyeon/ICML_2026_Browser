#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SLIDE_BATCH_SIZE="${SLIDE_BATCH_SIZE:-150}"
POSTER_BATCH_SIZE="${POSTER_BATCH_SIZE:-200}"

commit_and_push_if_needed() {
  local message="$1"
  if git diff --cached --quiet; then
    return 0
  fi
  git commit -m "$message"
  git push
}

publish_untracked_dir() {
  local dir="$1"
  local label="$2"
  local batch_size="$3"
  local batch=1
  local total=0
  local files=()

  if [[ ! -d "$dir" ]]; then
    echo "skip: $dir does not exist"
    return 0
  fi

  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(git ls-files --others --exclude-standard -z -- "$dir")
  total="${#files[@]}"

  if [[ "$total" -eq 0 ]]; then
    echo "done: no untracked files under $dir"
    return 0
  fi

  echo "publishing $total untracked $label files from $dir in batches of $batch_size"

  for ((start = 0; start < total; start += batch_size)); do
    end=$((start + batch_size))
    if ((end > total)); then
      end="$total"
    fi

    printf '%s\0' "${files[@]:start:end-start}" | xargs -0 git add --
    commit_and_push_if_needed "Add ICML 2026 ${label} batch ${batch}"
    batch=$((batch + 1))
  done
}

git add scripts/publish_batches.sh
commit_and_push_if_needed "Add ICML 2026 batch publishing script"

if [[ -f icml_2026_materials/workshops/collection_summary.json ]]; then
  git add icml_2026_materials/workshops/collection_summary.json
  commit_and_push_if_needed "Add ICML 2026 workshop collection summary"
fi

publish_untracked_dir "icml_2026_materials/posters/files/slides" "poster slides" "$SLIDE_BATCH_SIZE"
publish_untracked_dir "icml_2026_materials/posters/files/posters" "poster images" "$POSTER_BATCH_SIZE"

echo "publish batches complete"
