"""In-page localStorage/sessionStorage readers."""

import logging

from playwright.async_api import Page

logger = logging.getLogger("harvester")


async def read_storage(page: Page, kind: str) -> dict[str, str]:
    js = f"""() => {{
        try {{
            const out = {{}};
            const s = window.{kind};
            for (let i = 0; i < s.length; i++) {{
                const k = s.key(i);
                if (k !== null) out[k] = s.getItem(k);
            }}
            return out;
        }} catch (e) {{ return {{}}; }}
    }}"""
    try:
        return await page.evaluate(js)
    except Exception as exc:
        logger.debug("failed to read %s: %s", kind, exc)
        return {}
