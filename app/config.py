"""Environment-backed service configuration and WAF bypass validation."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from os import environ
from typing import Mapping


_BLOCKED_BYPASS_HEADERS = re.compile(r"^(?:x-forwarded-|x-real-ip$|x-original-|x-rewrite-)")


@dataclass(frozen=True)
class Config:
    port: int = 8080
    api_key: str = ""
    allowed_hosts: tuple[str, ...] = ()
    allow_private_networks: bool = False
    capture_secret_values: bool = False
    max_concurrency: int = 2
    navigation_timeout_ms: int = 45_000
    max_html_bytes: int = 2_000_000
    max_body_bytes: int = 64 * 1024
    bypass_headers_by_host: dict[str, dict[str, str]] | None = None
    allow_insecure_bypass_headers: bool = False
    allow_caller_headers: bool = False


def _positive_int(value: str | None, fallback: int) -> int:
    try:
        parsed = int(value or "")
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def parse_bypass_headers(raw: str = "") -> dict[str, dict[str, str]]:
    """Parse exact-host owner-managed WAF exceptions without exposing secrets."""
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("BYPASS_HEADERS_JSON must be valid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("BYPASS_HEADERS_JSON must be an object keyed by exact hostname")

    result: dict[str, dict[str, str]] = {}
    for raw_host, raw_headers in value.items():
        host = str(raw_host).lower().removesuffix(".")
        if (
            not re.fullmatch(r"[a-z0-9.-]+", host)
            or host.startswith(".")
            or host.endswith(".")
            or ".." in host
            or host.startswith("*.")
        ):
            raise ValueError(f"invalid bypass hostname: {raw_host}")
        if not isinstance(raw_headers, dict):
            raise ValueError(f"bypass headers for {host} must be an object")

        headers: dict[str, str] = {}
        for raw_name, raw_value in raw_headers.items():
            name = str(raw_name).lower()
            if not re.fullmatch(r"x-[a-z0-9-]+", name) or _BLOCKED_BYPASS_HEADERS.match(name):
                raise ValueError(f"bypass header {raw_name} must be a safe custom x-* header")
            if (
                not isinstance(raw_value, str)
                or not raw_value
                or len(raw_value) > 4096
                or "\r" in raw_value
                or "\n" in raw_value
            ):
                raise ValueError(
                    f"bypass header {raw_name} must have a non-empty single-line string value"
                )
            headers[name] = raw_value
        if not headers:
            raise ValueError(f"bypass headers for {host} cannot be empty")
        result[host] = headers
    return result


def load_config(env: Mapping[str, str] | None = None) -> Config:
    values = environ if env is None else env
    allowed_hosts = tuple(
        host.strip().lower().removesuffix(".")
        for host in values.get("ALLOWED_HOSTS", "").split(",")
        if host.strip()
    )
    return Config(
        port=_positive_int(values.get("PORT"), 8080),
        api_key=values.get("API_KEY", ""),
        allowed_hosts=allowed_hosts,
        allow_private_networks=values.get("ALLOW_PRIVATE_NETWORKS", "false").lower() == "true",
        capture_secret_values=values.get("CAPTURE_SECRET_VALUES", "false").lower() == "true",
        max_concurrency=_positive_int(values.get("MAX_CONCURRENCY"), 2),
        navigation_timeout_ms=_positive_int(values.get("NAVIGATION_TIMEOUT_MS"), 45_000),
        max_html_bytes=_positive_int(values.get("MAX_HTML_BYTES"), 2_000_000),
        max_body_bytes=_positive_int(values.get("MAX_BODY_BYTES"), 64 * 1024),
        bypass_headers_by_host=parse_bypass_headers(values.get("BYPASS_HEADERS_JSON", "")),
        allow_insecure_bypass_headers=values.get("ALLOW_INSECURE_BYPASS_HEADERS", "false").lower() == "true",
        allow_caller_headers=values.get("ALLOW_CALLER_HEADERS", "false").lower() == "true",
    )


def host_is_allowed(hostname: str, allowed_hosts: tuple[str, ...] | list[str]) -> bool:
    host = hostname.lower().removesuffix(".")
    for allowed in allowed_hosts:
        normalized = allowed.lower().removeprefix("*.").removesuffix(".")
        if allowed.startswith("*."):
            if host.endswith(f".{normalized}"):
                return True
        elif host == normalized:
            return True
    return False


def validate_config(config: Config) -> None:
    if not config.api_key:
        raise ValueError("API_KEY must be configured")
    if not config.allowed_hosts:
        raise ValueError("ALLOWED_HOSTS must contain at least one authorized hostname")
    for host in (config.bypass_headers_by_host or {}):
        if not host_is_allowed(host, config.allowed_hosts):
            raise ValueError(f"bypass hostname {host} is not covered by ALLOWED_HOSTS")
