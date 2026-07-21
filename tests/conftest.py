"""Shared fixtures: a local target server that exercises every harvest path,
so the whole suite runs inside the container with no external network.

A shared, session-scoped Harvester (one browser process) is also provided here,
plus the gate that keeps the opt-in ``live`` fingerprinting tests from running
unless RUN_LIVE_TESTS=1."""
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import pytest_asyncio

from harvester.browser import Harvester

# Keep the in-process API tests on the same secure configuration as production,
# while allowing their loopback target server.
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("ALLOWED_HOSTS", "127.0.0.1")
os.environ.setdefault("ALLOW_PRIVATE_NETWORKS", "true")
os.environ.setdefault("CAPTURE_SECRET_VALUES", "true")

from harvester.config import load_config

# --- HTML fixtures the test server serves -----------------------------------

_HOME_HTML = """<!doctype html>
<html><head><title>Harvest Home</title></head>
<body>
<h1>home</h1>
<script>
  localStorage.setItem('token', 'abc123');
  localStorage.setItem('flag', 'harvested');
  sessionStorage.setItem('sid', 'sess-xyz');
</script>
</body></html>"""

# Mimics a Cloudflare "Just a moment..." interstitial that clears itself after
# a short delay via JavaScript — the same shape our challenge poller waits on.
_CHALLENGE_HTML = """<!doctype html>
<html><head><title>Just a moment...</title></head>
<body>
<h1>Checking your browser before accessing</h1>
<p>Verifying you are human. This may take a few seconds.</p>
<div id="__cf_chl">/cdn-cgi/challenge-platform</div>
<script>
  setTimeout(function () {
    document.title = 'Protected Area';
    document.body.innerHTML = '<h1 id="content">Access granted</h1>';
    localStorage.setItem('cf_clearance', 'granted');
  }, 700);
</script>
</body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence per-request logging
        return

    def _send(self, body: str, cookie: str) -> None:
        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):  # noqa: N802 - stdlib naming
        if self.path.startswith("/bypass"):
            if self.headers.get("x-harvester-bypass") != "test-secret":
                self.send_response(403)
                self.send_header("Server", "cloudflare")
                self.send_header("cf-mitigated", "challenge")
                self.end_headers()
                self.wfile.write(b"<title>Just a moment...</title>")
                return
            self.send_response(200)
            self.send_header("x-harvester-bypass", "test-secret")
            self.end_headers()
            self.wfile.write(b"<h1>Authorized capture</h1>")
            return
        if self.path.startswith("/challenge"):
            self._send(_CHALLENGE_HTML, "cf_bm=challengecookie; Path=/")
        else:
            self._send(_HOME_HTML, "session_id=cookievalue123; Path=/")


@pytest.fixture(scope="session")
def target_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()


# --- Shared browser --------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def harvester():
    """One long-lived, stealth-configured browser shared across the suite —
    the same singleton pattern the API uses."""
    h = Harvester(
        config=load_config(),
        enforce_security=os.environ.get("RUN_LIVE_TESTS") != "1",
    )
    await h.start()
    try:
        yield h
    finally:
        await h.stop()


# --- Live-test gate --------------------------------------------------------

RUN_LIVE = os.environ.get("RUN_LIVE_TESTS") == "1"


def pytest_collection_modifyitems(config, items):
    """Skip anything marked ``live`` unless RUN_LIVE_TESTS=1, so the default
    offline suite never reaches the public internet."""
    if RUN_LIVE:
        return
    skip = pytest.mark.skip(reason="live network test; set RUN_LIVE_TESTS=1 to run")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)
