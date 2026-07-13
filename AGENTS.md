# Repository Guidelines

## Project structure

This repository contains a Python FastAPI service for browser capture inside a
trusted compose network. Runtime code is in `app/`: `main.py` owns HTTP routes,
limits, and lifecycle; `harvester.py` owns Playwright and stealth browser
lifecycle, interception, and state capture; `config.py` provides runtime
configuration and `detection.py` provides WAF marker detection. Tests are in
`tests/`, and `docs/` contains scraper integration guidance.

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

## Deployment boundary

This container is intended to be reachable only from its surrounding compose
network. It intentionally does not authenticate callers, restrict target
hosts, or redact captured values. Do not expose it directly to an untrusted
network without adding an appropriate boundary outside the service.

## Changes and tests

Add regression coverage for request interception, configuration, protection
detection, or API contract changes. Keep commits focused with concise
imperative subjects and describe operational implications and verification in
pull requests.
