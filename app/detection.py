"""Non-secret WAF and anti-bot protection marker detection."""
from __future__ import annotations

import re
from typing import Any, Mapping


_BLOCK_STATUSES = {403, 429, 503}


def _provider(name: str, markers: list[str], explicit: bool, status: int | None) -> dict[str, Any] | None:
    if not markers:
        return None
    return {
        "name": name,
        "confidence": "high" if explicit or any(marker.startswith("header:") for marker in markers) else "medium",
        "challengeDetected": explicit,
        "blockingResponse": status in _BLOCK_STATUSES,
        "markers": markers,
    }


def detect_protection(
    *, status: int | None = None, headers: Mapping[str, Any] | None = None,
    cookies: list[Mapping[str, Any]] | None = None, html: str = "",
) -> dict[str, Any]:
    normalized_headers = {str(name).lower(): str(value).lower() for name, value in (headers or {}).items()}
    cookie_names = [str(cookie.get("name", "")).lower() for cookie in (cookies or [])]
    body = str(html)[:250_000].lower()
    providers: list[dict[str, Any]] = []

    markers: list[str] = []
    if "cf-ray" in normalized_headers:
        markers.append("header:cf-ray")
    if "cloudflare" in normalized_headers.get("server", ""):
        markers.append("header:server-cloudflare")
    if re.search(r"challenge", normalized_headers.get("cf-mitigated", "")):
        markers.append("header:cf-mitigated")
    if any(re.match(r"^(?:__cf|cf_)", name) for name in cookie_names):
        markers.append("cookie:cloudflare")
    html_challenge = bool(re.search(r"cdn-cgi/challenge-platform|cf-chl-|cf-browser-verification|<title[^>]*>\s*just a moment", body))
    header_challenge = bool(re.search(r"challenge", normalized_headers.get("cf-mitigated", "")))
    if html_challenge:
        markers.append("html:cloudflare-challenge")
    if (match := _provider("cloudflare", markers, html_challenge or header_challenge, status)):
        providers.append(match)

    markers = []
    if "x-iinfo" in normalized_headers:
        markers.append("header:x-iinfo")
    if re.search(r"imperva|incapsula", normalized_headers.get("x-cdn", "")):
        markers.append("header:x-cdn-imperva")
    if any(re.match(r"^(?:visid_incap_|incap_ses_|nlbi_|reese84$|___utmvc$)", name) for name in cookie_names):
        markers.append("cookie:imperva")
    if "/_incapsula_resource" in body:
        markers.append("html:incapsula-resource")
    challenged = bool(re.search(r"incapsula incident id|request unsuccessful[^<]*incapsula|imperva[^<]*(?:access denied|blocked)", body))
    if challenged:
        markers.append("html:imperva-block")
    if (match := _provider("imperva", markers, challenged, status)):
        providers.append(match)

    markers = []
    if "akamaighost" in normalized_headers.get("server", ""):
        markers.append("header:server-akamaighost")
    if any(name.startswith("x-akamai-") for name in normalized_headers) or "akamai-grn" in normalized_headers:
        markers.append("header:akamai")
    if any(re.match(r"^(?:_abck|ak_bmsc|bm_sv|bm_sz)$", name) for name in cookie_names):
        markers.append("cookie:akamai")
    challenged = bool(re.search(r"access denied[^]*reference #[0-9a-f.]+|akamai[^<]*(?:bot manager|access denied)", body))
    if challenged:
        markers.append("html:akamai-block")
    if (match := _provider("akamai", markers, challenged, status)):
        providers.append(match)

    markers = []
    if "x-datadome" in normalized_headers:
        markers.append("header:x-datadome")
    if "datadome" in cookie_names:
        markers.append("cookie:datadome")
    challenged = bool(re.search(r"captcha-delivery\.com|geo\.captcha-delivery\.com|dd_captcha", body))
    if challenged:
        markers.append("html:datadome-captcha")
    if (match := _provider("datadome", markers, challenged, status)):
        providers.append(match)

    markers = []
    if any(re.match(r"^_px(?:3|vid|hd)$", name) for name in cookie_names):
        markers.append("cookie:human-perimeterx")
    challenged = bool(re.search(r"captcha\.px-cloud\.net|_pxcaptcha|perimeterx", body))
    if challenged:
        markers.append("html:human-perimeterx-challenge")
    if (match := _provider("human-perimeterx", markers, challenged, status)):
        providers.append(match)

    markers = []
    if any(name.startswith("x-sucuri-") for name in normalized_headers):
        markers.append("header:sucuri")
    if "sucuri" in normalized_headers.get("server", ""):
        markers.append("header:server-sucuri")
    if any(name.startswith("sucuri_cloudproxy_uuid") for name in cookie_names):
        markers.append("cookie:sucuri")
    challenged = bool(re.search(r"sucuri website firewall[^<]*(?:access denied|blocked)", body))
    if challenged:
        markers.append("html:sucuri-block")
    if (match := _provider("sucuri", markers, challenged, status)):
        providers.append(match)

    markers = []
    if "x-amzn-waf-action" in normalized_headers:
        markers.append("header:x-amzn-waf-action")
    if "aws-waf-token" in cookie_names:
        markers.append("cookie:aws-waf-token")
    html_challenge = bool(re.search(r"awswafcaptcha|aws-waf-token", body))
    if html_challenge:
        markers.append("html:aws-waf-challenge")
    challenged = bool(re.search(r"challenge|captcha", normalized_headers.get("x-amzn-waf-action", ""))) or html_challenge
    if (match := _provider("aws-waf", markers, challenged, status)):
        providers.append(match)

    markers = []
    if any(name.startswith("x-kpsdk-") for name in normalized_headers):
        markers.append("header:kasada")
    if re.search(r"kpsdk|/ips\.js(?:[?\"'])", body):
        markers.append("html:kasada-sdk")
    challenged = bool(re.search(r"x-kpsdk-ct|kpsdk.*challenge", body))
    if challenged:
        markers.append("html:kasada-challenge")
    if (match := _provider("kasada", markers, challenged, status)):
        providers.append(match)

    return {
        "challengeDetected": any(entry["challengeDetected"] for entry in providers),
        "blockingResponse": any(entry["blockingResponse"] for entry in providers),
        "providers": providers,
    }
