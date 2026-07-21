"""In-page localStorage/sessionStorage readers."""

from playwright.async_api import Page

from harvester.browser.timeouts import bounded


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
    return await bounded(page.evaluate(js), default={}, what=f"read {kind}")
