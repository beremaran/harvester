"""Thin wrapper over playwright-stealth 2.x.

Supplements the library with hardening for surfaces it leaves exposed on
modern Chromium (empty navigator.plugins, SwiftShader WebGL, permission
mismatch).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from playwright.async_api import Page
from playwright_stealth import Stealth

logger = logging.getLogger("harvester.stealth")

try:
    _HARDENING_SCRIPT: str | None = (Path(__file__).parent / "stealth_hardening.js").read_text(
        encoding="utf-8"
    )
except OSError as exc:  # noqa: BLE001
    logger.warning("stealth_hardening.js not readable (%s); skipping hardening", exc)
    _HARDENING_SCRIPT = None

_stealth = Stealth()


def stealth_context_kwargs() -> dict[str, Any]:
    """Extra new_context kwargs playwright-stealth wants."""
    getter = getattr(_stealth, "hook_context_kwargs", None) or getattr(
        _stealth, "context_kwargs", None
    )
    if callable(getter):
        try:
            return dict(getter())
        except Exception:  # noqa: BLE001
            return {}
    if isinstance(getter, dict):
        return dict(getter)
    return {}


async def apply_stealth(page: Page) -> None:
    """Apply stealth evasions to a freshly created page."""
    script = getattr(_stealth, "script_payload", None) or getattr(_stealth, "init_script", None)
    try:
        if callable(script):
            script = script()
        if isinstance(script, str) and script:
            await page.add_init_script(script)
    except Exception as exc:  # noqa: BLE001
        logger.warning("stealth init-script injection failed: %s", exc)

    if _HARDENING_SCRIPT:
        try:
            await page.add_init_script(_HARDENING_SCRIPT)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stealth hardening injection failed: %s", exc)
