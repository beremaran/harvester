"""Live stealth tests: drive the harvester's *real* stealth path against public
fingerprinting / bot-detection sites and assert that automation is not detected.

Unlike the rest of the suite these reach the public internet, so they only run
when ``RUN_LIVE_TESTS=1`` (see the gate in conftest.py). They exercise the exact
context Playwright uses in production via ``Harvester.open_stealth_page`` — same
launch flags, User-Agent, and playwright-stealth evasions — then inspect the
resulting page the way a fingerprinter would.

A live site being unreachable (timeout / connection reset / gateway error) skips
the test rather than failing it; only a genuine *detection* is a failure.
"""
import pytest

from playwright.async_api import Error as PWError, TimeoutError as PWTimeoutError

from harvester.models import HarvestRequest

pytestmark = [
    pytest.mark.asyncio(loop_scope="session"),
    pytest.mark.live,
]

SANNYSOFT = "https://bot.sannysoft.com/"

# A stable, unauthenticated HTTPS origin to evaluate raw signals against — the
# checks are page-agnostic, they just need a real (non-localhost) secure origin.
REAL_ORIGIN = "https://www.wikipedia.org/"


async def _goto(page, url: str, *, timeout: int = 45_000):
    """Navigate, turning network flakiness into a skip (not a failure)."""
    try:
        return await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except (PWTimeoutError, PWError) as exc:
        pytest.skip(f"live site unreachable: {url} ({type(exc).__name__}: {exc})")


# Sannysoft rows that specifically betray Playwright / headless-Chrome / Selenium
# automation. A real browser leaves every one of these green ("passed"); if any
# goes red ("failed"), stealth has been defeated.
_CRITICAL_SANNYSOFT_ROWS = {
    "WebDriver",              # navigator.webdriver
    "WebDriver Advanced",
    "Chrome",                 # window.chrome present
    "Permissions",            # Notification permission consistency
    "Plugins Length",
    "Plugins is of type PluginArray",
    "HEADCHR_UA",             # HeadlessChrome in UA
    "HEADCHR_CHROME_OBJ",
    "HEADCHR_PERMISSIONS",
    "HEADCHR_PLUGINS",
    "HEADCHR_IFRAME",
    "CHR_DEBUG_TOOLS",
    "SELENIUM_DRIVER",
    "WEBDRIVER",
    "PHANTOM_UA",
    "PHANTOM_PROPERTIES",
}


async def test_sannysoft_reports_no_automation(harvester):
    """bot.sannysoft.com's own verdicts must not flag any automation signal."""
    req = HarvestRequest(url=SANNYSOFT)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, SANNYSOFT)
        # The HEADCHR_*/PHANTOM_* probes fill in asynchronously after load.
        await page.wait_for_timeout(3000)

        rows = await page.evaluate(
            """() => {
                const out = {};
                document.querySelectorAll('table tr').forEach(tr => {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length >= 2) {
                        const label = tds[0].innerText.replace(/\\s+/g, ' ')
                            .replace(/\\(New\\)|\\(Old\\)/g, '').trim();
                        out[label] = {
                            text: tds[1].innerText.trim(),
                            cls: (tds[1].className || '').trim(),
                        };
                    }
                });
                return out;
            }"""
        )

    assert rows, "sannysoft returned no result rows (page shape changed?)"

    failures = {
        label: rows[label]
        for label in _CRITICAL_SANNYSOFT_ROWS
        if label in rows and "failed" in rows[label]["cls"]
    }
    assert not failures, f"sannysoft flagged automation: {failures}"

    # Sanity-check that the probes actually ran (not all blank/"...").
    assert rows.get("WebDriver", {}).get("cls", "").find("passed") != -1, (
        f"WebDriver row not green: {rows.get('WebDriver')}"
    )


async def test_no_direct_automation_tells(harvester):
    """Evaluate the raw fingerprint signals a detector reads, on a real origin."""
    req = HarvestRequest(url=REAL_ORIGIN)
    async with harvester.open_stealth_page(req) as (_ctx, page):
        await _goto(page, REAL_ORIGIN)

        signals = await page.evaluate(
            """async () => {
                const perm = await navigator.permissions
                    .query({ name: 'notifications' })
                    .then(p => p.state)
                    .catch(() => 'error');
                let webglRenderer = '';
                try {
                    const c = document.createElement('canvas');
                    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
                    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
                    webglRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
                } catch (e) { webglRenderer = 'error: ' + e; }
                return {
                    webdriver: navigator.webdriver,
                    ua: navigator.userAgent,
                    pluginsLen: navigator.plugins.length,
                    languages: navigator.languages,
                    hasChrome: !!window.chrome,
                    webglRenderer,
                    permState: perm,
                    notifPerm: (typeof Notification !== 'undefined')
                        ? Notification.permission : 'n/a',
                    // classic webdriver/selenium leftovers
                    cdc: Object.keys(window).some(k => k.startsWith('cdc_')),
                    seleniumGlobals: [
                        '__webdriver_evaluate', '__selenium_evaluate',
                        '__webdriver_script_function', '__driver_evaluate',
                        '_Selenium_IDE_Recorder', '__nightmare',
                    ].filter(k => k in window || k in document),
                };
            }"""
        )

    assert signals["webdriver"] in (False, None), (
        f"navigator.webdriver leaked: {signals['webdriver']!r}"
    )
    assert "HeadlessChrome" not in signals["ua"], f"headless UA leaked: {signals['ua']}"
    assert signals["pluginsLen"] > 0, "navigator.plugins is empty (headless tell)"
    assert signals["languages"], "navigator.languages is empty (headless tell)"
    assert signals["hasChrome"], "window.chrome missing (headless tell)"
    # Software-rendered WebGL ("SwiftShader"/"llvmpipe"/"Mesa OffScreen") is a
    # classic headless giveaway; a real desktop reports a hardware/ANGLE GPU.
    assert not any(
        tell in signals["webglRenderer"]
        for tell in ("SwiftShader", "llvmpipe", "Mesa OffScreen")
    ), f"software WebGL renderer leaked: {signals['webglRenderer']}"
    # Headless leaks permission 'denied' while Notification.permission is 'default'.
    assert not (
        signals["permState"] == "denied" and signals["notifPerm"] == "default"
    ), f"permission/Notification mismatch: {signals['permState']} vs {signals['notifPerm']}"
    assert not signals["cdc"], "ChromeDriver cdc_ globals present"
    assert not signals["seleniumGlobals"], (
        f"selenium/webdriver globals present: {signals['seleniumGlobals']}"
    )
