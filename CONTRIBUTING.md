# Contributing

Thanks for helping improve Harvester.

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening a change

- Use an issue for substantial behavior or API changes so the approach can be
  discussed first.
- Keep the service's trust boundary in mind. It intentionally accepts arbitrary
  HTTP(S) targets and returns captured browser state, so it must remain private
  to a trusted network unless an external security boundary is added.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Development workflow

The Playwright browser version is tied to the Docker image. Use the pinned
container workflow instead of a host Python environment:

```sh
docker build --target test -t harvester:test .
docker run --rm --shm-size=1g harvester:test pytest -v tests
```

The same offline suite is available as `make test`. Live fingerprinting tests
are opt-in because they contact public services:

```sh
make test-live
```

Add regression coverage for changes to request interception, configuration,
protection detection, or the API contract. Use modern Python, four-space
indentation, type hints, small named functions, and explicit validation at
security boundaries.

## Pull requests

Keep pull requests focused. Explain:

- what changed and why;
- any API, configuration, security, or operational impact; and
- the exact verification commands you ran.

Update `README.md` when public behavior or configuration changes. By
contributing, you agree that your contribution is licensed under this
repository's [MIT License](LICENSE).
