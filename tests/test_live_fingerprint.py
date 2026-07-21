"""Live anti-bot / fingerprinting tests, one target per test.

These extend ``test_live_stealth.py`` (sannysoft + raw signals) to the rest of
the public detection sandboxes: a modern Playwright-leak detector, a headless
verdict page, CreepJS, a WebGL renderer check, an IP/browser trust verdict, a
TLS/HTTP2 network-fingerprint endpoint, and a real Cloudflare managed challenge.

They all drive the harvester's *real* stealth path so what a fingerprinter sees
is exactly what production sends:
  * ``Harvester.open_stealth_page`` — same launch flags / UA / evasions — for the
    client-side (JS) fingerprint checks, and
  * ``Harvester.harvest`` — the full navigate + challenge-wait pipeline — for the
    Cloudflare interstitial check.

Discipline (same as test_live_stealth.py):
  * Reach the public internet, so gated behind ``RUN_LIVE_TESTS=1`` via the
    ``live`` marker (see conftest.py).
  * A site being unreachable (timeout / reset / gateway error) SKIPS, never fails.
  * If a page's verdict can't be located (layout changed, IP-blocked, JS didn't
    run) the test SKIPS rather than asserting on garbage. Only a *genuine
    detection* is a failure.

Because of that last rule, the verdict-parsing here is deliberately lenient: it
looks for an unambiguous "you're a bot / headless / software-GPU" signal and
fails on that, otherwise passes or skips. Tighten a given test's parsing once
you've seen its real response from your egress IP.

Run one target at a time with the Makefile, e.g. ``make live-rebrowser`` or
``make live-tls`` (maps to ``pytest -m live -k <target>``).
"""

import json

import pytest
from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeoutError

from harvester.browser import DEFAULT_UA
from harvester.models import HarvestRequest

pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.live,
]


async def _goto(page, url: str, *, timeout: int = 45_000, wait_until: str = "domcontentloaded"):
    """Navigate, turning network flakiness into a skip (not a failure)."""
    try:
        return await page.goto(url, wait_until=wait_until, timeout=timeout)
    except (PWTimeoutError, PWError) as exc:
        pytest.skip(f"live site unreachable: {url} ({type(exc).__name__}: {exc})")


async def _inner_text(page) -> str:
    try:
        return await page.evaluate("() => document.body ? document.body.innerText : ''")
    except Exception as exc:
        pytest.skip(f"could not read page text ({type(exc).__name__}: {exc})")


# --- rebrowser bot-detector -------------------------------------------------
# https://bot-detector.rebrowser.net/ runs modern, Playwright-aware probes
# (dummyFn, exposeFunctionLeak, sourceUrlLeak, mainWorldExecution,
# navigatorWebdriver, pwInitScripts, useragent, viewport). Each shows a status;
# a detection is rendered with a 🚨 / "detected" marker. A clean run is all ✅.

_REBROWSER = "https://bot-detector.rebrowser.net/"
_REBROWSER_KNOWN_TESTS = (
    "dummyFn",
    "exposeFunctionLeak",
    "sourceUrlLeak",
    "mainWorldExecution",
    "navigatorWebdriver",
    "pwInitScripts",
    "useragent",
    "viewport",
)


async def test_rebrowser_bot_detector_finds_no_leak(harvester):
    """rebrowser's Playwright-leak probes must not flag any detection."""
    req = HarvestRequest(url=_REBROWSER)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, _REBROWSER)
        # Probes (init-script leaks, source-url leaks) settle after load.
        await page.wait_for_timeout(4000)
        text = await _inner_text(page)

    if not any(name in text for name in _REBROWSER_KNOWN_TESTS):
        pytest.skip("rebrowser results not present (page shape changed or IP-blocked)")

    detections = [
        line.strip()
        for line in text.splitlines()
        if ("🚨" in line or "detected" in line.lower())
        and "not detected" not in line.lower()
        and "undetected" not in line.lower()
    ]
    assert not detections, f"rebrowser flagged automation leaks: {detections}"


# --- Antoine Vastel: are you headless? --------------------------------------
# https://arh.antoinevastel.com/bots/areyouheadless prints a one-line verdict:
# "You are not Chrome headless" (good) or "You are Chrome headless" (bad).

