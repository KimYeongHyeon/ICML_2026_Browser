from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.concept_review_lock import LockError  # noqa: E402
from scripts.concept_review_sharding import (  # noqa: E402
    ShardingError,
    merge_retry_shards,
    merge_shards,
    prepare_retry_shards,
    prepare_shards,
)


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description="Prepare and strictly merge isolated concept-review shards.")
    commands = argument_parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Create disjoint candidate shards for unstarted records only.")
    prepare.add_argument("--input", required=True, type=Path)
    prepare.add_argument("--root-dir", required=True, type=Path)
    prepare.add_argument("--shard-root", required=True, type=Path)
    prepare.add_argument("--shards", required=True, type=int)
    prepare_retry = commands.add_parser("prepare-retry", help="Create isolated retry shards for every root needs_review record.")
    prepare_retry.add_argument("--input", required=True, type=Path)
    prepare_retry.add_argument("--root-dir", required=True, type=Path)
    prepare_retry.add_argument("--shard-root", required=True, type=Path)
    prepare_retry.add_argument("--shards", required=True, type=int)
    merge = commands.add_parser("merge", help="Verify and merge isolated shard caches into the root cache.")
    merge.add_argument("--root-dir", required=True, type=Path)
    merge.add_argument("--shard-dir", required=True, type=Path, action="append")
    merge_retry = commands.add_parser("merge-retry", help="Atomically replace every unresolved root review with its retry-shard result.")
    merge_retry.add_argument("--root-dir", required=True, type=Path)
    merge_retry.add_argument("--shard-dir", required=True, type=Path, action="append")
    return argument_parser


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        if arguments.command == "prepare":
            paths = prepare_shards(
                arguments.input,
                arguments.root_dir / "manifest.json",
                arguments.shard_root,
                arguments.shards,
            )
            print(json.dumps({"shards": [str(path) for path in paths]}, ensure_ascii=False))
            return 0
        if arguments.command == "prepare-retry":
            paths = prepare_retry_shards(
                arguments.input,
                arguments.root_dir,
                arguments.shard_root,
                arguments.shards,
            )
            print(json.dumps({"shards": [str(path) for path in paths]}, ensure_ascii=False))
            return 0
        if arguments.command == "merge":
            count = merge_shards(arguments.root_dir, tuple(arguments.shard_dir))
            print(json.dumps({"records": count}, ensure_ascii=False))
            return 0
        if arguments.command == "merge-retry":
            count = merge_retry_shards(arguments.root_dir, tuple(arguments.shard_dir))
            print(json.dumps({"records": count}, ensure_ascii=False))
            return 0
        raise ShardingError(f"unsupported command: {arguments.command}")
    except (LockError, ShardingError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
