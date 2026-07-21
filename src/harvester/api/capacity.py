"""In-flight request capacity limiter, enforcing ``max_concurrency``."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager


class CapacityLimiter:
    def __init__(self, max_concurrency: int) -> None:
        self.max_concurrency = max_concurrency
        self._active = 0
        self._lock = asyncio.Lock()

    async def reserve(self) -> bool:
        async with self._lock:
            if self._active >= self.max_concurrency:
                return False
            self._active += 1
            return True

    async def release(self) -> None:
        async with self._lock:
            self._active -= 1

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[bool]:
        reserved = await self.reserve()
        try:
            yield reserved
        finally:
            if reserved:
                await self.release()
