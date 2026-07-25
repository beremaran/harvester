# Contributing

Thanks for helping improve Harvester.

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md), and contributions are held to the
[responsible use](README.md#responsible-use) expectations that apply to running
it.

## Before opening a change

- Use an issue for substantial behavior or API changes so the approach can be
  discussed first.
- Keep the service's trust boundary in mind. It intentionally accepts arbitrary
  HTTP(S) targets and returns captured browser state, so it must remain private
  to a trusted network unless an external security boundary is added.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md).
- Use non-sensitive targets in issues, tests, and fixtures. Requests to defeat a
  named site's defences, and any captured credentials or session material, do
  not belong in this tracker.

## Development workflow

The service is Node.js and TypeScript. Install dependencies and run the API
together with the Vite playground:

```sh
npm install
npm run dev
```

Before opening a pull request, run the same checks CI runs:

```sh
npm run check   # typechecks the server and the playground
npm test        # domain, use-case, config, and HTTP tests
npm run build   # server to dist/, playground to web-dist/
```

These tests never launch a browser, so they run on the host. Anything that
actually renders a page belongs in the container, because the Chrome version is
tied to the image:

```sh
docker build -t renderer-worker .
docker run --rm --platform linux/amd64 -p 8082:8082 \
  --init --shm-size=1gb renderer-worker
```

Add regression coverage for changes to rendering, configuration, blocking
assessment, the scraper handoff, or the API contract. Respect the
ports-and-adapters boundaries described in `README.md`: `src/domain` stays pure,
`src/application` depends only on its ports, and only `src/server.ts` wires
concrete adapters. The TypeScript config is strict, server code is ESM, so
relative imports carry `.js` extensions.

## Pull requests

Keep pull requests focused. Explain:

- what changed and why;
- any API, configuration, security, or operational impact; and
- the exact verification commands you ran.

Update `README.md` when public behavior or configuration changes. By
contributing, you agree that your contribution is licensed under this
repository's [MIT License](LICENSE).
