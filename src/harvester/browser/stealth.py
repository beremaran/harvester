"""Stealth evasion profile and launch defaults shared across browser sessions."""

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
