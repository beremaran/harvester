"""Secret redaction for cookies, storage, and HTTP headers."""

from typing import Any

from harvester.config import Config


def redact(value: Any, expose: bool) -> str:
    return str(value) if expose else "[REDACTED]"


def bypass_header_names(config: Config) -> set[str]:
    return {name.lower() for headers in (config.bypass_headers_by_host or {}).values() for name in headers}


def redact_request_headers(headers: dict[str, Any], include_secrets: bool, config: Config) -> dict[str, str]:
    bypass_headers = bypass_header_names(config)
    sensitive = {"authorization", "proxy-authorization", "cookie"}
    result: dict[str, str] = {}
    for name, value in (headers or {}).items():
        normalized = str(name).lower()
        if normalized in bypass_headers:
            result[normalized] = "[REDACTED]"
        elif normalized in sensitive:
            result[normalized] = redact(value, include_secrets)
        else:
            result[normalized] = str(value)
    return result


def redact_response_headers(headers: dict[str, Any], config: Config) -> dict[str, str]:
    bypass_headers = bypass_header_names(config)
    return {
        str(name).lower(): str(value)
        for name, value in (headers or {}).items()
        if str(name).lower() != "set-cookie" and str(name).lower() not in bypass_headers
    }


_SCRAPER_HEADER_NAMES = (
    "accept",
    "accept-language",
    "cache-control",
    "pragma",
    "referer",
    "user-agent",
)


def build_scraper_headers(request_headers: dict[str, Any], cookie_header: str, include_secrets: bool) -> dict[str, str]:
    normalized = {str(name).lower(): str(value) for name, value in (request_headers or {}).items()}
    result = {name: normalized[name] for name in _SCRAPER_HEADER_NAMES if name in normalized}
    if include_secrets and cookie_header:
        result["cookie"] = cookie_header
    return result


def redacted_storage(values: dict[str, str], include_secrets: bool) -> dict[str, str]:
    return {str(key): redact(value, include_secrets) for key, value in values.items()}
