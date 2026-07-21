"""Unit-level tests driving the Harvester directly against the local server."""

import pytest

from harvester.models import HarvestRequest

# Keep the browser and every test on one shared event loop; a Playwright
# connection created on one loop cannot be awaited from another. The shared
# ``harvester`` fixture lives in conftest.py.
pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_harvests_cookies_and_storage(harvester, target_server):
    req = HarvestRequest(url=target_server, return_html=True)
    resp = await harvester.harvest(req)

    assert resp.ok, resp.error
    assert resp.status == 200
    assert resp.title == "Harvest Home"

    cookie_names = {c["name"]: c["value"] for c in resp.cookies}
    assert cookie_names.get("session_id") == "[REDACTED]"

    assert resp.local_storage.get("token") == "[REDACTED]"
    assert resp.local_storage.get("flag") == "[REDACTED]"
    assert resp.session_storage.get("sid") == "[REDACTED]"

    assert resp.html is not None and "home" in resp.html


async def test_html_omitted_by_default(harvester, target_server):
    resp = await harvester.harvest(HarvestRequest(url=target_server))
    assert resp.ok, resp.error
    assert resp.html is None


async def test_screenshot_capture(harvester, target_server):
    resp = await harvester.harvest(HarvestRequest(url=target_server, return_screenshot=True))
    assert resp.ok, resp.error
    assert resp.screenshot_b64 is not None
    assert len(resp.screenshot_b64) > 100


async def test_challenge_is_detected_and_cleared(harvester, target_server):
    req = HarvestRequest(
        url=f"{target_server}/challenge",
        return_html=True,
        challenge_wait_ms=8000,
        wait_for_selector="#content",
    )
    resp = await harvester.harvest(req)

    assert resp.ok, resp.error
    assert resp.challenge_detected is True
    assert resp.challenge_cleared is True
    assert resp.title == "Protected Area"
    assert resp.local_storage.get("cf_clearance") == "[REDACTED]"
    assert "Access granted" in (resp.html or "")


async def test_isolation_between_requests(harvester, target_server):
    # First request populates storage/cookies; second must start clean.
    await harvester.harvest(HarvestRequest(url=target_server))
    resp = await harvester.harvest(HarvestRequest(url=f"{target_server}/challenge"))
    # The challenge page does not set the home page's 'token' key.
    assert "token" not in resp.local_storage


async def test_stealth_is_active_and_hides_webdriver(harvester, target_server):
    # Stealth must patch the classic navigator.webdriver automation tell.
    from harvester.browser.stealth import stealth

    ctx = await harvester.session._browser.new_context()
    try:
        page = await ctx.new_page()
        await stealth.apply_stealth_async(page)
        await page.goto(target_server)
        webdriver = await page.evaluate("() => navigator.webdriver")
        assert webdriver in (False, None), f"navigator.webdriver leaked: {webdriver!r}"
    finally:
        await ctx.close()


async def test_client_hints_do_not_leak_headless(harvester, target_server):
    resp = await harvester.harvest(HarvestRequest(url=target_server))
    assert resp.ok, resp.error

    sec_ch_ua = resp.request_headers.get("sec-ch-ua", "")
    assert "Headless" not in sec_ch_ua
    assert "Headless" not in resp.request_headers.get("sec-ch-ua-platform", "")
    assert resp.request_headers.get("sec-ch-ua-mobile") == "?0"


async def test_invalid_url_rejected():
    with pytest.raises(ValueError):
        HarvestRequest(url="ftp://nope")


async def test_bad_proxy_surfaces_error(harvester, target_server):
    # Point at a dead proxy; navigation should fail and be reported, not crash.
    req = HarvestRequest(
        url=target_server,
        proxy={"server": "http://127.0.0.1:1"},  # nothing listening
        timeout_ms=5000,
        challenge_wait_ms=0,
    )
    resp = await harvester.harvest(req)
    assert resp.ok is False
    assert resp.error is not None


async def test_include_secrets_returns_scraper_cookie_header(harvester, target_server):
    resp = await harvester.harvest(HarvestRequest(url=target_server, include_secrets=True, return_html=True))
    assert resp.ok, resp.error
    assert resp.secrets_included is True
    assert resp.cookies[0]["value"] == "cookievalue123"
    assert resp.local_storage["token"] == "abc123"
    assert resp.scraper_headers["cookie"].startswith("session_id=")


async def test_owner_bypass_header_is_applied_and_redacted(harvester, target_server):
    from dataclasses import replace

    original = harvester.config
    harvester.config = replace(
        original,
        bypass_headers_by_host={"127.0.0.1": {"x-harvester-bypass": "test-secret"}},
        allow_insecure_bypass_headers=True,
    )
    try:
        resp = await harvester.harvest(
            HarvestRequest(url=f"{target_server}/bypass", return_html=True, include_secrets=True)
        )
    finally:
        harvester.config = original
    assert resp.ok, resp.error
    assert resp.bypass["configured"] is True
    assert resp.bypass["applied"] is True
    assert resp.request_headers["x-harvester-bypass"] == "[REDACTED]"
    assert "test-secret" not in str(resp.model_dump())
    assert resp.protection["challengeDetected"] is False


async def test_http_bypass_is_blocked_by_default(harvester, target_server):
    from dataclasses import replace

    original = harvester.config
    harvester.config = replace(
        original,
        bypass_headers_by_host={"127.0.0.1": {"x-harvester-bypass": "test-secret"}},
        allow_insecure_bypass_headers=False,
    )
    try:
        resp = await harvester.harvest(HarvestRequest(url=f"{target_server}/bypass"))
    finally:
        harvester.config = original
    assert resp.ok, resp.error
    assert resp.bypass["applied"] is False
    assert resp.bypass["insecureTransportBlocked"] is True
    assert resp.protection["challengeDetected"] is True
