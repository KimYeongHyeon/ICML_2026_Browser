#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys


ARCHIVE_ROOT = {{ cookiecutter.archive_root | jsonify }}


def run(*args: str) -> None:
    subprocess.run([sys.executable, *args], check=True)


run("scripts/sync_archive.py", "--archive-root", ARCHIVE_ROOT)
run("scripts/build_site.py")
run("-m", "unittest", "discover", "-s", "tests", "-v")
