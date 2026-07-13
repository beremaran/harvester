"""API-level tests hitting the FastAPI app through an in-process ASGI transport."""
from __future__ import annotations

import httpx
import pytest
import pytest_asyncio

from app import main
from app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def client():
    # Drive the shared harvester singleton the app uses.
    await main.harvester.start()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        try:
            yield c
        finally:
            await main.harvester.stop()


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["browser_connected"] is True


async def test_harvest_endpoint(client, target_server):
    r = await client.post(
        "/harvest",
        json={"url": target_server, "return_html": True},
        timeout=60,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    names = {c["name"] for c in body["cookies"]}
    assert "session_id" in names
    assert body["local_storage"]["flag"] == "harvested"
    assert body["html"]


async def test_harvest_validation_error(client):
    r = await client.post("/harvest", json={"url": "not-a-url"})
    assert r.status_code == 422


async def test_harvest_failure_returns_502(client, target_server):
    r = await client.post(
        "/harvest",
        json={
            "url": target_server,
            "proxy": {"server": "http://127.0.0.1:1"},
            "timeout_ms": 4000,
            "challenge_wait_ms": 0,
        },
        timeout=60,
    )
    assert r.status_code == 502
    assert r.json()["ok"] is False
    assert r.json()["error"]
