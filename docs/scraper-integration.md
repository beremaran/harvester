# Scraper integration

The service returns a rendered browser result; the scraper decides what to
extract and how to store it.

```python
import requests

CAPTURE_API = "http://localhost:8080"

response = requests.post(
    f"{CAPTURE_API}/v1/capture",
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

Cookies, Web Storage values, and captured headers are returned directly. The
container is designed to be reachable only from the surrounding compose
network; add network-level protection if the service is exposed elsewhere.
