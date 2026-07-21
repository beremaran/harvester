"""Bearer-token authorization against the configured API key."""

from fastapi import Request

from harvester.config import Config


def is_authorized(request: Request, config: Config) -> bool:
    return bool(config.api_key) and request.headers.get("authorization") == f"Bearer {config.api_key}"
