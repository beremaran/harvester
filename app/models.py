"""Request/response schemas for the harvester API."""
from __future__ import annotations

from typing import Any, Literal

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
        if not v:
            raise ValueError("proxy.server must not be empty")
        allowed = ("http://", "https://", "socks5://", "socks4://")
        if not v.startswith(allowed):
            raise ValueError(f"proxy.server must start with one of {allowed}")
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
    url: str = Field(..., description="Target URL to load and harvest from")
    proxy: ProxyConfig | None = Field(default=None, description="Optional proxy configuration")

    return_html: bool = Field(default=False, description="Include the fully rendered HTML in the response")
    return_screenshot: bool = Field(
        default=False, description="Include a base64-encoded PNG screenshot in the response"
    )

    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = Field(
        default="networkidle",
        description="Playwright navigation wait condition",
    )
    timeout_ms: int = Field(
        default=45_000, ge=1_000, le=180_000, description="Navigation timeout in milliseconds"
    )
    wait_for_selector: str | None = Field(
        default=None,
        description="Optional CSS selector to wait for after navigation (useful past a challenge)",
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

    user_agent: str | None = Field(default=None, description="Override the browser User-Agent")
    locale: str = Field(default="en-US", description="Browser locale")
    timezone_id: str | None = Field(default=None, description="Browser timezone, e.g. 'America/New_York'")
    viewport_width: int = Field(default=1920, ge=320, le=3840)
    viewport_height: int = Field(default=1080, ge=240, le=2160)
    extra_headers: dict[str, str] | None = Field(
        default=None, description="Additional HTTP headers to send with every request"
    )

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        v = v.strip()
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("url must start with http:// or https://")
        return v


class Cookie(BaseModel):
    name: str
    value: str
    domain: str = ""
    path: str = "/"
    expires: float = -1
    httpOnly: bool = False
    secure: bool = False
    sameSite: str | None = None


class HarvestResponse(BaseModel):
    ok: bool
    url: str
    final_url: str | None = None
    status: int | None = None
    title: str | None = None

    cookies: list[dict[str, Any]] = Field(default_factory=list)
    local_storage: dict[str, str] = Field(default_factory=dict)
    session_storage: dict[str, str] = Field(default_factory=dict)

    challenge_detected: bool = False
    challenge_cleared: bool | None = None

    html: str | None = None
    screenshot_b64: str | None = None

    elapsed_ms: int = 0
    error: str | None = None
