from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import NoReturn, TypeAlias


JsonValue: TypeAlias = (
    None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
)


class CompileError(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(detail)

    def __str__(self) -> str:
        return self.detail


class NonstandardJsonConstantError(Exception):
    def __init__(self, value: str) -> None:
        self.value = value
        super().__init__(value)

    def __str__(self) -> str:
        return f"nonstandard JSON constant: {self.value}"


def canonical_json(value: JsonValue) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def sha256_text(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _reject_nonstandard_json_constant(value: str) -> NoReturn:
    raise NonstandardJsonConstantError(value)


def read_json_object(path: Path) -> tuple[dict[str, JsonValue], str]:
    try:
        raw_text = path.read_text(encoding="utf-8")
        payload = json.loads(raw_text, parse_constant=_reject_nonstandard_json_constant)
    except (OSError, ValueError, NonstandardJsonConstantError) as exc:
        raise CompileError(f"cannot read JSON object {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise CompileError(f"expected JSON object in {path}")
    return payload, raw_text


def atomic_write_json(path: Path, value: dict[str, JsonValue]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        handle.write(
            json.dumps(
                value, allow_nan=False, ensure_ascii=False, indent=2, sort_keys=True
            )
            + "\n"
        )
        temporary_path = Path(handle.name)
    os.replace(temporary_path, path)
