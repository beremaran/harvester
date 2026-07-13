# Stealth Browser Capture API

An HTTP service that loads a URL through Chromium with `playwright-stealth`,
waits for known anti-bot challenges, and returns cookies, web storage, browser
headers, rendered HTML, screenshots, and protection metadata.

The service is intended to sit behind the network boundary of its compose
project. It does not provide API authentication, target-host allowlisting,
DNS filtering, or secret redaction. Keep the container private to that trusted
network.

## Build and run

```bash
docker compose up --build
```

The API listens on `http://localhost:8080`. Chromium needs a larger shared
memory segment; Compose configures `1gb`.

## API

### `GET /health` or `GET /healthz`

Returns the browser status:

```json
{"status":"ok","browser_connected":true,"ok":true}
```

### `POST /harvest`

The native Python endpoint. The only required field is `url`.

```json
{
  "url": "https://example.com/",
  "proxy": {
    "server": "http://proxy.internal:8080",
    "username": "proxy-user",
    "password": "proxy-password"
  },
  "return_html": true,
  "challenge_wait_ms": 15000,
  "wait_for_selector": "#logged-in"
}
```

The response includes `final_url`, `status`, `final_status`, `title`,
`cookies`, `local_storage`, `session_storage`, `request_headers`,
`response_headers`, `scraper_headers`, `protection`, and optional `html` and
`screenshot_b64`. Captured values are returned as-is.

### `POST /v1/capture`

Compatibility endpoint for the original scraper contract. It accepts both
snake_case and camelCase request names such as `includeHtml` and `waitForMs`,
and returns `finalUrl`, `finalStatus`, `storage`, `requestHeaders`,
`responseHeaders`, `scraperHeaders`, and `protection`.

```bash
curl -sS http://localhost:8080/v1/capture \
  -H 'content-type: application/json' \
  --data '{"url":"https://example.com/","includeHtml":true}' \
  | jq '{finalUrl, finalStatus, scraperHeaders, protection}'
```

`scraperHeaders` contains common browser headers and the current `cookie`
header. It is intended as capture metadata, not a guarantee that a non-browser
HTTP client can reproduce the request.

Capture failures return HTTP `502`; invalid request bodies return `422`,
oversized bodies return `413`, and capacity limits return `429`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MAX_CONCURRENCY` | `2` | Maximum simultaneous captures. |
| `NAVIGATION_TIMEOUT_MS` | `45000` | Default navigation timeout. |
| `MAX_HTML_BYTES` | `2000000` | Maximum returned rendered HTML size. |
| `MAX_BODY_BYTES` | `65536` | Maximum capture request body size. |
| `PORT` | `8080` | HTTP listen port. |

## Tests

The supported workflow runs the pinned Playwright environment in Docker:

```bash
make test            # offline suite
make test-live       # opt-in public fingerprint/anti-bot suite
make live-rebrowser  # one live target
make live-list       # list live tests
```

The offline suite covers cookies/storage, HTML and screenshots, challenge
waiting, isolation, proxy failures, stealth activation, header capture, and
provider detection. Live tests are skipped unless `RUN_LIVE_TESTS=1`.

## Layout

```text
app/main.py              FastAPI routes, limits, and lifecycle
app/harvester.py         Stealth browser, capture, and challenge waiting
app/config.py            Environment configuration
app/detection.py         WAF/anti-bot marker detection
app/models.py            Pydantic request/response schemas
app/stealth_compat.py    playwright-stealth 1.x/2.x compatibility
app/stealth_hardening.js Supplemental fingerprint hardening
tests/                   Offline and opt-in live tests
```
