"""Bounds Playwright calls (page.content/title/evaluate, context.cookies, ...) that
take no timeout parameter of their own, so a wedged renderer can't silently consume
a request's entire time budget."""

import asyncio
import logging
from collections.abc import Awaitable

logger = logging.getLogger("harvester")

CDP_CALL_TIMEOUT_S = 5.0


async def bounded[T](
    awaitable: Awaitable[T], *, default: T, timeout_s: float = CDP_CALL_TIMEOUT_S, what: str = "cdp call"
) -> T:
    try:
        return await asyncio.wait_for(awaitable, timeout=timeout_s)
    except Exception as exc:
        logger.debug("%s failed or timed out: %s", what, exc)
        return default
