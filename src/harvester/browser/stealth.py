"""Stealth evasion profile and launch defaults shared across browser sessions."""

import re

from playwright_stealth import Stealth

# The fork adds a notification_permission evasion on top of upstream 2.x,
# closing a headless-only inconsistency: Notification.permission='denied'
# while permissions.query reports 'prompt'. WebGL vendor/renderer are
# overridden here to present a real desktop Chrome/Windows GPU instead of
# headless's SwiftShader software renderer.
stealth = Stealth(
    webgl_vendor_override="Google Inc. (Intel)",
    webgl_renderer_override="ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
)

LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--window-size=1920,1080",
]

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_CHROME_VERSION_RE = re.compile(r"(?:Chrome|HeadlessChrome)/(\d+)")


def client_hints_for_ua(user_agent: str) -> dict[str, str] | None:
    """Derive consistent `sec-ch-ua*` values for a spoofed User-Agent.

    Chromium's own build always advertises the `HeadlessChrome` brand and its
    real platform/mobile-ness in these headers, regardless of the `user_agent`
    context option — that option only rewrites the `User-Agent` string and
    `navigator.userAgent`, not Client Hints. Left alone, this produces a
    UA/Client-Hints mismatch that's a standard headless-detection signal.
    """
    match = _CHROME_VERSION_RE.search(user_agent)
    if not match:
        return None
    major = match.group(1)

    if "Windows" in user_agent:
        platform = "Windows"
    elif "Mac OS X" in user_agent:
        platform = "macOS"
    elif "Android" in user_agent:
        platform = "Android"
    elif "Linux" in user_agent:
        platform = "Linux"
    else:
        return None

    mobile = "?1" if platform == "Android" or "Mobile" in user_agent else "?0"
    return {
        "sec-ch-ua": f'"Not)A;Brand";v="24", "Chromium";v="{major}", "Google Chrome";v="{major}"',
        "sec-ch-ua-mobile": mobile,
        "sec-ch-ua-platform": f'"{platform}"',
    }
