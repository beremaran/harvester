"""Polling loop that waits out known anti-bot interstitials."""
import time

from playwright.async_api import Page, TimeoutError as PWTimeoutError

from harvester.detection import detect_challenge
from harvester.models import HarvestRequest, HarvestResponse


async def await_challenge(page: Page, req: HarvestRequest, resp: HarvestResponse) -> None:
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
