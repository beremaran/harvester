# Cookie / Session Harvester

A single Docker container exposing an HTTP API that loads a target URL through a
supplied proxy using **Chromium + [`playwright-stealth`]**, waits out anti-bot
challenges (Cloudflare "Just a moment…", DDoS-Guard, Turnstile interstitials),
and returns the **cookies, localStorage, and sessionStorage** the site set —
plus, optionally, the fully rendered HTML and a screenshot.

The browser process is launched once and reused; every request runs in a fresh,
isolated browser context so nothing leaks between requests.

[`playwright-stealth`]: https://pypi.org/project/playwright-stealth/

## Build & run

```bash
# Build the runtime image
docker build --target base -t harvester:latest .

# Run the API (Chromium needs a larger /dev/shm than Docker's 64MB default)
docker run --rm --shm-size=1g -p 8080:8080 harvester:latest
```

Or with compose:

```bash
docker compose up --build
```

## API

### `GET /health`
Returns `{"status": "ok", "browser_connected": true}` once the browser is up.

### `POST /harvest`

Request body (only `url` is required):

```jsonc
{
  "url": "https://target.example.com",        // required, http(s)
  "proxy": {                                   // optional
    "server": "http://proxy-host:8000",        // http|https|socks5|socks4
    "username": "user",                         // optional
    "password": "pass",                         // optional
    "bypass": "localhost,127.0.0.1"             // optional
  },

  "return_html": false,                          // include rendered HTML
  "return_screenshot": false,                    // include base64 PNG

  "wait_until": "networkidle",                   // load|domcontentloaded|networkidle|commit
  "timeout_ms": 45000,                           // navigation timeout
  "wait_for_selector": "#logged-in",            // optional: wait for a selector post-challenge
  "extra_wait_ms": 0,                            // extra idle wait after load
  "challenge_wait_ms": 15000,                     // max time to wait for an interstitial to clear

  "user_agent": null,                            // override UA
  "locale": "en-US",
  "timezone_id": "America/New_York",            // optional
  "viewport_width": 1920,
  "viewport_height": 1080,
  "extra_headers": { "X-Foo": "bar" }           // optional
}
```

Response:

```jsonc
{
  "ok": true,
  "url": "https://target.example.com",
  "final_url": "https://target.example.com/",
  "status": 200,
  "title": "…",
  "cookies": [ { "name": "...", "value": "...", "domain": "...", "path": "/", "httpOnly": true, ... } ],
  "local_storage": { "token": "…" },
  "session_storage": { "sid": "…" },
  "challenge_detected": false,
  "challenge_cleared": null,        // true/false when a challenge was seen
  "html": null,                     // present when return_html=true
  "screenshot_b64": null,           // present when return_screenshot=true
  "elapsed_ms": 1234,
  "error": null
}
```

On a harvest failure the endpoint returns HTTP **502** with the same body shape
(`ok: false`, `error` populated). Validation errors return **422**.

### Example

```bash
curl -s http://localhost:8080/harvest \
  -H 'Content-Type: application/json' \
  -d '{
        "url": "https://example.com",
        "proxy": {"server": "http://user:pass@proxy:8000"},
        "return_html": true
      }' | jq '{ok, status, cookies: (.cookies|length), keys: (.local_storage|keys)}'
```

## How challenges are handled

After navigation the page is polled for known interstitial signatures
(Cloudflare `__cf_chl` / "just a moment", DDoS-Guard, generic "checking your
browser", etc.). While one is present, the harvester lets the challenge JS run
and settle, retrying until `challenge_wait_ms` elapses. `challenge_detected` and
`challenge_cleared` report what happened. For tougher targets, combine a
residential proxy with `wait_for_selector` (an element that only exists past the
wall) and a generous `challenge_wait_ms`.

Stealth (via `playwright-stealth`) plus a set of automation-hiding launch flags
(`--disable-blink-features=AutomationControlled`, a realistic User-Agent,
`navigator.webdriver` patched, etc.) reduce the fingerprints that trip these
systems in the first place.

On top of `playwright-stealth`, `app/stealth_hardening.js` is injected into every
page to cover surfaces the library leaves exposed on modern Chromium: it
populates `navigator.plugins`/`mimeTypes` (empty under headless), spoofs the WebGL
vendor/renderer away from the tell-tale `SwiftShader` software renderer, and makes
`Notification.permission` consistent with `permissions.query`. The exact stealth
context/page setup lives in `Harvester.open_stealth_page`, which both `harvest`
and the live tests use so they exercise the identical path.

## Tests

The whole suite runs **inside the container** against a local target server —
no external network required. It covers cookie/storage harvesting, HTML and
screenshot capture, an anti-bot challenge that clears via JS, request isolation,
proxy-failure handling, and a check that stealth is genuinely active
(`navigator.webdriver` is hidden).

```bash
docker build --target test -t harvester:test .
docker run --rm --shm-size=1g harvester:test        # runs pytest -v tests
```

### Live stealth tests

There is also a small suite of **live** tests (`tests/test_live_stealth.py`) that
drive the real stealth path (`Harvester.open_stealth_page`) out to public
fingerprinting / bot-detection sites and assert that automation is not detected —
`navigator.webdriver`/headless-UA hidden, `window.chrome` present, non-empty
`navigator.plugins`, a hardware (non-`SwiftShader`) WebGL renderer, consistent
notification permissions, and a clean sweep of
[bot.sannysoft.com](https://bot.sannysoft.com/)'s own verdicts.

They reach the public internet, so they are **skipped by default** — the standard
suite above never leaves the container. Opt in with `RUN_LIVE_TESTS=1` (the
container needs outbound network, which Docker allows by default):

```bash
docker build --target test -t harvester:test .
docker run --rm --shm-size=1g -e RUN_LIVE_TESTS=1 harvester:test \
  pytest -v -m live tests
```

A live site being unreachable (timeout / gateway error) **skips** the test; only a
genuine detection makes it fail.

## Layout

```
app/
  main.py               FastAPI app: /health, /harvest, lifespan-managed browser
  harvester.py          Browser driver: stealth, proxy, challenge wait, harvest
  stealth_compat.py     Shim over playwright-stealth 1.x / 2.x + hardening loader
  stealth_hardening.js  Extra evasions injected on every page (plugins/WebGL/perms)
  models.py             Pydantic request/response schemas
tests/                  In-container pytest suite + local target-server fixture
  test_live_stealth.py  Opt-in live tests against public fingerprinting sites
Dockerfile           base (runtime) and test build targets, one image
docker-compose.yml   Convenience runner (shm_size, port map)
```

## Responsible use

This tool loads pages through a real browser to collect the session state a site
grants you. Use it only against targets you own or are authorized to access, and
in accordance with those sites' terms of service and applicable law.

## License

Released under the [MIT License](LICENSE).
