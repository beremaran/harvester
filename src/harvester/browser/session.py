"""Playwright browser process lifecycle and per-request stealth contexts."""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from harvester.config import Config
from harvester.models import HarvestRequest
from harvester.browser.stealth import DEFAULT_UA, LAUNCH_ARGS, stealth

logger = logging.getLogger("harvester")


class BrowserSession:
    """Owns the long-lived Chromium process and hands out isolated contexts."""

    def __init__(self, config: Config) -> None:
        self.config = config
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
            self._browser = await self._pw.chromium.launch(headless=True, args=LAUNCH_ARGS)
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
            "user_agent": req.user_agent or DEFAULT_UA,
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

    @asynccontextmanager
    async def open_stealth_page(self, req: HarvestRequest) -> AsyncIterator[tuple[BrowserContext, Page]]:
        if self._browser is None:
            await self.start()
        assert self._browser is not None

        context = await self._browser.new_context(**self._context_kwargs(req))
        try:
            page = await context.new_page()
            await stealth.apply_stealth_async(page)
            yield context, page
        finally:
            await context.close()
