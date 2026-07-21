"""Request/response schemas for the harvester API."""

from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


class ProxyConfig(BaseModel):
    """A proxy the browser routes the target request through.

    ``server`` follows Playwright's format, e.g. ``http://host:port`` or
    ``socks5://host:port``. Credentials, if any, are passed separately so they
    never need to be embedded in the URL.
    """

    server: str = Field(..., description="Proxy URL, e.g. http://host:port or socks5://host:port")
    username: str | None = Field(default=None, description="Proxy username, if authenticated")
    password: str | None = Field(default=None, description="Proxy password, if authenticated")
    bypass: str | None = Field(
        default=None,
        description="Comma-separated hosts that bypass the proxy, e.g. 'localhost,127.0.0.1'",
    )

    @field_validator("server")
    @classmethod
    def _validate_server(cls, v: str) -> str:
        v = v.strip()
        try:
            parsed = urlsplit(v)
        except ValueError as exc:
            raise ValueError("proxy.server must be a valid URL") from exc
        allowed = ("http", "https", "socks5")
        if parsed.scheme not in allowed or not parsed.hostname:
            raise ValueError("proxy.server must use http, https, or socks5")
        if parsed.username or parsed.password:
            raise ValueError("put proxy credentials in username/password fields")
        return v

    def to_playwright(self) -> dict[str, str]:
        proxy: dict[str, str] = {"server": self.server}
        if self.username is not None:
            proxy["username"] = self.username
        if self.password is not None:
            proxy["password"] = self.password
        if self.bypass is not None:
            proxy["bypass"] = self.bypass
        return proxy


class HarvestRequest(BaseModel):
    """Parameters for one authenticated, allowlisted browser capture."""

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "url": "https://example.com/product/123",
                    "wait_until": "networkidle",
                    "timeout_ms": 45000,
                    "extra_wait_ms": 2000,
                    "return_html": True,
                }
            ]
        }
    }

    url: str = Field(
        ...,
        description="Target URL to load and harvest from. Must be http(s) and its host must be in ALLOWED_HOSTS.",
        examples=["https://example.com/product/123"],
    )
    proxy: ProxyConfig | None = Field(default=None, description="Optional proxy configuration")

    return_html: bool = Field(default=False, description="Include the fully rendered HTML in the response")
    include_secrets: bool = Field(
        default=False,
        description="Request cookie/storage/header values when the operator permits it",
    )
    return_screenshot: bool = Field(
        default=False, description="Include a base64-encoded PNG screenshot in the response"
    )

    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = Field(
        default="networkidle",
        description="Playwright navigation wait condition to consider the page loaded",
    )
    timeout_ms: int = Field(
        default=45_000,
        ge=1_000,
        le=180_000,
        description="Navigation timeout in milliseconds",
        examples=[45000],
    )
    wait_for_selector: str | None = Field(
        default=None,
        description="Optional CSS selector to wait for after navigation (useful past a challenge)",
        examples=["#main-content"],
    )
    extra_wait_ms: int = Field(
        default=0,
        ge=0,
        le=120_000,
        description="Extra idle wait after load, giving anti-bot challenges time to resolve",
    )
    challenge_wait_ms: int = Field(
        default=15_000,
        ge=0,
        le=120_000,
        description="Max time to poll for a known anti-bot interstitial to clear",
    )

    user_agent: str | None = Field(
        default=None,
        description="Override the browser User-Agent",
        examples=["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"],
    )
    locale: str = Field(default="en-US", description="Browser locale, e.g. 'en-US'")
    timezone_id: str | None = Field(default=None, description="Browser timezone, e.g. 'America/New_York'")
    viewport_width: int = Field(default=1920, ge=320, le=3840, description="Browser viewport width in pixels")
    viewport_height: int = Field(default=1080, ge=240, le=2160, description="Browser viewport height in pixels")
    extra_headers: dict[str, str] | None = Field(
        default=None,
        description="Additional HTTP headers to send with every request",
        examples=[{"X-Custom-Header": "value"}],
    )

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        v = v.strip()
        try:
            parsed = urlsplit(v)
        except ValueError as exc:
            raise ValueError("url must be a valid absolute URL") from exc
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("url must use http:// or https://")
        if parsed.username or parsed.password:
            raise ValueError("credentials in the target URL are not allowed")
        return v


