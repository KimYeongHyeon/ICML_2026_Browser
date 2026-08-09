#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


CONFERENCE_NAME = {{ cookiecutter.conference_name | jsonify }}
CONFERENCE_SLUG = {{ cookiecutter.conference_slug | jsonify }}
CONFERENCE_YEAR = {{ cookiecutter.conference_year | jsonify }}
PROJECT_SLUG = {{ cookiecutter.project_slug | jsonify }}
ARCHIVE_ROOT = Path({{ cookiecutter.archive_root | jsonify }}).expanduser()

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


if not CONFERENCE_NAME.strip() or any(ord(char) < 32 for char in CONFERENCE_NAME):
    fail("conference_name must be non-empty and contain no control characters")
if not SLUG_RE.fullmatch(CONFERENCE_SLUG):
    fail("conference_slug must contain lowercase letters, digits, and single hyphens only")
if not YEAR_RE.fullmatch(CONFERENCE_YEAR):
    fail("conference_year must be a four-digit year between 1900 and 2099")
if not SLUG_RE.fullmatch(PROJECT_SLUG):
    fail("project_slug must contain lowercase letters, digits, and single hyphens only")
if not ARCHIVE_ROOT.is_absolute() or not ARCHIVE_ROOT.is_dir():
    fail("archive_root must be an existing absolute directory")

queue_path = ARCHIVE_ROOT / "queues" / CONFERENCE_SLUG / f"{CONFERENCE_YEAR}.jsonl"
if not queue_path.is_file():
    fail(f"canonical archive queue does not exist: {queue_path}")
