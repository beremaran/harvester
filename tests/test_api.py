"""API-level tests hitting the FastAPI app through an in-process ASGI transport."""

import httpx
import pytest
import pytest_asyncio

from harvester import main
from harvester.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def client():
    # Drive the shared harvester singleton the app uses.
    await main.harvester.start()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": "Bearer test-key"},
    ) as c:
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
    assert body["local_storage"]["flag"] == "[REDACTED]"
    assert body["scraper_headers"]["user-agent"].startswith("Mozilla/")
    assert "set-cookie" not in body["response_headers"]
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


async def test_capture_compatibility_contract_returns_secrets_when_enabled(client, target_server):
    r = await client.post(
        "/v1/capture",
        json={"url": target_server, "includeHtml": True, "includeSecrets": True},
        timeout=60,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["finalStatus"] == 200
    assert body["storage"]["localStorage"]["token"] == "abc123"
    assert body["scraperHeaders"]["cookie"].startswith("session_id=")


async def test_authentication_is_required(client, target_server):
    del client.headers["Authorization"]
    r = await client.post("/harvest", json={"url": target_server})
    assert r.status_code == 401
