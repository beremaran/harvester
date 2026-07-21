"""Harvest orchestration: composes the browser session, request guard, and
challenge/redaction helpers into the single-page capture contract."""

import base64
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from playwright.async_api import (
    BrowserContext,
    Page,
    Response,
)
from playwright.async_api import (
    TimeoutError as PWTimeoutError,
)

from harvester.browser.challenge import await_challenge
from harvester.browser.redaction import (
    build_scraper_headers,
    redact,
    redact_request_headers,
    redact_response_headers,
    redacted_storage,
)
from harvester.browser.request_guard import RequestGuard, initial_guard_state
from harvester.browser.session import BrowserSession
from harvester.browser.stealth import DEFAULT_UA
from harvester.browser.storage import read_storage
from harvester.config import Config, load_config
from harvester.detection import detect_protection
from harvester.models import HarvestRequest, HarvestResponse
from harvester.security import assert_safe_url

logger = logging.getLogger("harvester")


class Harvester:
    """Long-lived stealth browser with an isolated context per request.

    ``enforce_security`` is enabled by the HTTP service. Direct callers such as
    the opt-in fingerprint tests can use the browser driver without an operator
    allowlist while still exercising the exact stealth path.
    """

    def __init__(self, config: Config | None = None, *, enforce_security: bool = False) -> None:
        self.config = config or load_config()
        self.enforce_security = enforce_security
        self.session = BrowserSession(self.config)

    async def start(self) -> None:
        await self.session.start()

    async def stop(self) -> None:
        await self.session.stop()

    async def healthy(self) -> bool:
        return await self.session.healthy()

    @asynccontextmanager
    async def open_stealth_page(self, req: HarvestRequest) -> AsyncIterator[tuple[BrowserContext, Page]]:
        async with self.session.open_stealth_page(req) as (context, page):
            yield context, page

    async def harvest(self, req: HarvestRequest) -> HarvestResponse:
        started = time.monotonic()
        resp = HarvestResponse(ok=False, url=req.url)
        include_secrets = req.include_secrets and self.config.capture_secret_values
        state = initial_guard_state()

        try:
            target = await assert_safe_url(
                req.url,
                self.config,
                enforce_boundary=self.enforce_security,
            )
            async with self.open_stealth_page(req) as (context, page):
                if self.enforce_security:
                    user_agent = req.user_agent or DEFAULT_UA
                    await RequestGuard(self.config, self.enforce_security, user_agent).install(page, state)

                nav_response = await self._navigate(page, req, resp, state, target)
                await await_challenge(page, req, resp)
                await self._apply_post_navigation_waits(page, req)

                resp.final_url = page.url
                resp.title = await self._safe_title(page)

                raw_cookies = await context.cookies()
                await self._populate_browser_state(page, resp, raw_cookies, include_secrets)
                await self._populate_network_state(
                    page, context, target, state, nav_response, raw_cookies, resp, include_secrets
                )
                await self._populate_outputs(page, req, resp)

                resp.ok = True
        except Exception as exc:
            logger.exception("harvest failed for %s", req.url)
            resp.ok = False
            resp.error = f"{type(exc).__name__}: {exc}"
        finally:
            resp.elapsed_ms = int((time.monotonic() - started) * 1000)
        return resp

    async def _navigate(
        self, page: Page, req: HarvestRequest, resp: HarvestResponse, state: dict[str, Any], target: str
    ) -> Response | None:
        def remember_response(candidate: Response) -> None:
            try:
                request = candidate.request
                if request.is_navigation_request() and request.frame == page.main_frame:
                    state["latest_navigation_response"] = candidate
            except Exception:
                return

        page.on("response", remember_response)
        nav_response: Response | None = None
        try:
            nav_response = await page.goto(
                target,
                wait_until=req.wait_until,
                timeout=req.timeout_ms or self.config.navigation_timeout_ms,
            )
        except PWTimeoutError:
            logger.warning("navigation wait '%s' timed out; continuing", req.wait_until)

        if nav_response is not None:
            resp.status = nav_response.status
        return nav_response

    async def _apply_post_navigation_waits(self, page: Page, req: HarvestRequest) -> None:
        if req.wait_for_selector:
            try:
                await page.wait_for_selector(req.wait_for_selector, timeout=req.timeout_ms)
            except PWTimeoutError:
                logger.warning("wait_for_selector '%s' timed out", req.wait_for_selector)

        if req.extra_wait_ms:
            await page.wait_for_timeout(req.extra_wait_ms)

    async def _safe_title(self, page: Page) -> str | None:
        try:
            return await page.title()
        except Exception:
            return None

    async def _populate_browser_state(
        self, page: Page, resp: HarvestResponse, raw_cookies: list[dict[str, Any]], include_secrets: bool
    ) -> None:
        resp.cookies = [{**cookie, "value": redact(cookie.get("value", ""), include_secrets)} for cookie in raw_cookies]
        local_storage = await read_storage(page, "localStorage")
        session_storage = await read_storage(page, "sessionStorage")
        resp.local_storage = redacted_storage(local_storage, include_secrets)
        resp.session_storage = redacted_storage(session_storage, include_secrets)

    async def _populate_network_state(
        self,
        page: Page,
        context: BrowserContext,
        target: str,
        state: dict[str, Any],
        nav_response: Response | None,
        raw_cookies: list[dict[str, Any]],
        resp: HarvestResponse,
        include_secrets: bool,
    ) -> None:
        detection_html = ""
        try:
            detection_html = await page.evaluate("() => document.documentElement?.outerHTML.slice(0, 250000) ?? ''")
        except Exception as exc:
            logger.debug("failed to read detection HTML: %s", exc)

        final_response = state["latest_navigation_response"] or nav_response
        if final_response is not None:
            resp.final_status = final_response.status
            try:
                raw_response_headers = await final_response.all_headers()
            except Exception:
                raw_response_headers = {}
        else:
            raw_response_headers = {}

        cookie_header = ""
        if include_secrets and resp.final_url and urlsplit(resp.final_url).scheme in {"http", "https"}:
            page_cookies = await context.cookies([resp.final_url])
            cookie_header = "; ".join(f"{cookie['name']}={cookie['value']}" for cookie in page_cookies)

        resp.request_headers = redact_request_headers(state["latest_request_headers"], include_secrets, self.config)
        resp.response_headers = redact_response_headers(raw_response_headers, self.config)
        resp.scraper_headers = build_scraper_headers(state["latest_request_headers"], cookie_header, include_secrets)
        host = (urlsplit(target).hostname or "").lower().removesuffix(".")
        resp.bypass = {
            "configured": host in (self.config.bypass_headers_by_host or {}),
            "applied": state["bypass_applied"],
            "insecureTransportBlocked": state["insecure_bypass_blocked"],
        }
        resp.protection = detect_protection(
            status=resp.final_status,
            headers=raw_response_headers,
            cookies=raw_cookies,
            html=detection_html,
        )
        resp.secrets_included = include_secrets

    async def _populate_outputs(self, page: Page, req: HarvestRequest, resp: HarvestResponse) -> None:
        if req.return_html:
            html = await page.content()
            if self.config.max_html_bytes and len(html.encode("utf-8")) > self.config.max_html_bytes:
                raise ValueError("rendered HTML exceeds MAX_HTML_BYTES")
            resp.html = html
        if req.return_screenshot:
            png = await page.screenshot(full_page=False)
            resp.screenshot_b64 = base64.b64encode(png).decode("ascii")
