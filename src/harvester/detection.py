"""Non-secret WAF and anti-bot protection marker detection."""
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

Headers = Mapping[str, str]
Detector = Callable[[Headers, list[str], str], list[str]]


_BLOCK_STATUSES = {401, 403, 429, 503}


def _header_present(*names: str) -> Detector:
    def check(headers: Headers, _cookies: list[str], _body: str) -> list[str]:
        return [f"header:{name}" for name in names if name in headers]
    return check


def _header_matches(header: str, pattern: str, marker: str) -> Detector:
    regex = re.compile(pattern)
    def check(headers: Headers, _cookies: list[str], _body: str) -> list[str]:
        return [marker] if regex.search(headers.get(header, "")) else []
    return check


def _header_prefix(prefix: str, marker: str, *extra_names: str) -> Detector:
    def check(headers: Headers, _cookies: list[str], _body: str) -> list[str]:
        if any(name.startswith(prefix) for name in headers) or any(name in headers for name in extra_names):
            return [marker]
        return []
    return check


def _cookie_matches(pattern: str, marker: str) -> Detector:
    regex = re.compile(pattern)
    def check(_headers: Headers, cookies: list[str], _body: str) -> list[str]:
        return [marker] if any(regex.match(name) for name in cookies) else []
    return check


def _cookie_contains(name: str, marker: str) -> Detector:
    def check(_headers: Headers, cookies: list[str], _body: str) -> list[str]:
        return [marker] if name in cookies else []
    return check


def _body_contains(pattern: str, marker: str) -> Detector:
    regex = re.compile(pattern)
    def check(_headers: Headers, _cookies: list[str], body: str) -> list[str]:
        return [marker] if regex.search(body) else []
    return check


def _body_matches(pattern: str) -> Callable[[Headers, str], bool]:
    regex = re.compile(pattern)
    return lambda _headers, body: bool(regex.search(body))


def _header_value_matches(header: str, pattern: str) -> Callable[[Headers, str], bool]:
    regex = re.compile(pattern)
    return lambda headers, _body: bool(regex.search(headers.get(header, "")))


def _any_challenge(*checks: Callable[[Headers, str], bool]) -> Callable[[Headers, str], bool]:
    return lambda headers, body: any(check(headers, body) for check in checks)


@dataclass
class ProviderSpec:
    name: str
    detectors: list[Detector]
    challenge: Callable[[Headers, str], bool] = field(default=lambda headers, body: False)