_AREYOUHEADLESS = "https://arh.antoinevastel.com/bots/areyouheadless"


async def test_areyouheadless_says_not_headless(harvester):
    req = HarvestRequest(url=_AREYOUHEADLESS)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, _AREYOUHEADLESS)
        await page.wait_for_timeout(2500)
        text = (await _inner_text(page)).lower()

    if "headless" not in text:
        pytest.skip("areyouheadless verdict not present (page shape changed / blocked)")
    assert "not chrome headless" in text or "you are not" in text, (
        f"flagged as headless; verdict text was: {text[:200]!r}"
    )


# --- CreepJS ----------------------------------------------------------------
# https://abrahamjuliot.github.io/creepjs/ is intentionally adversarial and its
# own "trust score" is volatile (it penalizes ANY API tampering, which stealth
# necessarily does), so we do NOT gate on the score. Instead we confirm the
# report actually computes and that the hard automation tells CreepJS keys on
# (webdriver / headless UA / selenium globals) are absent on its origin. The
# trust score, if found, is surfaced in the assertion message for visibility.

_CREEPJS = "https://abrahamjuliot.github.io/creepjs/"


async def test_creepjs_reports_no_bot(harvester):
    req = HarvestRequest(url=_CREEPJS)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, _CREEPJS)
        # CreepJS computes for 10-15s after load.
        await page.wait_for_timeout(12000)
        text = await _inner_text(page)

        signals = await page.evaluate(
            """() => ({
                webdriver: navigator.webdriver,
                ua: navigator.userAgent,
                seleniumGlobals: [
                    '__webdriver_evaluate', '__selenium_evaluate',
                    '__driver_evaluate', '_Selenium_IDE_Recorder', '__nightmare',
                ].filter(k => k in window || k in document),
                cdc: Object.keys(window).some(k => k.startsWith('cdc_')),
            })"""
        )

    if "trust score" not in text.lower() and "fingerprint" not in text.lower():
        pytest.skip("CreepJS report did not render (page shape changed / blocked)")

    assert signals["webdriver"] in (False, None), f"navigator.webdriver leaked on CreepJS: {signals['webdriver']!r}"
    assert "HeadlessChrome" not in signals["ua"], f"headless UA leaked: {signals['ua']}"
    assert not signals["seleniumGlobals"], f"selenium globals present: {signals['seleniumGlobals']}"
    assert not signals["cdc"], "ChromeDriver cdc_ globals present on CreepJS"


# --- browserleaks WebGL -----------------------------------------------------
# https://browserleaks.com/webgl shows the unmasked GPU renderer. A headless
# Chromium reports a software renderer (SwiftShader / llvmpipe / Mesa); our
# hardening spoofs a hardware ANGLE renderer. This checks a real detector agrees.

_WEBGL = "https://browserleaks.com/webgl"
_SOFTWARE_GPU_TELLS = ("SwiftShader", "llvmpipe", "Mesa OffScreen", "Software")


async def test_browserleaks_webgl_is_hardware(harvester):
    req = HarvestRequest(url=_WEBGL)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, _WEBGL)
        await page.wait_for_timeout(2500)
        text = await _inner_text(page)

    if "webgl" not in text.lower() or "renderer" not in text.lower():
        pytest.skip("browserleaks WebGL report not present (page shape changed / blocked)")

    leaked = [tell for tell in _SOFTWARE_GPU_TELLS if tell.lower() in text.lower()]
    assert not leaked, f"software WebGL renderer reported by browserleaks: {leaked}"


# --- iphey: browser trustworthiness -----------------------------------------
# https://iphey.com/ renders a verdict card: "Trustworthy" (good) vs
# "Suspicious" / "Not reliable" (bad). The words also appear in the page's
# explanatory copy, so we must read the VERDICT element, not the whole page —
# iphey renders exactly one of these three as a standalone status line/heading.
# It loads async and may block some egress IPs, in which case we skip.

_IPHEY = "https://iphey.com/"
_IPHEY_VERDICTS = ("trustworthy", "suspicious", "not reliable")


