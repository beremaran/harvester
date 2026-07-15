# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email
[berke@beremaran.com](mailto:berke@beremaran.com) and include the affected
revision, impact, reproduction steps, and any proposed mitigation. Encrypt or
withhold sensitive details until a secure exchange is agreed.

Security fixes are made on the current `main` branch. This project does not yet
publish versioned security support guarantees.

## Deployment boundary

Harvester is designed for a trusted Compose network. It deliberately:

- accepts arbitrary HTTP(S) target URLs, including private-network targets;
- has no built-in caller authentication, target allowlist, or DNS filtering;
- ignores target HTTPS certificate errors; and
- returns cookies, Web Storage, request headers, response headers, rendered
  HTML, and screenshots without redaction.

Compose publishes the API on `127.0.0.1` by default. Do not bind it to a public
or untrusted interface without an external layer that provides authentication,
authorization, network restrictions, request limits, and appropriate logging.
Treat every successful capture response as potentially sensitive.

The behaviors above are part of the documented deployment model, not security
vulnerabilities by themselves. Reports showing a bypass of an established
external boundary, an escape from the container, cross-request state leakage,
or unintended disclosure beyond the requested capture are in scope.
