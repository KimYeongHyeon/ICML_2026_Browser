from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class LockError(Exception):
    pass


def write_lock(path: Path) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(str(os.getpid()))


def stale_detail(path: Path) -> str:
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return "malformed_lock"
    if pid < 1:
        return "malformed_lock"
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return f"dead_pid:{pid}"
    except PermissionError:
        return "live_pid"
    return "live_pid"


@contextmanager
def output_lock(path: Path, steal_lock: bool) -> Iterator[str | None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    recovery: str | None = None
    try:
        write_lock(path)
    except FileExistsError as exc:
        detail = stale_detail(path)
        if not steal_lock:
            raise LockError(f"review runner is already active: {path}") from exc
        if detail == "live_pid":
            raise LockError(f"refusing to steal live PID lock: {path}") from exc
        stale_path = path.with_name(f".{path.name}.{os.getpid()}.stale")
        try:
            os.replace(path, stale_path)
        except FileNotFoundError:
            try:
                write_lock(path)
            except FileExistsError as race:
                raise LockError(f"review runner lock changed during recovery: {path}") from race
        else:
            try:
                write_lock(path)
            except FileExistsError as race:
                raise LockError(f"review runner lock changed during recovery: {path}") from race
            finally:
                stale_path.unlink(missing_ok=True)
            recovery = detail
    try:
        yield recovery
    finally:
        path.unlink(missing_ok=True)
