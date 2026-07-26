# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`npm run release -- <patch|minor|major>` folds the **Unreleased** section below
into a new version heading, so keep adding entries there as you merge changes.

## [Unreleased]

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

[unreleased]: https://github.com/beremaran/harvester/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/beremaran/harvester/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/beremaran/harvester/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/beremaran/harvester/releases/tag/v1.0.0
