"""Per-request network enforcement: URL safety, WAF bypass headers, header capture."""

import logging
from typing import Any
from urllib.parse import urlsplit

from playwright.async_api import Page

from harvester.browser.stealth import client_hints_for_ua
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

    def __init__(self, config: Config, enforce_security: bool, user_agent: str) -> None:
        self.config = config
        self.enforce_security = enforce_security
        self.client_hints = client_hints_for_ua(user_agent)

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
                if self.client_hints:
                    for key, value in self.client_hints.items():
                        if key in headers:
                            headers[key] = value
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
                    await route.continue_(headers=headers)
                if main_frame_navigation:
                    state["latest_request_headers"] = dict(headers)
            except Exception as exc:
                logger.debug("aborting browser request %s: %s", request.url, exc)
                try:
                    await route.abort("blockedbyclient")
                except Exception as abort_exc:
                    # The page/context can close mid-flight while subresource
                    # requests are still in the route handler (e.g. a heavy
                    # page torn down right after navigation completes). This
                    # task is scheduled by Playwright itself, not awaited by
                    # our code, so an escaping exception here becomes an
                    # unretrieved-future error on the event loop.
                    logger.debug("abort also failed for %s: %s", request.url, abort_exc)

        await page.route("**/*", handle)
