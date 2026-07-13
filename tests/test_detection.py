"""Protection marker detection tests."""
from __future__ import annotations

from app.detection import detect_protection


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