async def test_iphey_trustworthy(harvester):
    req = HarvestRequest(url=_IPHEY)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, _IPHEY, wait_until="networkidle")
        await page.wait_for_timeout(3000)
        text = await _inner_text(page)

    # The verdict is shown on its own line; match only standalone verdict lines,
    # never the same words embedded in a sentence of marketing copy.
    verdict_lines = {line.strip().lower() for line in text.splitlines() if line.strip().lower() in _IPHEY_VERDICTS}
    if not verdict_lines:
        pytest.skip("iphey verdict not present (async render / IP-blocked)")
    assert "suspicious" not in verdict_lines and "not reliable" not in verdict_lines, (
        f"iphey rated the browser as not trustworthy: {verdict_lines}"
    )


# --- TLS / HTTP2 network fingerprint ----------------------------------------
# https://tls.peet.ws/api/all returns the JA3 / JA4 / Akamai-HTTP2 fingerprints
# and the request headers the *browser's own* network stack produced (page.goto
# is a real navigation). The point: the transport fingerprint must be Chromium's
# and CONSISTENT with the Chrome UA we advertise — a curl/Go JA3 under a Chrome
# UA is itself a bot tell.

_TLS = "https://tls.peet.ws/api/all"


async def test_tls_fingerprint_is_chrome_consistent(harvester):
    req = HarvestRequest(url=_TLS)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        resp = await _goto(page, _TLS)
        try:
            body = await resp.text()
        except Exception as exc:
            pytest.skip(f"could not read TLS endpoint body ({type(exc).__name__}: {exc})")

    try:
        data = json.loads(body)
    except ValueError, TypeError:
        data = None

    if data is None:
        # Chrome's JSON viewer / partial body — fall back to substring checks.
        low = body.lower()
        if "ja3" not in low:
            pytest.skip("TLS endpoint returned an unrecognized body")
        assert DEFAULT_UA in body, "advertised Chrome UA not reflected at the TLS layer"
        for key in ("ja3", "ja4", "akamai"):
            assert key in low, f"missing {key} fingerprint in TLS response"
        return

    tls = data.get("tls") or {}
    assert tls.get("ja3_hash") or tls.get("ja3"), f"no JA3 fingerprint: {tls!r}"
    assert tls.get("ja4"), f"no JA4 fingerprint: {tls!r}"

    if str(data.get("http_version", "")).startswith("h2"):
        http2 = data.get("http2") or {}
        assert http2.get("akamai_fingerprint") or http2.get("akamai_fingerprint_hash"), (
            f"no Akamai HTTP/2 fingerprint on an h2 connection: {http2!r}"
        )

    ua = data.get("user_agent") or ""
    assert ua == DEFAULT_UA, f"UA at the TLS layer ({ua!r}) doesn't match the advertised UA ({DEFAULT_UA!r})"


# --- Cloudflare managed challenge -------------------------------------------
# A real, end-to-end run of the FULL pipeline (navigate + challenge-wait) against
# a site behind Cloudflare's managed challenge. nowsecure.nl is a community page
# left behind the JS interstitial for exactly this. Unlike the checks above this
# uses Harvester.harvest, so it validates _await_challenge, not just stealth.

_CLOUDFLARE = "https://nowsecure.nl/"


async def test_cloudflare_managed_challenge_clears(harvester):
    req = HarvestRequest(url=_CLOUDFLARE, challenge_wait_ms=25_000, timeout_ms=45_000)
    resp = await harvester.harvest(req)

    if not resp.ok:
        pytest.skip(f"nowsecure.nl unreachable / errored: {resp.error}")

    # Measure the REAL outcome, not resp.challenge_cleared: that flag is a known
    # false-negative here because Cloudflare's own /cdn-cgi/challenge-platform
    # script tag is still present in the *cleared* page's HTML, so the harvester's
    # marker match never goes quiet. The true proof we got past is a cf_clearance
    # cookie and/or a real (non-interstitial) title.
    title = (resp.title or "").lower()
    on_interstitial = "just a moment" in title or "attention required" in title
    got_clearance = any(c.get("name") == "cf_clearance" for c in resp.cookies)

    assert not on_interstitial, f"still on the Cloudflare interstitial: title={resp.title!r}"
    if resp.challenge_detected:
        assert got_clearance or resp.challenge_cleared, (
            "Cloudflare challenge detected but no cf_clearance cookie was obtained "
            f"(title={resp.title!r}, status={resp.status}, "
            f"cookies={[c.get('name') for c in resp.cookies]})"
        )
