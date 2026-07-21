"""URL, DNS, private-network, and proxy validation."""

import asyncio
import ipaddress
import socket
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from harvester.config import Config, host_is_allowed

DNS_RESOLVE_TIMEOUT_S = 5.0


def is_private_address(address: str) -> bool:
    try:
        value = ipaddress.ip_address(address)
    except ValueError:
        return True
    if isinstance(value, ipaddress.IPv6Address) and value.ipv4_mapped:
        return is_private_address(str(value.ipv4_mapped))
    return any(
        (
            value.is_unspecified,
            value.is_loopback,
            value.is_private,
            value.is_link_local,
            value.is_multicast,
            value.is_reserved,
        )
    )


async def _resolve_addresses(hostname: str) -> set[str]:
    try:
        ipaddress.ip_address(hostname)
        return {hostname}
    except ValueError:
        pass

    try:
        records = await asyncio.wait_for(
            asyncio.to_thread(
                socket.getaddrinfo,
                hostname,
                None,
                socket.AF_UNSPEC,
                socket.SOCK_STREAM,
            ),
            timeout=DNS_RESOLVE_TIMEOUT_S,
        )
    except (OSError, TimeoutError) as exc:
        raise ValueError("target hostname could not be resolved") from exc
    return {record[4][0] for record in records}


async def assert_safe_url(raw_url: str, config: Config, *, enforce_boundary: bool = True) -> str:
    try:
        parsed = urlsplit(raw_url)
    except ValueError as exc:
        raise ValueError("url must be a valid absolute URL") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("url must be a valid absolute http or https URL")
    if parsed.username or parsed.password:
        raise ValueError("credentials in the target URL are not allowed")

    hostname = parsed.hostname.lower().removesuffix(".")
    if enforce_boundary and not host_is_allowed(hostname, config.allowed_hosts):
        raise ValueError("target hostname is not allowlisted")
    if enforce_boundary and not config.allow_private_networks:
        addresses = await _resolve_addresses(hostname)
        if not addresses or any(is_private_address(address) for address in addresses):
            raise ValueError("target resolves to a blocked network address")
    return urlunsplit(parsed)


def parse_proxy(proxy: Any) -> dict[str, str] | None:
    if proxy is None:
        return None
    if not isinstance(proxy, dict):
        raise ValueError("proxy must be an object")
    server = proxy.get("server")
    if not isinstance(server, str):
        raise ValueError("proxy.server is required")
    try:
        parsed = urlsplit(server)
    except ValueError as exc:
        raise ValueError("proxy.server must be a valid URL") from exc
    if parsed.scheme not in {"http", "https", "socks5"}:
        raise ValueError("proxy.server must use http, https, or socks5")
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("put proxy credentials in username/password fields")
    result = {"server": urlunsplit(parsed)}
    for key in ("username", "password", "bypass"):
        if proxy.get(key) is not None:
            result[key] = str(proxy[key])
    return result
