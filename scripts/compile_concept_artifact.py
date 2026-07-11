#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_OUTPUT = ROOT / "docs" / "site" / "data" / "concepts" / "icml2026_concepts.json"


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(
        description="Compile and audit validated ICML concept browser artifacts."
    )
    commands = argument_parser.add_subparsers(dest="command", required=True)
    compile_parser = commands.add_parser(
        "compile", help="Publish validated review cache entries."
    )
    compile_parser.add_argument(
        "--candidates", required=True, type=Path, help="Stage-one candidate artifact."
    )
    compile_parser.add_argument(
        "--review-dir",
        required=True,
        type=Path,
        help="Stage-two runner output directory.",
    )
    compile_parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        type=Path,
        help="Published browser artifact path.",
    )
    audit_parser = commands.add_parser(
        "audit", help="Check published artifact provenance and bounds."
    )
    audit_parser.add_argument(
        "--artifact",
        default=DEFAULT_OUTPUT,
        type=Path,
        help="Published browser artifact path.",
    )
    audit_parser.add_argument(
        "--candidates",
        required=True,
        type=Path,
        help="Current stage-one candidate artifact.",
    )
    audit_parser.add_argument(
        "--review-dir",
        required=True,
        type=Path,
        help="Current stage-two runner output directory.",
    )
    return argument_parser


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    compiler = importlib.import_module("scripts.concept_artifact_compiler")
    auditor = importlib.import_module("scripts.concept_artifact_audit")
    try:
        if arguments.command == "compile":
            artifact = compiler.compile_artifact(
                arguments.candidates, arguments.review_dir, arguments.output
            )
            print(
                json.dumps(
                    {"output": str(arguments.output), "summary": artifact["summary"]},
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
            return 0
        errors = auditor.audit_artifact(
            arguments.artifact, arguments.candidates, arguments.review_dir
        )
    except compiler.CompileError as exc:
        print(
            json.dumps(
                {"ok": False, "errors": [str(exc)]}, ensure_ascii=False, sort_keys=True
            ),
            file=sys.stderr,
        )
        return 2
    print(
        json.dumps(
            {"ok": not errors, "errors": errors}, ensure_ascii=False, sort_keys=True
        )
    )
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
