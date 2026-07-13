"""Unit-level tests driving the Harvester directly against the local server."""
from __future__ import annotations

import pytest

from app.models import HarvestRequest

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
    assert cookie_names.get("session_id") == "cookievalue123"

    assert resp.local_storage.get("token") == "abc123"
    assert resp.local_storage.get("flag") == "harvested"
    assert resp.session_storage.get("sid") == "sess-xyz"

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
    assert resp.local_storage.get("cf_clearance") == "granted"
    assert "Access granted" in (resp.html or "")


async def test_isolation_between_requests(harvester, target_server):
    # First request populates storage/cookies; second must start clean.
    await harvester.harvest(HarvestRequest(url=target_server))
    resp = await harvester.harvest(HarvestRequest(url=f"{target_server}/challenge"))
    # The challenge page does not set the home page's 'token' key.
    assert "token" not in resp.local_storage


async def test_stealth_is_active_and_hides_webdriver(harvester, target_server):
    # Stealth must genuinely load (not silently fall back to a no-op) and must
    # patch the classic navigator.webdriver automation tell.
    from app.stealth_compat import _mode, apply_stealth

    assert _mode != "none", "playwright-stealth failed to load; running unstealthed"

    ctx = await harvester._browser.new_context()
    try:
        page = await ctx.new_page()
        await apply_stealth(page)
        await page.goto(target_server)
        webdriver = await page.evaluate("() => navigator.webdriver")
        assert webdriver in (False, None), f"navigator.webdriver leaked: {webdriver!r}"
    finally:
        await ctx.close()


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
