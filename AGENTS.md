# Repository Guidelines

## Project structure

This repository contains a Python FastAPI service for authorized browser
capture. Runtime code is in `src/harvester/`: `main.py` owns HTTP routes,
authentication, limits, and lifecycle; `harvester.py` owns Playwright and
stealth browser lifecycle, delegating to `browser/` for interception, state
capture, challenge waiting, and redaction; `config.py`, `security.py`, and
`detection.py` provide configuration, URL/network validation, and WAF marker
detection; `api/` holds auth, capacity limiting, and request/response
contracts. Tests are in `tests/`, and `docs/` contains scraper integration
guidance.

## Development

Use the pinned Docker workflow because the Playwright browser version is tied to
the image:

```sh
docker build --target test -t harvester:test .
docker run --rm --shm-size=1g harvester:test pytest -v tests
```

`make test` wraps the same offline suite. `make test-live` is opt-in and reaches
public fingerprinting targets.

Use modern Python, four-space indentation, type hints, small named functions,
and explicit validation at security boundaries. Keep API behavior and
configuration documented in `README.md`.

## Security

This is an internal authorized-testing component. Preserve API-key
authentication, the hostname allowlist, DNS/private-network checks, redirect
and subresource re-validation, and secret redaction. Keep
`ALLOW_PRIVATE_NETWORKS`, `CAPTURE_SECRET_VALUES`,
`ALLOW_INSECURE_BYPASS_HEADERS`, and `ALLOW_CALLER_HEADERS` disabled unless an
isolated test setup requires them. Never commit API keys, bypass-header values,
or captured secrets.

## Changes and tests

Add regression coverage for URL validation, request interception, redaction,
configuration, protection detection, or API contract changes. Keep commits
focused with concise imperative subjects and describe security implications and
verification in pull requests.
