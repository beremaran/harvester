# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`npm run release -- <patch|minor|major>` folds the **Unreleased** section below
into a new version heading, so keep adding entries there as you merge changes.

## [Unreleased]

### Fixed

- A render whose page execution world is unavailable now fails instead of
  quietly guessing the negotiated protocol. rebrowser's patched
  `frames._context` resolves `undefined` rather than rejecting when
  `Page.addScriptToEvaluateOnNewDocument` fails (it logs `cannot get world`),
  so `page.evaluate` failed, the navigation-timing read swallowed it, and the
  handoff went out asserting `h2` for a navigation that never negotiated it.
  Replaying that mismatch is the kind of inconsistency an edge answers by
  closing the connection, which made the resulting session look valid at
  capture and fail every replay afterwards.

## [1.5.0] - 2026-07-27

### Added

- `GET /metrics`, Prometheus text. `harvester_render_blocking_total{outcome,
  vendor}` records the bot-defence classification every render already
  produces, so the posture reading becomes a trend rather than a per-call
  answer; alongside it are render counts and durations, queue depth, refusals,
  Chrome's lifecycle, bot-check verdicts and TLS probe failures, plus the
  standard `process_*` and `nodejs_*` series. The route is open when `API_KEY`
  is set, like `/health`.

### Fixed

- A crashed Chrome is no longer handed out forever. `BrowserManager` now
  listens for `disconnected` and drops the cached browser, so the next render
  relaunches instead of failing somewhere far from the cause.

## [1.4.0] - 2026-07-26

### Added

- `linux/arm64` images. Release builds now publish a multi-arch manifest, so
  Apple Silicon and arm64 servers pull a native image instead of emulating
  x86-64. Google publishes Chrome for Linux on x86-64 only, so the arm64 image
  runs Debian's Chromium; prefer amd64 when a render has to look exactly like
  a desktop Chrome session.
- `BROWSER_EXECUTABLE_PATH`, a browser binary to launch instead of a channel.
  Both images link their browser at `/usr/local/bin/harvester-browser` and
  point this at it, so the two architectures start the same way.

## [1.3.0] - 2026-07-26

### Added

- `extraHeaders` on a `/render` body: a string map the page sends with every
  request, so a crawler can bootstrap a JSON endpoint with the right `accept`
  headers. Client-owned headers such as `host` and `content-length` are
  dropped. The headers are applied per page and recorded in `requestHeaders`
  and the `scraper` handoff.
- `API_KEY`. When set, every route except `/health` requires
  `Authorization: Bearer <key>`.
- `ALLOWED_HOSTS`, a comma-separated list of hostnames `/render` may target, so
  the service cannot be used as an open render proxy. Empty allows any host.

### Fixed

- The container now starts. `xvfb-run` waits for Xvfb to signal readiness with
  SIGUSR1, which a PID 1 shell never receives, so the server never started and
  the container stayed unhealthy until the caller remembered `docker run
  --init`. tini now takes PID 1 inside the image.

## [1.2.0] - 2026-07-26

### Added

- Proxy support. `PROXY_SERVER` (with `PROXY_USERNAME`, `PROXY_PASSWORD`, and
  `PROXY_BYPASS`) sends every render, bot check, and TLS probe through a
  proxy, and a `proxy` object on a `/render` body overrides it for that render.
  http, https, socks4, and socks5 are supported.
- Renders report the egress they used as `proxy`, and the `scraper` handoff
  carries the proxy server so a replay leaves from the same exit IP. Proxy
  credentials are never returned.
- The playground has a proxy field on the render form.

### Changed

- Browser contexts are now keyed by origin *and* egress, so a session started
  through one proxy is never continued through another.

## [1.1.1] - 2026-07-25

### Fixed

- The release workflow's post-push smoke test pulled the git tag (`v1.1.0`)
  instead of the image tag (`1.1.0`), which failed the publish job and skipped
  the GitHub release. The v1.1.0 image itself was published correctly.

## [1.1.0] - 2026-07-25

### Added

- Release tooling: `npm run release` bumps the version, rolls this changelog,
  commits, and tags.
- `GET /health` now reports the running `version`.
- Tagged builds publish `ghcr.io/beremaran/harvester` images; `main` publishes
  the `edge` tag.

## [1.0.0] - 2026-07-25

### Added

- Initial public release of the `renderer-worker` render service and its
  Vite/React playground.

[unreleased]: https://github.com/beremaran/harvester/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/beremaran/harvester/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/beremaran/harvester/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/beremaran/harvester/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/beremaran/harvester/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/beremaran/harvester/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/beremaran/harvester/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/beremaran/harvester/releases/tag/v1.0.0