class Cookie(BaseModel):
    """A single browser cookie as captured after navigation."""

    name: str
    value: str
    domain: str = ""
    path: str = "/"
    expires: float = Field(default=-1, description="Unix timestamp the cookie expires at, or -1 for a session cookie")
    httpOnly: bool = False
    secure: bool = False
    sameSite: str | None = None


class HarvestResponse(BaseModel):
    """Result of a capture: page metadata, redacted browser state, and anti-bot bypass info."""

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "ok": True,
                    "url": "https://example.com/product/123",
                    "final_url": "https://example.com/product/123",
                    "status": 200,
                    "final_status": 200,
                    "title": "Example Product",
                    "cookies": [],
                    "local_storage": {},
                    "session_storage": {},
                    "request_headers": {},
                    "response_headers": {"content-type": "text/html; charset=utf-8"},
                    "scraper_headers": {"User-Agent": "Mozilla/5.0 ..."},
                    "bypass": {},
                    "protection": {"vendor": None},
                    "secrets_included": False,
                    "challenge_detected": False,
                    "challenge_cleared": None,
                    "html": None,
                    "screenshot_b64": None,
                    "elapsed_ms": 1420,
                    "error": None,
                }
            ]
        }
    }

    ok: bool = Field(description="Whether the capture completed successfully")
    url: str = Field(description="The originally requested URL")
    final_url: str | None = Field(default=None, description="URL after redirects, if the page navigated further")
    status: int | None = Field(default=None, description="HTTP status of the initial navigation response")
    final_status: int | None = Field(default=None, description="HTTP status of the final response after redirects")
    title: str | None = Field(default=None, description="Document title of the loaded page")

    cookies: list[dict[str, Any]] = Field(default_factory=list, description="Browser cookies captured after load")
    local_storage: dict[str, str] = Field(default_factory=dict, description="localStorage key/value pairs")
    session_storage: dict[str, str] = Field(default_factory=dict, description="sessionStorage key/value pairs")

    request_headers: dict[str, str] = Field(default_factory=dict, description="Headers sent on the initial request")
    response_headers: dict[str, str] = Field(
        default_factory=dict, description="Headers received on the initial response"
    )
    scraper_headers: dict[str, str] = Field(
        default_factory=dict,
        description="Headers a scraper should replay to mimic this authenticated browser session",
    )
    bypass: dict[str, Any] = Field(default_factory=dict, description="Anti-bot bypass metadata, if any was applied")
    protection: dict[str, Any] = Field(
        default_factory=dict, description="Detected anti-bot/WAF protection on the target, if any"
    )
    secrets_included: bool = Field(
        default=False, description="Whether cookie/storage/header values include actual secret contents"
    )

    challenge_detected: bool = Field(default=False, description="Whether an anti-bot interstitial was encountered")
    challenge_cleared: bool | None = Field(
        default=None, description="Whether the detected challenge cleared before challenge_wait_ms elapsed"
    )

    html: str | None = Field(default=None, description="Fully rendered HTML, present only when return_html was set")
    screenshot_b64: str | None = Field(
        default=None, description="Base64-encoded PNG screenshot, present only when return_screenshot was set"
    )

    elapsed_ms: int = Field(default=0, description="Total time spent servicing the request, in milliseconds")
    error: str | None = Field(default=None, description="Error message, present only when ok is false")


class ErrorResponse(BaseModel):
    """Shape of error responses returned by non-2xx status codes."""

    error: str = Field(description="Human-readable error message", examples=["unauthorized"])
