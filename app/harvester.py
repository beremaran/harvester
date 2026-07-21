"""Stealth browser capture with the service security and scraper contract."""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from urllib.parse import urlsplit

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Response,
    TimeoutError as PWTimeoutError,
    async_playwright,
)
from playwright_stealth import Stealth

from .config import Config, load_config
from .detection import detect_challenge, detect_protection
from .models import HarvestRequest, HarvestResponse
from .security import assert_safe_url

logger = logging.getLogger("harvester")

# The fork adds a notification_permission evasion on top of upstream 2.x,
# closing a headless-only inconsistency: Notification.permission='denied'
# while permissions.query reports 'prompt'. WebGL vendor/renderer are
# overridden here to present a real desktop Chrome/Windows GPU instead of
# headless's SwiftShader software renderer.
_stealth = Stealth(
    webgl_vendor_override="Google Inc. (Intel)",
    webgl_renderer_override="ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
)

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
_SCRAPER_HEADER_NAMES = (
    "accept",
    "accept-language",
    "cache-control",
    "pragma",
    "referer",
    "user-agent",
)


def _redact(value: Any, expose: bool) -> str:
    return str(value) if expose else "[REDACTED]"


def _bypass_header_names(config: Config) -> set[str]:
    return {
        name.lower()
        for headers in (config.bypass_headers_by_host or {}).values()
        for name in headers
    }


def _redact_request_headers(headers: dict[str, Any], include_secrets: bool, config: Config) -> dict[str, str]:
    bypass_headers = _bypass_header_names(config)
    sensitive = {"authorization", "proxy-authorization", "cookie"}
    result: dict[str, str] = {}
    for name, value in (headers or {}).items():
        normalized = str(name).lower()
        if normalized in bypass_headers:
            result[normalized] = "[REDACTED]"
        elif normalized in sensitive:
            result[normalized] = _redact(value, include_secrets)
        else:
            result[normalized] = str(value)
    return result


def _redact_response_headers(headers: dict[str, Any], config: Config) -> dict[str, str]:
    bypass_headers = _bypass_header_names(config)
    return {
        str(name).lower(): str(value)
        for name, value in (headers or {}).items()
        if str(name).lower() != "set-cookie" and str(name).lower() not in bypass_headers
    }


def _build_scraper_headers(
    request_headers: dict[str, Any], cookie_header: str, include_secrets: bool
) -> dict[str, str]:
    normalized = {str(name).lower(): str(value) for name, value in (request_headers or {}).items()}
    result = {name: normalized[name] for name in _SCRAPER_HEADER_NAMES if name in normalized}
    if include_secrets and cookie_header:
        result["cookie"] = cookie_header
    return result


def _redacted_storage(values: dict[str, str], include_secrets: bool) -> dict[str, str]:
    return {str(key): _redact(value, include_secrets) for key, value in values.items()}


async def _read_storage(page: Page, kind: str) -> dict[str, str]:
    js = f"""() => {{
        try {{
            const out = {{}};
            const s = window.{kind};
            for (let i = 0; i < s.length; i++) {{
                const k = s.key(i);
                if (k !== null) out[k] = s.getItem(k);
            }}
            return out;
        }} catch (e) {{ return {{}}; }}
    }}"""
    try:
        return await page.evaluate(js)
    except Exception as exc:  # noqa: BLE001 - storage is best effort
        logger.debug("failed to read %s: %s", kind, exc)
        return {}


