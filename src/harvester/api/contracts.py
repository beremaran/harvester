"""Response payload shaping for the legacy Node-service scraper contract."""

from typing import Any

from harvester.models import HarvestResponse


def to_capture_payload(result: HarvestResponse) -> dict[str, Any]:
    """Return the original Node service's camelCase scraper contract."""
    payload: dict[str, Any] = {
        "finalUrl": result.final_url,
        "status": result.status,
        "finalStatus": result.final_status,
        "title": result.title,
        "cookies": result.cookies,
        "storage": {
            "localStorage": result.local_storage,
            "sessionStorage": result.session_storage,
        },
        "requestHeaders": result.request_headers,
        "responseHeaders": result.response_headers,
        "scraperHeaders": result.scraper_headers,
        "bypass": result.bypass,
        "protection": result.protection,
        "secretsIncluded": result.secrets_included,
        "ok": result.ok,
    }
    if result.html is not None:
        payload["html"] = result.html
    if result.screenshot_b64 is not None:
        payload["screenshotB64"] = result.screenshot_b64
    if result.error is not None:
        payload["error"] = result.error
    return payload
