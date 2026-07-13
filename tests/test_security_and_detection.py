"""Unit coverage for the imported security and protection-detection boundary."""
from __future__ import annotations

import pytest

from app.config import Config, host_is_allowed, parse_bypass_headers, validate_config
from app.detection import detect_protection
from app.security import is_private_address, parse_proxy


def test_allowlist_and_private_network_detection():
    assert host_is_allowed("www.example.com", ("*.example.com",))
    assert not host_is_allowed("example.com", ("*.example.com",))
    assert is_private_address("127.0.0.1")
    assert is_private_address("fd00::1")
    assert not is_private_address("1.1.1.1")


def test_bypass_headers_are_exact_host_safe_x_headers():
    assert parse_bypass_headers(
        '{"Capture.Example.com.":{"X-Harvester-Bypass":"secret"}}'
    ) == {"capture.example.com": {"x-harvester-bypass": "secret"}}
    with pytest.raises(ValueError, match="safe custom"):
        parse_bypass_headers('{"example.com":{"authorization":"secret"}}')
    with pytest.raises(ValueError, match="single-line"):
        parse_bypass_headers('{"example.com":{"x-test":"line\\nbreak"}}')


def test_config_requires_api_key_allowlist_and_bypass_coverage():
    base = Config(api_key="key", allowed_hosts=("example.com",), bypass_headers_by_host={})
    validate_config(base)
    with pytest.raises(ValueError, match="not covered"):
        validate_config(
            Config(
                api_key="key",
                allowed_hosts=("example.com",),
                bypass_headers_by_host={"other.example": {"x-test": "secret"}},
            )
        )


def test_proxy_rejects_embedded_credentials_and_unsupported_schemes():
    assert parse_proxy({"server": "http://proxy.example:8080", "username": "u"})["username"] == "u"
    with pytest.raises(ValueError, match="credentials"):
        parse_proxy({"server": "http://u:p@proxy.example"})
    with pytest.raises(ValueError, match="must use"):
        parse_proxy({"server": "ftp://proxy.example"})


def test_protection_detection_reports_provider_without_secret_values():
    result = detect_protection(
        status=403,
        headers={"server": "cloudflare", "cf-mitigated": "challenge"},
        cookies=[{"name": "__cf_bm", "value": "secret"}],
        html="<title>Just a moment...</title>",
    )
    assert result["challengeDetected"] is True
    assert result["providers"][0]["name"] == "cloudflare"
    assert result["providers"][0]["confidence"] == "high"
