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

A `Makefile` wraps the container build + run so every suite is one command
(everything runs **inside the container** — there is no host venv):

```bash
make            # list all targets
make test       # offline suite (no network)
make test-live  # ALL live anti-bot/fingerprint tests (needs network)
make live-list  # list the live tests without running them
make live-tls   # run a single live target (see keywords below)
```

### Offline suite

`make test` runs the whole suite **inside the container** against a local target
server — no external network required. It covers cookie/storage harvesting, HTML
and screenshot capture, an anti-bot challenge that clears via JS, request
isolation, proxy-failure handling, and a check that stealth is genuinely active
(`navigator.webdriver` is hidden). Equivalent to:

```bash
docker build --target test -t harvester:test .
docker run --rm --shm-size=1g harvester:test        # runs pytest -v tests
```

### Live anti-bot / fingerprint tests

Two modules drive the **real** stealth path out to public detection sandboxes
and assert that automation is not detected:

- `tests/test_live_stealth.py` — [bot.sannysoft.com](https://bot.sannysoft.com/)'s
  own verdicts, plus the raw signals a detector reads (`navigator.webdriver` /
  headless-UA hidden, `window.chrome` present, non-empty `navigator.plugins`, a
  hardware non-`SwiftShader` WebGL renderer, consistent notification permissions).
- `tests/test_live_fingerprint.py` — one target per test:

  | Target | Keyword | What it checks |
  |---|---|---|
  | [bot.sannysoft.com](https://bot.sannysoft.com/) | `sannysoft` | headless/webdriver row verdicts |
  | raw signals | `automation` | the fingerprint a detector reads directly |
  | [bot-detector.rebrowser.net](https://bot-detector.rebrowser.net/) | `rebrowser` | modern Playwright-leak probes (init-script / exposeFunction / source-url leaks) |
  | [areyouheadless](https://arh.antoinevastel.com/bots/areyouheadless) | `areyouheadless` | headless verdict text |
  | [CreepJS](https://abrahamjuliot.github.io/creepjs/) | `creepjs` | report computes; no hard automation tells |
  | [browserleaks WebGL](https://browserleaks.com/webgl) | `webgl` | GPU is hardware, not software (SwiftShader/llvmpipe) |
  | [iphey.com](https://iphey.com/) | `iphey` | browser trust verdict (Trustworthy vs Suspicious) |
  | [tls.peet.ws](https://tls.peet.ws/api/all) | `tls` | JA3/JA4/Akamai-H2 present and consistent with the Chrome UA |
  | Cloudflare managed challenge (nowsecure.nl) | `cloudflare` | full harvest pipeline clears the interstitial and gets a `cf_clearance` cookie |

Run one with `make live-<keyword>`, e.g. `make live-rebrowser` or `make live-tls`
(maps to `pytest -m live -k <keyword>`).

These reach the public internet, so they are **skipped by default** — the offline
suite never leaves the container. `make test-live` opts in via `RUN_LIVE_TESTS=1`.
The raw equivalent:

```bash
docker build --target test -t harvester:test .
docker run --rm --shm-size=1g -e RUN_LIVE_TESTS=1 harvester:test \
  pytest -v -m live tests
```

A live site being unreachable (timeout / gateway error) **skips** the test; a
site whose verdict can't be located from your egress IP (async render, IP-block)
also **skips** rather than failing on garbage. Only a *genuine detection* fails.
Because verdict parsing on third-party pages is inherently brittle, tighten a
given test's parsing once you've seen its real response from your own egress /
proxy. Results depend heavily on the exit IP — run these through the same
residential proxy you use in production for a representative signal.

## Layout

```
app/
  main.py               FastAPI app: /health, /harvest, lifespan-managed browser
  harvester.py          Browser driver: stealth, proxy, challenge wait, harvest
  stealth_compat.py     Shim over playwright-stealth 1.x / 2.x + hardening loader
  stealth_hardening.js  Extra evasions injected on every page (plugins/WebGL/perms)
  models.py             Pydantic request/response schemas
tests/                    In-container pytest suite + local target-server fixture
  test_live_stealth.py    Opt-in live tests: sannysoft verdicts + raw signals
  test_live_fingerprint.py  Opt-in live tests: one anti-bot/fingerprint target each
Dockerfile           base (runtime) and test build targets, one image
docker-compose.yml   Convenience runner (shm_size, port map)
Makefile             One-command build/run/test wrappers (make, make test-live, live-<target>)
```

## Responsible use

This tool loads pages through a real browser to collect the session state a site
grants you. Use it only against targets you own or are authorized to access, and
in accordance with those sites' terms of service and applicable law.

## License

Released under the [MIT License](LICENSE).
