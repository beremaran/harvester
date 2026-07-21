"""Polling loop that waits out known anti-bot interstitials."""

import contextlib
import time

from playwright.async_api import Page
from playwright.async_api import TimeoutError as PWTimeoutError

from harvester.browser.timeouts import bounded
from harvester.detection import detect_challenge
from harvester.models import HarvestRequest, HarvestResponse


class PageUnresponsiveError(Exception):
    """Raised when the page stops answering CDP calls (content()/title()) during
    the challenge poll, so callers can bail out and grab a screenshot immediately
    instead of burning the rest of the request budget on a wedged renderer."""


async def await_challenge(page: Page, req: HarvestRequest, resp: HarvestResponse) -> None:
    deadline = time.monotonic() + (req.challenge_wait_ms / 1000.0)
    detected = False
    while True:
        html = await bounded(page.content(), default=None, what="challenge-poll content()")
        if html is None:
            raise PageUnresponsiveError("page.content() timed out during challenge poll")
        title = await bounded(page.title(), default=None, what="challenge-poll title()")
        if title is None:
            raise PageUnresponsiveError("page.title() timed out during challenge poll")

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
        with contextlib.suppress(PWTimeoutError):
            await page.wait_for_load_state("networkidle", timeout=3000)
