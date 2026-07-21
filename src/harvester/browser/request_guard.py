"""Per-request network enforcement: URL safety, WAF bypass headers, header capture."""

import logging
from typing import Any
from urllib.parse import urlsplit

from playwright.async_api import Page

from harvester.config import Config
from harvester.security import assert_safe_url

logger = logging.getLogger("harvester")


def initial_guard_state() -> dict[str, Any]:
    return {
        "latest_request_headers": {},
        "latest_navigation_response": None,
        "bypass_applied": False,
        "insecure_bypass_blocked": False,
    }


class RequestGuard:
    """Installs the route handler that enforces the allowlist and applies bypass headers."""

    def __init__(self, config: Config, enforce_security: bool) -> None:
        self.config = config
        self.enforce_security = enforce_security

    async def install(self, page: Page, state: dict[str, Any]) -> None:
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
                except Exception:
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
            except Exception as exc:
                logger.debug("aborting browser request %s: %s", request.url, exc)
                await route.abort("blockedbyclient")

        await page.route("**/*", handle)
