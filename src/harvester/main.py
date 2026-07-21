"""FastAPI service exposing the authenticated stealth capture API."""

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, Response

from harvester.api.auth import is_authorized
from harvester.api.capacity import CapacityLimiter
from harvester.browser import Harvester
from harvester.config import Config, load_config, validate_config
from harvester.models import ErrorResponse, HarvestRequest, HarvestResponse

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


_docs_kwargs: dict[str, Any] = (
    {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}
    if config.enable_docs
    else {"docs_url": None, "redoc_url": None, "openapi_url": None}
)

app = FastAPI(
    title="Stealth Authorized Browser Capture API",
    description=(
        "Load an allowlisted URL through a stealth Playwright browser, wait for "
        "authorized anti-bot challenges, and return redacted browser state, "
        "scraper headers, and protection metadata.\n\n"
        "All endpoints except `/health` and `/healthz` require a bearer token "
        "matching the configured `API_KEY`, sent as `Authorization: Bearer <token>`. "
        "The target `url` host must appear in `ALLOWED_HOSTS`."
    ),
    version="2.0.0",
    lifespan=lifespan,
    openapi_tags=[
        {"name": "harvest", "description": "Authenticated, allowlisted browser capture"},
        {"name": "health", "description": "Liveness and readiness checks"},
        {"name": "meta", "description": "API documentation and machine-readable spec"},
    ],
    **_docs_kwargs,
)


def _custom_openapi() -> dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=app.openapi_tags,
    )
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "description": "Shared secret configured via API_KEY",
    }
    for path, methods in schema.get("paths", {}).items():
        if path in {"/health", "/healthz"}:
            continue
        for operation in methods.values():
            operation.setdefault("security", [{"BearerAuth": []}])
    app.openapi_schema = schema
    return schema


app.openapi = _custom_openapi  # type: ignore[method-assign]


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


async def _run_harvest(request: Request, req: HarvestRequest):
    if not is_authorized(request, config):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    async with capacity.slot() as reserved:
        if not reserved:
            return JSONResponse(status_code=429, content={"error": "capacity exceeded"})
        try:
            logger.info("harvest request url=%s proxy=%s", req.url, bool(req.proxy))
            result = await harvester.harvest(req)
            if not result.ok:
                return JSONResponse(status_code=502, content=result.model_dump())
            return result
        except Exception as exc:
            logger.exception("unexpected harvest error")
            raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get(
    "/health",
    tags=["health"],
    summary="Liveness and browser-connection check",
    description="Returns service status without requiring authentication. Safe for load balancer health checks.",
)
@app.get("/healthz", tags=["health"], include_in_schema=False)
async def health() -> dict[str, object]:
    ok = await harvester.healthy()
    return {"status": "ok" if ok else "degraded", "browser_connected": ok, "ok": ok}


@app.post(
    "/harvest",
    tags=["harvest"],
    response_model=HarvestResponse,
    summary="Capture an allowlisted URL through a stealth browser",
    description=(
        "Loads `url` in a stealth Playwright browser, optionally waits out a known "
        "anti-bot challenge, and returns redacted cookies/storage/headers plus "
        "protection metadata. Set `include_secrets` to receive actual secret values "
        "if the operator has enabled `CAPTURE_SECRET_VALUES`."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Missing or invalid bearer token"},
        413: {"model": ErrorResponse, "description": "Request body exceeds MAX_BODY_BYTES"},
        422: {"description": "Request failed validation (e.g. disallowed host, malformed proxy)"},
        429: {"model": ErrorResponse, "description": "MAX_CONCURRENCY capacity exceeded"},
        502: {"model": HarvestResponse, "description": "Capture attempted but did not succeed (ok=false)"},
    },
)
async def harvest(request: Request, req: HarvestRequest):
    return await _run_harvest(request, req)


if config.enable_docs:
    # Replace FastAPI's default /openapi.json handler with one that supports
    # ?download=1 (adds Content-Disposition), and add a YAML variant alongside it.
    app.router.routes = [r for r in app.router.routes if getattr(r, "path", None) != "/openapi.json"]

    @app.get(
        "/openapi.json",
        tags=["meta"],
        summary="OpenAPI spec (JSON)",
        description="The machine-readable OpenAPI 3 spec. Pass `?download=1` to receive it as an attachment.",
        include_in_schema=False,
    )
    async def openapi_json(request: Request) -> Any:
        download = request.query_params.get("download", "").lower() in {"1", "true", "yes"}
        headers = {"Content-Disposition": 'attachment; filename="openapi.json"'} if download else None
        return JSONResponse(content=app.openapi(), headers=headers)

    @app.get(
        "/openapi.yaml",
        tags=["meta"],
        summary="Download the OpenAPI spec (YAML)",
        include_in_schema=False,
    )
    async def openapi_yaml() -> Any:
        spec = yaml.safe_dump(app.openapi(), sort_keys=False)
        return Response(
            content=spec,
            media_type="application/yaml",
            headers={"Content-Disposition": 'attachment; filename="openapi.yaml"'},
        )
