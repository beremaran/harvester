# Renderer worker

A small HTTP service that opens a page in Chrome and returns its rendered
output. Crawling and SEO analysis belong in downstream services.

## Responsible use

This drives a real browser against real websites and reports how their bot
defences respond. That is useful for research, for testing systems you are
responsible for, and for measuring your own exposure — and it is just as
capable of being pointed somewhere it does not belong. By using it you accept
that:

- You run it only against systems you own or have explicit authorisation to
  test. If you are unsure whether your use is authorised, it is not; get
  permission first.
- You respect the target's terms of service and `robots.txt`, and you keep
  `RENDER_CONCURRENCY` and your own request rate low enough that you never
  degrade the service for its actual users. This is not a load-testing tool and
  it is not a denial-of-service tool.
- You do not use it to bypass authentication, authorisation, payment, or
  licensing controls, to obtain credentials or session material belonging to
  anyone else, for account abuse, or to harvest personal data.
- You handle what it returns accordingly. Cookies, headers, and rendered HTML
  routinely contain session material and personal data; store them only as long
  as you need them, and keep them out of issues, logs, and screenshots.
- You carry the legal responsibility for what you do with it. The software is
  provided as is, without warranty of any kind — see [LICENSE](LICENSE).

The blocking assessment exists to record *where* a defence stopped a request so
it can be reported, not to grind past it. Deployment expectations for the
service itself are in [SECURITY.md](SECURITY.md).

## Run it

```sh
npm install
npm run dev
```

