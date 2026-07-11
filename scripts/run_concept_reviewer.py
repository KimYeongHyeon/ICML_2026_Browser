from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
review_runner = importlib.import_module("scripts.concept_review_runner")
review_lock = importlib.import_module("scripts.concept_review_lock")


DEFAULT_CODEX = Path("/Users/kyh/.local/bin/codex")


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description="Run isolated, resumable per-record Codex concept review.")
    argument_parser.add_argument("--input", required=True, type=Path, help="Stage-one candidate JSON artifact.")
    argument_parser.add_argument("--output-dir", required=True, type=Path, help="Runner cache, logs, and manifest directory.")
    argument_parser.add_argument("--schema", type=Path, help="Concept-review JSON Schema passed to Codex.")
    argument_parser.add_argument("--codex-bin", type=Path, default=DEFAULT_CODEX, help="Codex CLI executable.")
    argument_parser.add_argument("--max-records", type=int, default=200, help="Maximum candidate records to inspect.")
    argument_parser.add_argument("--max-total-attempts", type=int, default=400, help="Maximum Codex invocations for this run.")
    argument_parser.add_argument("--max-attempts-per-record", type=int, default=3, help="Transient retry cap per record.")
    argument_parser.add_argument("--timeout-seconds", type=int, default=120, help="Per-invocation timeout.")
    argument_parser.add_argument("--dry-run", action="store_true", help="Write prompts and manifest without invoking Codex.")
    retry_group = argument_parser.add_mutually_exclusive_group()
    retry_group.add_argument("--retry-failed", action="store_true", help="Retry only records marked failed in the prior manifest.")
    retry_group.add_argument(
        "--retry-needs-review",
        action="store_true",
        help="Retry only unresolved needs_review records, preserving retry provenance and requiring a fresh Codex CLI result.",
    )
    argument_parser.add_argument("--steal-lock", action="store_true", help="Recover a dead or malformed runner lock; refuse live PIDs.")
    return argument_parser


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    schema_path = arguments.schema or arguments.output_dir / "concept-review.schema.json"
    if arguments.schema is None:
        try:
            from scripts.icml_concept_contract import schema_json
        except ImportError:
            print("concept contract is unavailable; cannot create output schema", file=sys.stderr)
            return 2
        review_runner.atomic_write_text(schema_path, schema_json())
    settings = review_runner.RunSettings(
        input_path=arguments.input,
        output_dir=arguments.output_dir,
        schema_path=schema_path,
        codex_bin=arguments.codex_bin,
        max_records=arguments.max_records,
        max_total_attempts=arguments.max_total_attempts,
        max_attempts_per_record=arguments.max_attempts_per_record,
        timeout_seconds=arguments.timeout_seconds,
        dry_run=arguments.dry_run,
        retry_failed=arguments.retry_failed,
        retry_needs_review=arguments.retry_needs_review,
        steal_lock=arguments.steal_lock,
    )
    if min(settings.max_records, settings.max_total_attempts, settings.max_attempts_per_record, settings.timeout_seconds) < 1:
        print("all limits must be positive", file=sys.stderr)
        return 2
    try:
        summary = review_runner.run_reviews(settings)
    except (review_lock.LockError, review_runner.ReviewRunnerError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 2 if int(summary["failures"]) or (arguments.retry_needs_review and int(summary["needsReview"])) else 0


if __name__ == "__main__":
    raise SystemExit(main())
