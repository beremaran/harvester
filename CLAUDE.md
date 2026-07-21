# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An internal FastAPI service that loads authorized targets through a real stealth Chromium
(`playwright-stealth`), waits out anti-bot challenges, and returns browser state (cookies,
storage, headers) plus scraper-ready metadata. It is a capture primitive for targets the
operator owns/is authorized to test — not a general scraping framework or anti-bot bypass tool.
Preserve the security boundaries (API-key auth, hostname allowlist, DNS/private-network checks,
redirect/subresource re-validation, secret redaction) in any change; see README.md's
Configuration table for the relevant env vars (`ALLOW_PRIVATE_NETWORKS`, `CAPTURE_SECRET_VALUES`,
`ALLOW_INSECURE_BYPASS_HEADERS`, `ALLOW_CALLER_HEADERS`).

## Everything runs in Docker — there is no host venv

The Playwright browser version is pinned to the image. Do not `pip install`/`uv run` pytest on
the host or expect a local `.venv` to work for running the app or tests.

```bash
make test            # offline suite, no network (builds Dockerfile.test, runs pytest in it)
make test-live        # ALL live fingerprint/anti-bot tests (needs network, opt-in)
make live-<target>    # one live target, e.g. `make live-rebrowser`
make live-list        # list live test names/keywords without running them
make lint             # ruff check + format --check (read-only)
make lint-fix          # ruff --fix + format, writes back to host via bind mount
make build / make run  # build/run the runtime image on :8080
```

Live targets (`make live-<target>`): `sannysoft rebrowser areyouheadless creepjs webgl iphey tls
cloudflare automation`. Forward extra pytest args with `PYTEST_ARGS`, e.g.
`make test-live PYTEST_ARGS=-x`. To run a single test file/node directly:
`docker run --rm --shm-size=1g harvester:test pytest -v tests/test_api.py::test_name`
(build the test image first with `make build-test`).

## Architecture

Request flow: `main.py` (FastAPI routes, auth, capacity limits, lifecycle) →
`harvester.py` (Playwright/stealth browser orchestration for one capture) → `browser/` package
(the actual work, one concern per module):

- `browser/stealth.py` — applies playwright-stealth to a fresh isolated context per request
- `browser/request_guard.py` — intercepts requests/redirects/subresources for re-validation
  against the allowlist and private-network rules (this is the enforcement point, not just
  `security.py`)
- `browser/capture.py` — drives navigation, HTML/screenshot capture
- `browser/challenge.py` — waits out known anti-bot challenge patterns
- `browser/storage.py` — reads cookies/localStorage/sessionStorage
- `browser/redaction.py` — redacts secret values unless the request opts in AND
  `CAPTURE_SECRET_VALUES=true` (dual opt-in — check both sides when touching this path)

Cross-cutting modules:
- `config.py` — env configuration and bypass-header (`BYPASS_HEADERS_JSON`) validation
- `security.py` — URL/DNS/private-network validation used before navigation starts
- `detection.py` — WAF/anti-bot provider fingerprint detection (Cloudflare, Imperva, Akamai,
  DataDome, HUMAN/PerimeterX, Sucuri, AWS WAF, Kasada)
- `models.py` — Pydantic request/response schemas
- `api/auth.py`, `api/capacity.py` — bearer-token auth and concurrency limiting

Two API surfaces share the same underlying `harvester.py` orchestration:
- `POST /harvest` — the native Python API (snake_case request/response fields)
- `POST /v1/capture` — a compatibility layer for an original Node scraper contract; accepts both
  snake_case and camelCase (`includeHtml`, `includeSecrets`, `waitForMs`) and remaps to
  camelCase-ish response fields (`finalUrl`, `storage`, `scraperHeaders`, `secretsIncluded`, etc.)

`scraper_headers`/`scraperHeaders` is a deliberately small replay-oriented header set (`accept`,
`accept-language`, `cache-control`, `pragma`, `referer`, `user-agent`); `cookie` only appears when
secrets are actually enabled for that request.

Error contract: capture failures → 502, invalid request bodies → 422, unauthorized → 401,
oversized bodies → 413, over-capacity → 429.

## Conventions

- Modern Python (3.14+), 4-space indent, type hints, small named functions, explicit validation
  at security boundaries (see `ruff` config in `pyproject.toml` for the enforced lint set,
  including `S` for bandit-style security checks).
- Keep API behavior and configuration changes documented in `README.md`.
- Add regression coverage for URL validation, request interception, redaction, configuration,
  protection detection, or API contract changes — these are the areas most likely to have
  security implications.
