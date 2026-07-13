# Scraper integration

The service returns a rendered browser result; the scraper decides what to
extract and how to store it.

```python
import os
import requests

CAPTURE_API = os.environ.get("CAPTURE_API", "http://localhost:8080")

response = requests.post(
    f"{CAPTURE_API}/v1/capture",
    headers={"Authorization": f"Bearer {os.environ['API_KEY']}"},
    json={"url": "https://example.com/", "includeHtml": True},
    timeout=60,
)
response.raise_for_status()
result = response.json()

if result["protection"]["challengeDetected"] or result["protection"]["blockingResponse"]:
    raise RuntimeError("target was challenged or blocked")

html = result.get("html", "")
headers = result["scraperHeaders"]
```

`scraperHeaders` contains common browser headers and includes `cookie` only
when both `includeSecrets: true` and `CAPTURE_SECRET_VALUES=true` are active.
Cookie and Web Storage values are otherwise `[REDACTED]`. WAF bypass values are
never returned.

The original Python endpoint, `POST /harvest`, returns the same information in
snake_case and also supports screenshots and challenge-specific controls. Both
capture endpoints require the API key. Keep the service private and configure
`ALLOWED_HOSTS` narrowly; the browser re-checks every navigation, redirect, and
HTTP(S) subresource against that boundary.