_PROVIDERS = [
    ProviderSpec(
        name="cloudflare",
        detectors=[
            _header_present("cf-ray"),
            _header_matches("server", r"cloudflare", "header:server-cloudflare"),
            _header_matches("cf-mitigated", r"challenge", "header:cf-mitigated"),
            _cookie_matches(r"^(?:__cf|cf_)", "cookie:cloudflare"),
            _body_contains(r"cdn-cgi/challenge-platform|cf-chl-|cf-browser-verification|<title[^>]*>\s*just a moment", "html:cloudflare-challenge"),
        ],
        challenge=_any_challenge(
            _body_matches(r"cdn-cgi/challenge-platform|cf-chl-|cf-browser-verification|<title[^>]*>\s*just a moment"),
            _header_value_matches("cf-mitigated", r"challenge"),
        ),
    ),
    ProviderSpec(
        name="imperva",
        detectors=[
            _header_present("x-iinfo"),
            _header_matches("x-cdn", r"imperva|incapsula", "header:x-cdn-imperva"),
            _cookie_matches(r"^(?:visid_incap_|incap_ses_|nlbi_|reese84$|___utmvc$)", "cookie:imperva"),
            _body_contains(r"/_incapsula_resource", "html:incapsula-resource"),
            _body_contains(r"incapsula incident id|request unsuccessful[^<]*incapsula|imperva[^<]*(?:access denied|blocked)", "html:imperva-block"),
        ],
        challenge=_body_matches(r"incapsula incident id|request unsuccessful[^<]*incapsula|imperva[^<]*(?:access denied|blocked)"),
    ),
    ProviderSpec(
        name="akamai",
        detectors=[
            _header_matches("server", r"akamaighost", "header:server-akamaighost"),
            _header_prefix("x-akamai-", "header:akamai", "akamai-grn"),
            _cookie_matches(r"^(?:_abck|ak_bmsc|bm_sv|bm_sz)$", "cookie:akamai"),
            _body_contains(r"access denied[^]*reference #[0-9a-f.]+|akamai[^<]*(?:bot manager|access denied)", "html:akamai-block"),
        ],
        challenge=_body_matches(r"access denied[^]*reference #[0-9a-f.]+|akamai[^<]*(?:bot manager|access denied)"),
    ),
    ProviderSpec(
        name="datadome",
        detectors=[
            _header_present("x-datadome"),
            _cookie_contains("datadome", "cookie:datadome"),
            _body_contains(r"captcha-delivery\.com|geo\.captcha-delivery\.com|dd_captcha", "html:datadome-captcha"),
        ],
        challenge=_body_matches(r"captcha-delivery\.com|geo\.captcha-delivery\.com|dd_captcha"),
    ),
    ProviderSpec(
        name="human-perimeterx",
        detectors=[
            _cookie_matches(r"^_px(?:3|vid|hd)$", "cookie:human-perimeterx"),
            _body_contains(r"captcha\.px-cloud\.net|_pxcaptcha|perimeterx", "html:human-perimeterx-challenge"),
        ],
        challenge=_body_matches(r"captcha\.px-cloud\.net|_pxcaptcha|perimeterx"),
    ),
    ProviderSpec(
        name="sucuri",
        detectors=[
            _header_prefix("x-sucuri-", "header:sucuri"),
            _header_matches("server", r"sucuri", "header:server-sucuri"),
            _cookie_matches(r"^sucuri_cloudproxy_uuid", "cookie:sucuri"),
            _body_contains(r"sucuri website firewall[^<]*(?:access denied|blocked)", "html:sucuri-block"),
        ],
        challenge=_body_matches(r"sucuri website firewall[^<]*(?:access denied|blocked)"),
    ),
    ProviderSpec(
        name="aws-waf",
        detectors=[
            _header_present("x-amzn-waf-action"),
            _cookie_contains("aws-waf-token", "cookie:aws-waf-token"),
            _body_contains(r"awswafcaptcha|aws-waf-token", "html:aws-waf-challenge"),
        ],
        challenge=_any_challenge(
            _header_value_matches("x-amzn-waf-action", r"challenge|captcha"),
            _body_matches(r"awswafcaptcha|aws-waf-token"),
        ),
    ),
    ProviderSpec(
        name="kasada",
        detectors=[
            _header_prefix("x-kpsdk-", "header:kasada"),
            _body_contains(r"kpsdk|/ips\.js(?:[?\"'])", "html:kasada-sdk"),
            _body_contains(r"x-kpsdk-ct|kpsdk.*challenge", "html:kasada-challenge"),
        ],
        challenge=_body_matches(r"x-kpsdk-ct|kpsdk.*challenge"),
    ),
]


_GENERIC_CHALLENGE_MARKERS = [
    "just a moment",
    "checking your browser",
    "verifying you are human",
    "enable javascript and cookies to continue",
    "attention required",
    "ddos-guard",
    "please wait while we verify",
    "one more step",
    "verification is taking",
]


def detect_challenge(html: str = "", title: str = "") -> bool:
    """Best-effort challenge-page detection from page content alone (no headers/cookies)."""
    body = f"{title}\n{html}"[:250_000].lower()
    if any(marker in body for marker in _GENERIC_CHALLENGE_MARKERS):
        return True
    return any(spec.challenge({}, body) for spec in _PROVIDERS)


def _evaluate(spec: ProviderSpec, headers: Headers, cookies: list[str], body: str, status: int | None) -> dict[str, Any] | None:
    markers = [marker for detector in spec.detectors for marker in detector(headers, cookies, body)]
    if not markers:
        return None
    explicit = spec.challenge(headers, body)
    return {
        "name": spec.name,
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

    providers = [
        match
        for spec in _PROVIDERS
        if (match := _evaluate(spec, normalized_headers, cookie_names, body, status))
    ]

    return {
        "challengeDetected": any(entry["challengeDetected"] for entry in providers),
        "blockingResponse": any(entry["blockingResponse"] for entry in providers),
        "providers": providers,
    }
