# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`npm run release -- <patch|minor|major>` folds the **Unreleased** section below
into a new version heading, so keep adding entries there as you merge changes.

## [Unreleased]

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
