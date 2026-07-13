"""Environment-backed runtime configuration."""
from __future__ import annotations

from dataclasses import dataclass
from os import environ
from typing import Mapping


@dataclass(frozen=True)
class Config:
    port: int = 8080
    max_concurrency: int = 2
    navigation_timeout_ms: int = 45_000
    max_html_bytes: int = 2_000_000
    max_body_bytes: int = 64 * 1024


def _positive_int(value: str | None, fallback: int) -> int:
    try:
        parsed = int(value or "")
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def load_config(env: Mapping[str, str] | None = None) -> Config:
    values = environ if env is None else env
    return Config(
        port=_positive_int(values.get("PORT"), 8080),
        max_concurrency=_positive_int(values.get("MAX_CONCURRENCY"), 2),
        navigation_timeout_ms=_positive_int(values.get("NAVIGATION_TIMEOUT_MS"), 45_000),
        max_html_bytes=_positive_int(values.get("MAX_HTML_BYTES"), 2_000_000),
        max_body_bytes=_positive_int(values.get("MAX_BODY_BYTES"), 64 * 1024),
    )
