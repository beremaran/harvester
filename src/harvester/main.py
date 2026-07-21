"""FastAPI service exposing the authenticated stealth capture API."""
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from harvester.api.auth import is_authorized
from harvester.api.capacity import CapacityLimiter
from harvester.api.contracts import to_capture_payload
from harvester.browser import Harvester
from harvester.config import Config, load_config, validate_config
from harvester.models import HarvestRequest, HarvestResponse

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("harvester.api")

config: Config = load_config()
harvester = Harvester(config=config, enforce_security=True)
capacity = CapacityLimiter(config.max_concurrency)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_config(config)
    await harvester.start()
    try:
        yield
    finally:
        await harvester.stop()


app = FastAPI(
    title="Stealth Authorized Browser Capture API",
    description=(
        "Load an allowlisted URL through a stealth Playwright browser, wait for "
        "authorized anti-bot challenges, and return redacted browser state, "
        "scraper headers, and protection metadata."
    ),
    version="2.0.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def request_size_limit(request: Request, call_next: Any):
    content_length = request.headers.get("content-length")
    if content_length and config.max_body_bytes:
        try:
            too_large = int(content_length) > config.max_body_bytes
        except ValueError:
            too_large = True
        if too_large:
            return JSONResponse(status_code=413, content={"error": "request body too large"})
    return await call_next(request)


async def _run_harvest(request: Request, req: HarvestRequest, *, capture_style: bool):
    if not is_authorized(request, config):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    async with capacity.slot() as reserved:
        if not reserved:
            return JSONResponse(status_code=429, content={"error": "capacity exceeded"})
        try:
            logger.info("harvest request url=%s proxy=%s", req.url, bool(req.proxy))
            result = await harvester.harvest(req)
            status = 200 if result.ok else 502
            if capture_style:
                return JSONResponse(status_code=status, content=to_capture_payload(result))
            if not result.ok:
                return JSONResponse(status_code=status, content=result.model_dump())
            return result
        except Exception as exc:  # noqa: BLE001 - keep API failures structured
            logger.exception("unexpected harvest error")
            raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/health")
@app.get("/healthz")
async def health() -> dict[str, object]:
    ok = await harvester.healthy()
    return {"status": "ok" if ok else "degraded", "browser_connected": ok, "ok": ok}


@app.post("/harvest", response_model=HarvestResponse)
async def harvest(request: Request, req: HarvestRequest):
    return await _run_harvest(request, req, capture_style=False)


@app.post("/v1/capture")
async def capture(request: Request, req: HarvestRequest):
    return await _run_harvest(request, req, capture_style=True)
