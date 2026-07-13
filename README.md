# Stealth Authorized Browser Capture API

An internal HTTP service that loads authorized targets through a real Chromium
browser with `playwright-stealth`, waits for known anti-bot challenges, and
returns browser state plus ready-to-use scraper metadata.

Use it only against targets you own or are authorized to test. The service is a
capture primitive, not a general scraping framework or a permission to bypass a
site's controls.

## What it provides

- Stealth Chromium with a fresh isolated context for every request.
- Optional proxy, locale, timezone, viewport, HTML, screenshot, selector wait,
  and challenge wait controls.
- API-key authentication and an operator-controlled hostname allowlist.
- DNS/private-network checks and re-validation of redirects and subresources.
- Redacted cookies, localStorage, sessionStorage, request headers, response
  headers, and common browser `scraper_headers` by default.
- Explicit dual opt-in for secret values: the request must ask for them and the
  operator must enable `CAPTURE_SECRET_VALUES=true`.
- Exact-host owner-managed WAF bypass headers, restricted to safe custom `x-*`
  headers and HTTPS by default.
- Protection evidence for Cloudflare, Imperva, Akamai, DataDome,
  HUMAN/PerimeterX, Sucuri, AWS WAF, and Kasada.

Stealth and challenge waiting are retained from the Python implementation. The
WAF header mechanism is for an exception configured by the target owner; it is
not a generic anti-bot bypass or CAPTCHA solver.

## Build and run

```bash
export API_KEY="$(openssl rand -hex 32)"
export ALLOWED_HOSTS="example.com,*.example.com"

docker compose -f docker-compose.yml up --build
```

The API listens on `http://localhost:8080`. Chromium needs a larger shared
memory segment; Compose configures `1gb`.

## API

### `GET /health` or `GET /healthz`

Health is unauthenticated:

```json
{"status":"ok","browser_connected":true,"ok":true}
```

### `POST /harvest`

This is the native Python API. It requires `Authorization: Bearer <API_KEY>`.

```json
{
  "url": "https://example.com/",
  "proxy": {
    "server": "http://proxy.internal:8080",
    "username": "proxy-user",
    "password": "proxy-password"
  },
  "return_html": true,
  "include_secrets": false,
  "challenge_wait_ms": 15000,
  "wait_for_selector": "#logged-in"
}
```

The response includes `final_url`, `status`, `final_status`, `cookies`,
`local_storage`, `session_storage`, `request_headers`, `response_headers`,
`scraper_headers`, `bypass`, `protection`, and optional `html` and
`screenshot_b64`.

### `POST /v1/capture`

This compatibility endpoint preserves the original Node scraper contract. It
accepts both Python snake_case and the original camelCase request names such as
`includeHtml`, `includeSecrets`, and `waitForMs`, and returns `finalUrl`,
`finalStatus`, `storage`, `requestHeaders`, `responseHeaders`,
`scraperHeaders`, `protection`, and `secretsIncluded`.

Example:

```bash
curl -sS http://localhost:8080/v1/capture \
  -H "Authorization: Bearer $API_KEY" \
  -H 'content-type: application/json' \
  --data '{"url":"https://example.com/","includeHtml":true}' \
  | jq '{finalUrl, finalStatus, scraperHeaders, protection}'
```

`scraperHeaders` is intentionally a small replay-oriented set: `accept`,
`accept-language`, `cache-control`, `pragma`, `referer`, and `user-agent`.
`cookie` appears only when secrets are actually enabled. It is not a guarantee
that a non-browser HTTP client can reproduce the browser request.

Capture failures return HTTP `502`; invalid request bodies return `422`,
unauthorized requests return `401`, oversized bodies return `413`, and capacity
limits return `429`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `API_KEY` | none | Required bearer token for capture endpoints. |
| `ALLOWED_HOSTS` | none | Comma-separated exact hosts and/or `*.example.com` patterns. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Permit loopback, private, link-local, multicast, and reserved DNS results. Keep disabled normally. |
| `CAPTURE_SECRET_VALUES` | `false` | Allow requests with `include_secrets`/`includeSecrets` to return values. |
| `MAX_CONCURRENCY` | `2` | Maximum simultaneous captures. |
| `NAVIGATION_TIMEOUT_MS` | `45000` | Default navigation timeout. |
| `MAX_HTML_BYTES` | `2000000` | Maximum returned rendered HTML size. |
| `MAX_BODY_BYTES` | `65536` | Maximum capture request body size. |
| `BYPASS_HEADERS_JSON` | empty | Exact-host JSON map of owner-managed safe `x-*` WAF exception headers. |
| `ALLOW_INSECURE_BYPASS_HEADERS` | `false` | Permit bypass headers over HTTP; use only in isolated tests. |
| `ALLOW_CALLER_HEADERS` | `false` | Opt in to request-supplied `extra_headers`; disabled by default at the security boundary. |
| `PORT` | `8080` | HTTP listen port. |

Example WAF configuration:

```bash
export BYPASS_HEADERS_JSON='{"example.com":{"x-harvester-bypass":"owner-managed-secret"}}'
```

Bypass hostnames must be covered by `ALLOWED_HOSTS`. Values are never returned;
request headers redact them, response headers omit them, and `scraper_headers`
does not include them.

## Tests

The supported workflow runs the pinned Playwright environment in Docker:

```bash
make test            # offline suite
make test-live       # opt-in public fingerprint/anti-bot suite
make live-rebrowser  # one live target
make live-list       # list live tests
```

The offline suite covers cookies/storage, HTML and screenshots, challenge
waiting, isolation, proxy failures, stealth activation, authentication,
redaction, WAF bypass behavior, header capture, URL/DNS security, and provider
detection. Live tests are skipped unless `RUN_LIVE_TESTS=1`.

## Layout

```text
app/main.py              FastAPI routes, auth, limits, lifecycle
app/harvester.py         Stealth browser, interception, capture, redaction
app/config.py            Environment configuration and bypass validation
app/security.py          URL, DNS, private-network, and proxy validation
app/detection.py         WAF/anti-bot marker detection
app/models.py            Pydantic request/response schemas
app/stealth_compat.py    playwright-stealth 1.x/2.x compatibility
app/stealth_hardening.js Supplemental fingerprint hardening
tests/                   Offline and opt-in live tests
```