class Harvester:
    """Long-lived stealth browser with an isolated context per request.

    ``enforce_security`` is enabled by the HTTP service. Direct callers such as
    the opt-in fingerprint tests can use the browser driver without an operator
    allowlist while still exercising the exact stealth path.
    """

    def __init__(self, config: Config | None = None, *, enforce_security: bool = False) -> None:
        self.config = config or load_config()
        self.enforce_security = enforce_security
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
            self._browser = await self._pw.chromium.launch(headless=True, args=_LAUNCH_ARGS)
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
            if not self.config.allow_caller_headers:
                raise ValueError("caller-supplied extra_headers are disabled")
            context_kwargs["extra_http_headers"] = req.extra_headers
        return context_kwargs

    async def _install_request_guards(self, page: Page, state: dict[str, Any]) -> None:
        async def handle(route: Any) -> None:
            request = route.request
            try:
                parsed = urlsplit(request.url)
                if parsed.scheme not in {"http", "https"}:
                    await route.continue_()
                    return
                if self.enforce_security:
                    await assert_safe_url(request.url, self.config)
                headers = await request.all_headers()
                try:
                    main_frame_navigation = request.is_navigation_request() and request.frame == page.main_frame
                except Exception:  # noqa: BLE001 - detached frames can disappear during redirects
                    main_frame_navigation = False

                bypass = (self.config.bypass_headers_by_host or {}).get(
                    (parsed.hostname or "").lower().removesuffix(".")
                )
                if bypass and (parsed.scheme == "https" or self.config.allow_insecure_bypass_headers):
                    state["bypass_applied"] = True
                    headers.update(bypass)
                    await route.continue_(headers=headers)
                else:
                    if bypass:
                        state["insecure_bypass_blocked"] = True
                    await route.continue_()
                if main_frame_navigation:
                    state["latest_request_headers"] = dict(headers)
            except Exception as exc:  # noqa: BLE001 - security boundary failures abort the request
                logger.debug("aborting browser request %s: %s", request.url, exc)
                await route.abort("blockedbyclient")

        await page.route("**/*", handle)

    @asynccontextmanager
    async def open_stealth_page(self, req: HarvestRequest) -> AsyncIterator[tuple[BrowserContext, Page]]:
        if self._browser is None:
            await self.start()
        assert self._browser is not None

        context = await self._browser.new_context(**self._context_kwargs(req))
        try:
            page = await context.new_page()
            await _stealth.apply_stealth_async(page)
            yield context, page
        finally:
            await context.close()

    async def harvest(self, req: HarvestRequest) -> HarvestResponse:
        started = time.monotonic()
        resp = HarvestResponse(ok=False, url=req.url)
        include_secrets = req.include_secrets and self.config.capture_secret_values
        state: dict[str, Any] = {
            "latest_request_headers": {},
            "latest_navigation_response": None,
            "bypass_applied": False,
            "insecure_bypass_blocked": False,
        }

        try:
            target = await assert_safe_url(
                req.url,
                self.config,
                enforce_boundary=self.enforce_security,
            )
            async with self.open_stealth_page(req) as (context, page):
                if self.enforce_security:
                    await self._install_request_guards(page, state)

                def remember_response(candidate: Response) -> None:
                    try:
                        request = candidate.request
                        if request.is_navigation_request() and request.frame == page.main_frame:
                            state["latest_navigation_response"] = candidate
                    except Exception:  # noqa: BLE001 - response may outlive its frame
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

                await self._await_challenge(page, req, resp)

                if req.wait_for_selector:
                    try:
                        await page.wait_for_selector(req.wait_for_selector, timeout=req.timeout_ms)
                    except PWTimeoutError:
                        logger.warning("wait_for_selector '%s' timed out", req.wait_for_selector)

                extra_wait_ms = req.wait_for_ms if req.wait_for_ms is not None else req.extra_wait_ms
                if extra_wait_ms:
                    await page.wait_for_timeout(extra_wait_ms)

                resp.final_url = page.url
                try:
                    resp.title = await page.title()
                except Exception:  # noqa: BLE001
                    resp.title = None

                raw_cookies = await context.cookies()
                resp.cookies = [
                    {**cookie, "value": _redact(cookie.get("value", ""), include_secrets)}
                    for cookie in raw_cookies
                ]
                local_storage = await _read_storage(page, "localStorage")
                session_storage = await _read_storage(page, "sessionStorage")
                resp.local_storage = _redacted_storage(local_storage, include_secrets)
                resp.session_storage = _redacted_storage(session_storage, include_secrets)

                detection_html = ""
                try:
                    detection_html = await page.evaluate(
                        "() => document.documentElement?.outerHTML.slice(0, 250000) ?? ''"
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.debug("failed to read detection HTML: %s", exc)

                final_response = state["latest_navigation_response"] or nav_response
                if final_response is not None:
                    resp.final_status = final_response.status
                    try:
                        raw_response_headers = await final_response.all_headers()
                    except Exception:  # noqa: BLE001
                        raw_response_headers = {}
                else:
                    raw_response_headers = {}

                cookie_header = ""
                if include_secrets and resp.final_url and urlsplit(resp.final_url).scheme in {"http", "https"}:
                    page_cookies = await context.cookies([resp.final_url])
                    cookie_header = "; ".join(
                        f"{cookie['name']}={cookie['value']}" for cookie in page_cookies
                    )

                resp.request_headers = _redact_request_headers(
                    state["latest_request_headers"], include_secrets, self.config
                )
                resp.response_headers = _redact_response_headers(raw_response_headers, self.config)
                resp.scraper_headers = _build_scraper_headers(
                    state["latest_request_headers"], cookie_header, include_secrets
                )
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

                if req.return_html:
                    html = await page.content()
                    if self.config.max_html_bytes and len(html.encode("utf-8")) > self.config.max_html_bytes:
                        raise ValueError("rendered HTML exceeds MAX_HTML_BYTES")
                    resp.html = html
                if req.return_screenshot:
                    png = await page.screenshot(full_page=False)
                    resp.screenshot_b64 = base64.b64encode(png).decode("ascii")

                resp.ok = True
        except Exception as exc:  # noqa: BLE001 - surface capture failures as structured JSON
            logger.exception("harvest failed for %s", req.url)
            resp.ok = False
            resp.error = f"{type(exc).__name__}: {exc}"
        finally:
            resp.elapsed_ms = int((time.monotonic() - started) * 1000)
        return resp

    async def _await_challenge(self, page: Page, req: HarvestRequest, resp: HarvestResponse) -> None:
        deadline = time.monotonic() + (req.challenge_wait_ms / 1000.0)
        detected = False
        while True:
            try:
                html = await page.content()
                title = await page.title()
            except Exception:  # noqa: BLE001 - navigation may still be in flight
                await page.wait_for_timeout(500)
                if time.monotonic() >= deadline:
                    break
                continue

            if not detect_challenge(html, title):
                if detected:
                    resp.challenge_cleared = True
                break

            detected = True
            resp.challenge_detected = True
            if time.monotonic() >= deadline:
                resp.challenge_cleared = False
                break
            await page.wait_for_timeout(1000)
            try:
                await page.wait_for_load_state("networkidle", timeout=3000)
            except PWTimeoutError:
                pass