Open the playground at [http://localhost:5173](http://localhost:5173). The
Vite dev server sends render and health calls to the worker on port 8082.

Render a page:

```sh
curl http://localhost:8082/render \
  --json '{"url":"https://example.com"}'
```

The result includes:

- the requested and final URLs
- the HTTP status and page title
- rendered HTML
- the final document request headers
- all cookies set in the browser context
- a `scraper` handoff for replaying the session without a browser
- render time

The playground also has on-demand browser checks for Rebrowser, Sannysoft,
Device & Browser Info, and BrowserLeaks. These checks run through the same
browser service and return a page capture plus a short list of detected facts.
The Rebrowser check calls the extra probe hooks listed in that test's guide.

Set `"screenshot": true` in the request to include a base64 full-page
screenshot. Screenshots stay off by default to cut work and response size.

Downstream crawlers can load `cookies` into a cookie jar and use the useful
parts of `requestHeaders`, such as `user-agent`, `accept`, and
`accept-language`. Do not copy `cookie` from the headers; let the cookie jar
build it for each URL. Headers such as `host`, `content-length`, `sec-fetch-*`,
`sec-ch-ua*`, and `accept-encoding` should also stay under the HTTP client's
control. HTTP/2 pseudo-headers are not included.

## Scraper handoff

Replaying the headers and cookies above from a plain HTTP client is usually
not enough: the client's TLS ClientHello and HTTP/2 preface do not match the
Chrome its `user-agent` claims to be, and that mismatch alone is enough for
several defences to challenge it. Every render therefore includes a `scraper`
object with the whole transport picture:

```json
{
  "origin": "https://www.example.com",
  "userAgent": "Mozilla/5.0 ... Chrome/133.0.0.0 Safari/537.36",
  "protocol": "h2",
  "headers": { "sec-ch-ua": "...", "user-agent": "...", "accept": "..." },
  "headerOrder": ["host", "sec-ch-ua", "user-agent", "..."],
  "cookieHeader": "session=abc; region=nsw",
  "clientOwnedHeaders": { "cookie": "send `cookieHeader`, or use a jar" },
  "tls": {
    "source": "measured",
    "ja4": "t13d1516h2_8daaf6152771_02713d6af862",
    "ja3": "771,4865-4866-4867-...",
    "http2": { "fingerprint": "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p" },
    "curves": ["X25519MLKEM768", "X25519", "P-256", "P-384"]
  },
  "tlsClient": {
    "library": "bogdanfinn/tls-client",
    "profile": "chrome_133",
    "requestPayload": { "tlsClientIdentifier": "chrome_133", "...": "..." }
  },
  "curlImpersonate": "curl_chrome133 -H '...' 'https://www.example.com/'"
}
```

- `headers` are the replayable ones. `headerOrder` is the order to send them
  in, including the headers listed in `clientOwnedHeaders`, which the client
  must set itself. Pass it to a client that honours header order: alphabetised
  headers are their own tell, and no browser sends them that way. (The order
  is Chrome's known order rather than the observed one — CDP hands request
  headers back sorted, so the real wire order is not observable from here.)
- `cookieHeader` is the cookie jar already reduced to the cookies that apply
  to `finalUrl` (domain, path, and `secure` honoured).
- `tlsClient.requestPayload` is a ready-to-post body for the
  [`bogdanfinn/tls-client`](https://github.com/bogdanfinn/tls-client) HTTP API,
  and `tlsClient.profile` is the `tlsClientIdentifier` for the Go library. The
  profile is pinned to the newest Chrome the library supports that is not
  ahead of the browser we rendered with.
- `curlImpersonate` is the same request for a
  [curl-impersonate](https://github.com/lwthiker/curl-impersonate) build.

`tls.source` says how much to trust the hashes. `measured` means the renderer
hit `TLS_FINGERPRINT_PROBE_URL` with its own Chrome and read the handshake
back, so the values are exact. `profile` means the probe was disabled or
failed and the values were derived from the Chrome version: the cipher, curve,
and HTTP/2 lists are right, but there is no JA3/JA4 hash, because Chrome
shuffles its TLS extension order and injects GREASE on every connection.
Match on JA4 rather than JA3 for that reason.

## Commands

- `npm run dev` starts the service and reloads it after source changes.
- `npm run dev:api` starts only the renderer API.
- `npm run dev:ui` starts only the Vite playground.
- `npm test` runs the domain, use-case, and HTTP tests.
- `npm run check` checks TypeScript.
- `npm run build` writes the server to `dist` and the UI to `web-dist`.
- `npm start` runs the built service and serves the playground on port 8082.
- `npm run release -- <patch|minor|major>` cuts a release. See **Releases**.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8082` | HTTP port |
| `RENDER_CONCURRENCY` | `3` | Pages rendered at once |
| `BROWSER_CHANNEL` | `chrome` | Playwright browser channel |
| `HEADLESS` | `true` | Set to `false` to render on a real display |
| `LOCALE` | `en-AU` | Browser locale, sent as `Accept-Language` |
| `TIMEZONE` | `Australia/Sydney` | Browser timezone |
| `VIEWPORT_WIDTH` | `1440` | Viewport and window width |
| `VIEWPORT_HEIGHT` | `900` | Viewport and window height |
| `USER_AGENT` | Chrome's own | Overrides the user agent |
| `TLS_FINGERPRINT_PROBE_URL` | `https://tls.peet.ws/api/all` | Endpoint used to measure our own TLS fingerprint; set empty to disable |
| `PROXY_SERVER` | none | Proxy every render leaves through, e.g. `http://proxy.example:3128` |
| `PROXY_USERNAME` | none | Proxy username, if it authenticates |
| `PROXY_PASSWORD` | none | Proxy password |
| `PROXY_BYPASS` | none | Comma-separated hosts to reach directly, e.g. `.internal, localhost` |

Locale and timezone matter for region-aware sites: a page served to a browser
claiming `en-AU` in `Australia/Sydney` can differ from the default.

Set `USER_AGENT` to something that identifies you and gives a contact address
when you run against sites you do not own.

The TLS probe runs once per process, on the first render, and its result is
reused for every later render. Set `TLS_FINGERPRINT_PROBE_URL=` (empty) to
keep the renderer off third-party endpoints; renders then report
`scraper.tls.source` as `profile`. A probe failure never fails a render.

## Proxies

Set `PROXY_SERVER` and every render, bot check, and TLS probe leaves through
it. A single render can override it:

```sh
curl http://localhost:8082/render \
  --json '{
    "url": "https://example.com",
    "proxy": { "server": "http://user:pass@proxy.example:3128" }
  }'
```

`http`, `https`, `socks4`, and `socks5` are supported; a bare `host:3128` is
read as an HTTP proxy. Credentials may be given inline in the URL or as
separate `username`/`password` fields — Chrome ignores credentials in the
proxy URL, so they are lifted out either way. Chromium cannot authenticate to
a SOCKS proxy, so a SOCKS server with a username is rejected rather than
silently connected to as anonymous.

The render reports its egress as `proxy: { server, source, authenticated }` —
`source` is `request` or `config` — and the `scraper` handoff carries the same
server so a downstream replay leaves from the same exit IP as the session it
is replaying. Credentials are never returned: with an environment-configured
proxy they belong to the operator, not to whoever called `/render`.

## Sessions

Contexts are kept per origin *and* egress, so a session started through one
proxy is never continued through another. Cookies and any session survive from
one call to the next. A fresh context per request means
consent and region interstitials re-fire every time and no session is ever
established.

## Blocking assessment

Every render includes a `blocking` object describing whether a bot defence
stopped the request:

```json
{
  "outcome": "challenged",
  "vendor": "Akamai Bot Manager",
  "signals": [
    { "source": "cookie", "detail": "_abck" },
    { "source": "body", "detail": "page title: Access Denied" }
  ]
}
```

`outcome` is `served`, `challenged`, or `blocked`. A vendor cookie on a
successful render is normal and reports as `served` — it means the defence is
present and let the request through.

This reads evidence that is already in the response. It does not try to change
the outcome. Where a request gets stopped is the finding worth recording; use
it to document blockers rather than to work around them.

## Code layout

The server keeps business rules apart from tools:

- `src/domain` owns render and bot-check terms and rules.
- `src/application` holds the render and bot-check use cases and their ports.
- `src/infrastructure/playwright` implements those ports with Playwright.
- `src/http` maps HTTP input and output to the use cases.
- `src/server.ts` reads config and wires the parts together.

The playground follows the same bounds. `web/src/domain` holds client-side
rules, `web/src/api` owns HTTP calls, and components own screen layout.

## Run it with Docker

Build and start the production image:

```sh
docker build -t renderer-worker .
docker run --rm --platform linux/amd64 -p 8082:8082 \
  --init --shm-size=1gb renderer-worker
```

Check that it is ready:

```sh
curl http://localhost:8082/health
```

Set any variable from **Settings** with `docker run -e`. If you change `PORT`,
also change the container side of the port mapping. The larger shared memory
limit helps Chrome render large pages without crashing.

The image runs under `xvfb-run`, so `HEADLESS=false` works in the container and
renders against a real display. It costs nothing when headless.

The image installs and runs Google Chrome. Google publishes Chrome for Linux
on x86-64 only, so the image targets `linux/amd64`. Docker can run it through
emulation on Apple Silicon. Local runs also use an installed Google Chrome by
default.

## Published images

Every push to `main` and every release tag publishes an image to the GitHub
Container Registry:

```sh
docker pull ghcr.io/beremaran/harvester:1.0.0   # a release
docker pull ghcr.io/beremaran/harvester:1.0     # newest patch of 1.0
docker pull ghcr.io/beremaran/harvester:1       # newest 1.x
docker pull ghcr.io/beremaran/harvester:edge    # newest main
```

Images are also tagged `sha-<short sha>`. Pin a full version in anything you
depend on; `edge` moves with every merge. `GET /health` reports the version the
running container was built from.

## Releases

The project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and
keeps a [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)-style
[CHANGELOG.md](CHANGELOG.md). Describe user-visible changes under
**Unreleased** as you merge them.

To cut a release from a clean `main`:

```sh
npm run release -- minor      # or patch, major, or an explicit X.Y.Z
git push --follow-tags
```

`npm run release` typechecks and tests, bumps `package.json` and the lockfile,
moves the Unreleased entries under a dated version heading, commits
`chore(release): vX.Y.Z`, and creates the matching annotated tag. Nothing is
pushed for you.

Pushing the tag runs `.github/workflows/release.yml`, which builds the image,
pushes the version tags above to GHCR, smoke-tests the pushed image against
`/health`, and opens a GitHub release whose notes are that version's changelog
section.

Useful flags: `--dry-run` (report what would happen and stop), `--skip-checks`
(skip typecheck and tests), `--allow-empty-changelog`, `--allow-any-branch`.
