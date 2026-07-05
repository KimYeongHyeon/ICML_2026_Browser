from __future__ import annotations

import re


def normalize_space(value: str) -> str:
    value = re.sub(r"(?<=\w)-\s+(?!(?:and|or)\b)(?=\w)", "", value, flags=re.I)
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"^Abstract:?\s+", "", value, flags=re.I)
    return value.strip()


def has_sequential_numeric_labels(value: str) -> bool:
    text = normalize_space(value)[:1600]
    pattern = re.compile(r"(?<![A-Za-z0-9])(\d{3})(?![A-Za-z0-9])|[A-Za-z](\d{3})(?=\b|[A-Za-z])|(?<!\d)(\d{3})(?=[A-Za-z])")
    labels = [int(next(group for group in match.groups() if group)) for match in pattern.finditer(text)]
    if len(labels) < 6:
        return False
    consecutive = 1
    for left, right in zip(labels, labels[1:]):
        consecutive = consecutive + 1 if right == left + 1 else 1
        if consecutive >= 6:
            return True
    return False


def starts_with_numeric_label_run(value: str) -> bool:
    tokens = normalize_space(value).split()[:50]
    numeric_prefix: list[int] = []
    for token in tokens:
        if not re.fullmatch(r"\d{1,3}", token):
            break
        numeric_prefix.append(int(token))
    if len(numeric_prefix) < 8:
        return False
    run = 1
    for left, right in zip(numeric_prefix, numeric_prefix[1:]):
        run = run + 1 if right == left + 1 else 1
        if run >= 8:
            return True
    return False


def has_submission_page_header(value: str) -> bool:
    text = normalize_space(value)[:500].lower()
    return (
        "submitted to" in text
        or "do not distribute" in text
        or "preliminary work" in text
        or re.search(r"\bfigure\s+1\b", text) is not None
        or re.search(r"\btable\s+1\b", text) is not None
    )


def has_low_alphabetic_signal(value: str) -> bool:
    text = normalize_space(value)[:1200]
    if len(text) < 120:
        return False
    alpha = len(re.findall(r"[A-Za-z]", text))
    numeric_tokens = len(re.findall(r"(?<![A-Za-z0-9])\d{1,3}(?![A-Za-z0-9])", text))
    tokens = max(1, len(text.split()))
    return alpha / max(1, len(text)) < 0.35 or numeric_tokens / tokens >= 0.35


def abstract_quality_flags(value: str) -> list[str]:
    text = normalize_space(value)
    if not text:
        return ["empty"]
    flags: list[str] = []
    if len(text) < 80:
        flags.append("too_short")
    if re.match(r"^(references|bibliography|figure|table)\b", text, flags=re.I):
        flags.append("starts_with_non_abstract_section")
    if starts_with_numeric_label_run(text):
        flags.append("starts_with_numeric_line_labels")
    if has_sequential_numeric_labels(text):
        flags.append("sequential_numeric_line_labels")
    if has_submission_page_header(text):
        flags.append("submission_page_header")
    if has_low_alphabetic_signal(text):
        flags.append("low_alphabetic_signal")
    return flags


def usable_abstract(value: str) -> bool:
    return not abstract_quality_flags(value)
