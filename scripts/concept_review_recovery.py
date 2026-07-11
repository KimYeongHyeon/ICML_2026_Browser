from __future__ import annotations

import hashlib
import re
from pathlib import Path


EXPLICIT_TERMINAL_SIGNALS = (
    "unauthorized", "authentication", "api key", "login",
    "invalid_json_schema", "json schema", "response_format", "response format", "output schema",
    "cannot determine codex cli version", "concept contract is unavailable", "config.toml",
    "invalid configuration", "invalid config", "configuration error", "config error", "configuration file",
    "unrecognized arguments", "unknown argument", "unknown option", "invalid argument", "startup",
)


def record_filename(record_id: str) -> str:
    label = "".join(character if character.isalnum() or character in "._-" else "-" for character in record_id).strip("-._")[:64] or "record"
    return f"{label}-{hashlib.sha256(record_id.encode('utf-8')).hexdigest()[:12]}"


def failure_text(state: dict[str, object], logs_path: Path, record_id: str) -> str:
    error = state.get("error")
    stderr = [path.read_text(encoding="utf-8") for path in logs_path.glob(f"{record_filename(record_id)}.attempt-*.stderr.log")]
    return "\n".join(([error] if isinstance(error, str) else []) + stderr).lower()


def has_explicit_terminal_signal(text: str) -> bool:
    return has_status_code(text, ("401", "403")) or any(signal in text for signal in EXPLICIT_TERMINAL_SIGNALS)


def has_status_code(text: str, codes: tuple[str, ...]) -> bool:
    return any(re.search(rf"(?<![\w.]){code}(?![\w.])", text) is not None for code in codes)


def is_legacy_recoverable(state: dict[str, object], text: str) -> bool:
    return state.get("errorCategory") == "auth_config" and not has_explicit_terminal_signal(text)


def retry_failure_groups(states: dict[str, object], logs_path: Path) -> tuple[set[str], set[str]]:
    legacy_ids: set[str] = set()
    terminal_ids: set[str] = set()
    for record_id, state in states.items():
        if isinstance(state, dict) and state.get("status") == "failed":
            text = failure_text(state, logs_path, record_id)
            if is_legacy_recoverable(state, text):
                legacy_ids.add(record_id)
            elif has_explicit_terminal_signal(text):
                terminal_ids.add(record_id)
    return legacy_ids, terminal_ids
