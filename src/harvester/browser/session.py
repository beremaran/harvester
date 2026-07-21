"""Playwright browser process lifecycle and per-request stealth contexts."""

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from harvester.browser.stealth import DEFAULT_UA, LAUNCH_ARGS, stealth
from harvester.browser.worker_stealth import worker_context_patch, worker_stealth_script
from harvester.config import Config
from harvester.models import HarvestRequest

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
            # The driver subprocess spawned by async_playwright().start() inherits
            # this env, which is what the rebrowser-patches-patched CDP layer reads
            # to decide whether to skip Runtime.enable (see Dockerfile).
            if self.config.enable_cdp_stealth:
                os.environ["REBROWSER_PATCHES_RUNTIME_FIX_MODE"] = "addBinding"
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(headless=True, args=LAUNCH_ARGS)
            logger.info("browser launched (cdp_stealth=%s)", self.config.enable_cdp_stealth)

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

        context_kwargs = self._context_kwargs(req)
        context = await self._browser.new_context(**context_kwargs)
        try:
            # Worker global scopes don't inherit page-level stealth patches (they
            # have their own navigator/WebGL context), so a dedicated init script
            # re-applies the UA/WebGL evasions inside every dedicated worker the
            # page spawns via `new Worker(...)`.
            await context.add_init_script(
                worker_stealth_script(
                    user_agent=context_kwargs["user_agent"],
                    webgl_vendor=stealth.webgl_vendor_override,
                    webgl_renderer=stealth.webgl_renderer_override,
                )
            )

            # ServiceWorkers can't be intercepted the same way: they're registered
            # by URL (no blob substitution) and run before any page-level init
            # script could reach them. Patch each one directly, as soon as
            # Playwright reports it attached, before its own code observes
            # navigator/WebGL.
            service_worker_patch = worker_context_patch(
                user_agent=context_kwargs["user_agent"],
                webgl_vendor=stealth.webgl_vendor_override,
                webgl_renderer=stealth.webgl_renderer_override,
            )

            def _patch_service_worker(worker: Any) -> None:
                task = asyncio.ensure_future(worker.evaluate(service_worker_patch))
                task.add_done_callback(lambda t: t.exception())

            context.on("serviceworker", _patch_service_worker)

            page = await context.new_page()
            await stealth.apply_stealth_async(page)
            yield context, page
        finally:
            await context.close()
