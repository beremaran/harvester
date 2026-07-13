"""FastAPI service exposing the cookie/session harvester."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from .harvester import Harvester
from .models import HarvestRequest, HarvestResponse

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("harvester.api")

harvester = Harvester()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await harvester.start()
    try:
        yield
    finally:
        await harvester.stop()


app = FastAPI(
    title="Cookie/Session Harvester",
    description="Load a URL through a proxy with playwright-stealth and harvest cookies, "
    "storage, and optionally rendered HTML — solving anti-bot challenges along the way.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, object]:
    ok = await harvester.healthy()
    return {"status": "ok" if ok else "degraded", "browser_connected": ok}


@app.post("/harvest", response_model=HarvestResponse)
async def harvest(req: HarvestRequest) -> HarvestResponse:
    logger.info("harvest request url=%s proxy=%s", req.url, bool(req.proxy))
    try:
        result = await harvester.harvest(req)
    except Exception as exc:  # noqa: BLE001
        logger.exception("unexpected harvest error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not result.ok:
        # Still return the structured body (with error) but signal failure.
        return JSONResponse(status_code=502, content=result.model_dump())
    return result
