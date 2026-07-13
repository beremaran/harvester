"""Compatibility layer over playwright-stealth.

The package changed its public API between the 1.x line (a ``stealth_async``
coroutine that patches a page) and the 2.x rewrite (a ``Stealth`` class exposing
init-script hooks). We detect what is installed at import time and expose two
stable helpers the rest of the app uses.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from playwright.async_api import Page

logger = logging.getLogger("harvester.stealth")

# Supplemental hardening for surfaces playwright-stealth leaves exposed on modern
# Chromium (empty navigator.plugins, SwiftShader WebGL, permission mismatch).
try:
    _HARDENING_SCRIPT: str | None = (Path(__file__).parent / "stealth_hardening.js").read_text(
        encoding="utf-8"
    )
except OSError as exc:  # noqa: BLE001
    logger.warning("stealth_hardening.js not readable (%s); skipping hardening", exc)
    _HARDENING_SCRIPT = None

_stealth_async: Callable[[Page], Any] | None = None
_stealth_config_cls: Any = None
_stealth_obj: Any = None
_mode = "none"
# 1.x evasions, concatenated into a single init script (see below).
_combined_1x_script: str | None = None

try:
    # 1.x API: from playwright_stealth import stealth_async
    from playwright_stealth import stealth_async as _sa  # type: ignore
    from playwright_stealth import StealthConfig as _SC  # type: ignore

    _stealth_async = _sa
    _stealth_config_cls = _SC
    _mode = "1.x"
except Exception:  # noqa: BLE001
    try:
        # 2.x API: from playwright_stealth import Stealth
        from playwright_stealth import Stealth  # type: ignore

        _stealth_obj = Stealth()
        _mode = "2.x"
    except Exception as exc:  # noqa: BLE001
        logger.warning("playwright-stealth not available (%s); running without stealth", exc)
        _mode = "none"


def _build_1x_script() -> str | None:
    """Concatenate playwright-stealth 1.x's evasions into ONE init script.

    The library's ``stealth_async`` adds each evasion as a *separate*
    ``add_init_script`` call. Playwright wraps every init script in its own
    function scope, but several evasions (navigator.userAgent, .vendor,
    .platform, .languages, webgl.vendor, …) close over a shared ``const opts``
    and the ``utils`` helpers that the first script defines. Injected
    separately, those bindings are out of scope, so the patched getters throw
    ``ReferenceError: opts is not defined`` at read time — e.g. reading
    ``navigator.userAgent`` blows up, which is itself a glaring bot tell.

    Emitting all of them as a single script keeps ``opts``/``utils`` in scope,
    so the evasions actually take effect. None of the 1.x evasions use a
    top-level ``return``, so concatenation is safe.
    """
    if _stealth_config_cls is None:
        return None
    try:
        scripts = list(_stealth_config_cls().enabled_scripts)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not assemble stealth scripts: %s", exc)
        return None
    return "\n".join(scripts)


if _mode == "1.x":
    _combined_1x_script = _build_1x_script()

logger.info("stealth mode: %s", _mode)


def stealth_context_kwargs() -> dict[str, Any]:
    """Extra new_context kwargs the installed stealth version wants, if any."""
    if _mode == "2.x" and _stealth_obj is not None:
        getter = getattr(_stealth_obj, "hook_context_kwargs", None) or getattr(
            _stealth_obj, "context_kwargs", None
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
    if _mode == "1.x":
        try:
            if _combined_1x_script:
                # Single-scope injection so opts/utils resolve (see _build_1x_script).
                await page.add_init_script(_combined_1x_script)
            elif _stealth_async is not None:
                # Fallback: the per-script path (broken opts/utils scope, but
                # better than nothing if StealthConfig is unavailable).
                await _stealth_async(page)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stealth injection failed: %s", exc)
    elif _mode == "2.x" and _stealth_obj is not None:
        # 2.x prefers wrapping the context; as a fallback, inject its init script.
        script = getattr(_stealth_obj, "script_payload", None) or getattr(
            _stealth_obj, "init_script", None
        )
        try:
            if callable(script):
                script = script()
            if isinstance(script, str) and script:
                await page.add_init_script(script)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stealth init-script injection failed: %s", exc)
    # _mode == "none": the library did nothing; the hardening below still runs.

    # Always apply supplemental hardening on top of whatever the library did.
    if _HARDENING_SCRIPT:
        try:
            await page.add_init_script(_HARDENING_SCRIPT)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stealth hardening injection failed: %s", exc)
