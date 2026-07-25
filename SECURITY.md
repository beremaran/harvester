# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email
[berke@beremaran.com](mailto:berke@beremaran.com) and include the affected
revision, impact, reproduction steps, and any proposed mitigation. Encrypt or
withhold sensitive details until a secure exchange is agreed.

Security fixes are made on the current `main` branch. This project does not yet
publish versioned security support guarantees.

Use of this software is subject to the
[responsible use](README.md#responsible-use) expectations in the README.

## Deployment boundary

Harvester is designed for a trusted private network. It deliberately:

- accepts arbitrary HTTP(S) target URLs, including private-network targets;
- has no built-in caller authentication, target allowlist, or DNS filtering;
- serves the browser playground from the same port as the API; and
- returns cookies, request headers, response headers, rendered HTML, and
  screenshots without redaction.

The service listens on all interfaces inside its container, and the published
Docker or Compose port is whatever the operator maps. Bind it to loopback, or
put it behind an external layer that provides authentication, authorization,
network restrictions, request limits, and appropriate logging, before exposing
it anywhere untrusted. Treat every successful capture response as potentially
sensitive.

The behaviors above are part of the documented deployment model, not security
vulnerabilities by themselves. Reports showing a bypass of an established
external boundary, an escape from the container, cross-request state leakage,
or unintended disclosure beyond the requested capture are in scope.
