"""FastAPI service exposing the stealth capture API."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .config import Config, load_config
from .harvester import Harvester
from .models import HarvestRequest, HarvestResponse

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("harvester.api")

config: Config = load_config()
harvester = Harvester(config=config)
_active = 0
_active_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await harvester.start()
    try:
        yield
    finally:
        await harvester.stop()


app = FastAPI(
    title="Stealth Browser Capture API",
    description=(
        "Load a URL through a stealth Playwright browser, wait for anti-bot "
        "challenges, and return browser state, scraper headers, and protection "
        "metadata."
    ),
    version="2.0.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def request_size_limit(request: Request, call_next: Any):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            too_large = int(content_length) > config.max_body_bytes
        except ValueError:
            too_large = True
        if too_large:
            return JSONResponse(status_code=413, content={"error": "request body too large"})
    return await call_next(request)


async def _reserve_capacity() -> bool:
    global _active
    async with _active_lock:
        if _active >= config.max_concurrency:
            return False
        _active += 1
        return True


async def _release_capacity() -> None:
    global _active
    async with _active_lock:
        _active -= 1


def _capture_payload(result: HarvestResponse) -> dict[str, Any]:
    """Return the original Node service's camelCase scraper contract."""
    payload: dict[str, Any] = {
        "finalUrl": result.final_url,
        "status": result.status,
        "finalStatus": result.final_status,
        "title": result.title,
        "cookies": result.cookies,
        "storage": {
            "localStorage": result.local_storage,
            "sessionStorage": result.session_storage,
        },
        "requestHeaders": result.request_headers,
        "responseHeaders": result.response_headers,
        "scraperHeaders": result.scraper_headers,
        "protection": result.protection,
        "secretsIncluded": result.secrets_included,
        "ok": result.ok,
    }
    if result.html is not None:
        payload["html"] = result.html
    if result.screenshot_b64 is not None:
        payload["screenshotB64"] = result.screenshot_b64
    if result.error is not None:
        payload["error"] = result.error
    return payload


async def _run_harvest(req: HarvestRequest, *, capture_style: bool):
    if not await _reserve_capacity():
        return JSONResponse(status_code=429, content={"error": "capacity exceeded"})
    try:
        logger.info("harvest request url=%s proxy=%s", req.url, bool(req.proxy))
        result = await harvester.harvest(req)
        status = 200 if result.ok else 502
        if capture_style:
            return JSONResponse(status_code=status, content=_capture_payload(result))
        if not result.ok:
            return JSONResponse(status_code=status, content=result.model_dump())
        return result
    except Exception as exc:  # noqa: BLE001 - keep API failures structured
        logger.exception("unexpected harvest error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        await _release_capacity()


@app.get("/health")
@app.get("/healthz")
async def health() -> dict[str, object]:
    ok = await harvester.healthy()
    return {"status": "ok" if ok else "degraded", "browser_connected": ok, "ok": ok}


@app.post("/harvest", response_model=HarvestResponse)
async def harvest(req: HarvestRequest):
    return await _run_harvest(req, capture_style=False)


@app.post("/v1/capture")
async def capture(req: HarvestRequest):
    return await _run_harvest(req, capture_style=True)
