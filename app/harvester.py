"""Core browser-driving logic: load a URL through a proxy with stealth,
let anti-bot challenges resolve, and harvest cookies + storage."""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    TimeoutError as PWTimeoutError,
    async_playwright,
)

from .models import HarvestRequest, HarvestResponse
from .stealth_compat import apply_stealth, stealth_context_kwargs

logger = logging.getLogger("harvester")

# Signatures of common anti-bot interstitials. If the page still matches one of
# these after navigation, we keep polling until challenge_wait_ms elapses.
_CHALLENGE_MARKERS = [
    "just a moment",           # Cloudflare
    "checking your browser",   # Cloudflare / DDoS-Guard
    "verifying you are human",  # Cloudflare Turnstile
    "enable javascript and cookies to continue",  # Cloudflare
    "attention required",      # Cloudflare block
    "ddos-guard",
    "please wait while we verify",
    "one more step",
    "verification is taking",  # generic
    "__cf_chl",                # Cloudflare challenge script marker
    "/cdn-cgi/challenge-platform",
]

# Launch args that reduce automation fingerprints and work in a container.
_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--window-size=1920,1080",
]

_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _looks_like_challenge(html: str, title: str) -> bool:
    hay = f"{title}\n{html}".lower()
    return any(marker in hay for marker in _CHALLENGE_MARKERS)


async def _read_storage(page: Page, kind: str) -> dict[str, str]:
    """Read localStorage or sessionStorage as a plain dict, tolerating failures
    (e.g. SecurityError on an opaque origin)."""
    js = f"""() => {{
        try {{
            const out = {{}};
            const s = window.{kind};
            for (let i = 0; i < s.length; i++) {{
                const k = s.key(i);
                out[k] = s.getItem(k);
            }}
            return out;
        }} catch (e) {{ return {{}}; }}
    }}"""
    try:
        return await page.evaluate(js)
    except Exception as exc:  # noqa: BLE001 - storage access is best-effort
        logger.debug("failed to read %s: %s", kind, exc)
        return {}


class Harvester:
    """Owns a long-lived browser instance shared across requests.

    A fresh, isolated context is created per harvest so cookies/storage never
    leak between requests, but the browser process is reused for speed.
    """

    def __init__(self) -> None:
        self._pw = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._browser is not None:
            return
        async with self._lock:
            if self._browser is not None:
                return
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(
                headless=True,
                args=_LAUNCH_ARGS,
            )
            logger.info("browser launched")

    async def stop(self) -> None:
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._pw is not None:
            await self._pw.stop()
            self._pw = None
        logger.info("browser stopped")

    async def healthy(self) -> bool:
        return self._browser is not None and self._browser.is_connected()

    def _context_kwargs(self, req: HarvestRequest) -> dict[str, Any]:
        """Build the new_context kwargs — UA, viewport, proxy, and the stealth
        version's own context hooks — that every harvest (and live test) uses."""
        context_kwargs: dict[str, Any] = {
            "locale": req.locale,
            "viewport": {"width": req.viewport_width, "height": req.viewport_height},
            "user_agent": req.user_agent or _DEFAULT_UA,
            "ignore_https_errors": True,
            "java_script_enabled": True,
        }
        if req.timezone_id:
            context_kwargs["timezone_id"] = req.timezone_id
        if req.proxy is not None:
            context_kwargs["proxy"] = req.proxy.to_playwright()
        if req.extra_headers:
            context_kwargs["extra_http_headers"] = req.extra_headers
        context_kwargs.update(stealth_context_kwargs())
        return context_kwargs

    @asynccontextmanager
    async def open_stealth_page(
        self, req: HarvestRequest
    ) -> AsyncIterator[tuple[BrowserContext, Page]]:
        """Yield a fresh, isolated context + a stealthed page configured exactly
        as ``harvest`` configures them. The context is closed on exit.

        Exposed so tests can drive the real stealth path (same launch flags, UA,
        and evasions) against live sites and inspect the resulting page directly.
        """
        if self._browser is None:
            await self.start()
        assert self._browser is not None

        context = await self._browser.new_context(**self._context_kwargs(req))
        try:
            page = await context.new_page()
            await apply_stealth(page)
            yield context, page
        finally:
            await context.close()

    async def harvest(self, req: HarvestRequest) -> HarvestResponse:
        started = time.monotonic()
        resp = HarvestResponse(ok=False, url=req.url)

        try:
            async with self.open_stealth_page(req) as (context, page):
                nav_response = None
                try:
                    nav_response = await page.goto(
                        req.url, wait_until=req.wait_until, timeout=req.timeout_ms
                    )
                except PWTimeoutError:
                    # networkidle can legitimately never fire on chatty pages; fall
                    # back to whatever has loaded rather than failing outright.
                    logger.warning("navigation wait '%s' timed out; continuing", req.wait_until)

                if nav_response is not None:
                    resp.status = nav_response.status

                # Detect and wait out an anti-bot challenge.
                await self._await_challenge(page, req, resp)

                if req.wait_for_selector:
                    try:
                        await page.wait_for_selector(req.wait_for_selector, timeout=req.timeout_ms)
                    except PWTimeoutError:
                        logger.warning("wait_for_selector '%s' timed out", req.wait_for_selector)

                if req.extra_wait_ms:
                    await page.wait_for_timeout(req.extra_wait_ms)

                # Harvest everything.
                resp.final_url = page.url
                try:
                    resp.title = await page.title()
                except Exception:  # noqa: BLE001
                    resp.title = None

                resp.cookies = await context.cookies()
                resp.local_storage = await _read_storage(page, "localStorage")
                resp.session_storage = await _read_storage(page, "sessionStorage")

                if req.return_html:
                    try:
                        resp.html = await page.content()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("failed to capture html: %s", exc)

                if req.return_screenshot:
                    try:
                        png = await page.screenshot(full_page=False)
                        resp.screenshot_b64 = base64.b64encode(png).decode("ascii")
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("failed to capture screenshot: %s", exc)

                resp.ok = True
        except Exception as exc:  # noqa: BLE001 - surface any failure to the caller
            logger.exception("harvest failed for %s", req.url)
            resp.ok = False
            resp.error = f"{type(exc).__name__}: {exc}"
        finally:
            resp.elapsed_ms = int((time.monotonic() - started) * 1000)

        return resp

    async def _await_challenge(
        self, page: Page, req: HarvestRequest, resp: HarvestResponse
    ) -> None:
        """Poll the page for a known interstitial and wait for it to clear."""
        deadline = time.monotonic() + (req.challenge_wait_ms / 1000.0)
        detected = False
        while True:
            try:
                html = await page.content()
                title = await page.title()
            except Exception:  # noqa: BLE001 - navigation in flight
                await page.wait_for_timeout(500)
                if time.monotonic() >= deadline:
                    break
                continue

            if not _looks_like_challenge(html, title):
                if detected:
                    resp.challenge_cleared = True
                break

            detected = True
            resp.challenge_detected = True
            if time.monotonic() >= deadline:
                resp.challenge_cleared = False
                break
            # Give the challenge JS room to run and settle.
            await page.wait_for_timeout(1000)
            try:
                await page.wait_for_load_state("networkidle", timeout=3000)
            except PWTimeoutError:
                pass
