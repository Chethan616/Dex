"""
Inspector: Smart page and accessibility inspection for DEX Browser Automation.

Extracts compact, actionable representations of pages with temporary element references (e1, e2, e3...)
so the agent and LLM can interact semantically without massive DOM dumps.
"""
from __future__ import annotations

import logging
from typing import Any
from playwright.async_api import CDPSession, Page

from browser_state import ElementInfo

log = logging.getLogger("Inspector")

INSPECTION_SCRIPT = """
(() => {
    const results = [];
    let counter = 1;

    // Clean previous dex markers
    document.querySelectorAll('[data-dex-id]').forEach(el => el.removeAttribute('data-dex-id'));

    const interactiveSelectors = [
        'button',
        'a[href]',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const candidates = Array.from(document.querySelectorAll(interactiveSelectors));

    for (const el of candidates) {
        // Skip hidden elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            continue;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            continue;
        }

        // Element is within or near reasonable view
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag);
        
        // Compute accessible name: aria-label -> aria-labelledby -> title -> placeholder -> innerText/textContent -> value
        let name = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
        if (!name && el.getAttribute('aria-labelledby')) {
            const labelEl = document.getElementById(el.getAttribute('aria-labelledby'));
            if (labelEl) name = labelEl.innerText;
        }
        if (!name && (tag === 'button' || tag === 'a' || role === 'button' || role === 'link' || role === 'tab')) {
            name = el.innerText || el.textContent || '';
        }
        if (!name && tag === 'input' && (el.type === 'button' || el.type === 'submit')) {
            name = el.value || '';
        }

        name = (name || '').replace(/\\s+/g, ' ').trim().slice(0, 100);

        // Deduce surrounding context (e.g. section header, parent article aria-label, form label)
        let context = '';
        const parentArticle = el.closest('article, form, nav, section, [role="dialog"], [role="region"]');
        if (parentArticle) {
            context = parentArticle.getAttribute('aria-label') || parentArticle.getAttribute('title') || '';
            if (!context && parentArticle.querySelector('h1, h2, h3, h4')) {
                context = parentArticle.querySelector('h1, h2, h3, h4').innerText.trim().slice(0, 60);
            }
        }

        const id = 'e' + (counter++);
        el.setAttribute('data-dex-id', id);

        const is_disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
        const is_checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
        const value = el.value !== undefined ? String(el.value).slice(0, 50) : '';

        results.push({
            id: id,
            tag: tag,
            role: role,
            name: name,
            selector: `[data-dex-id="${id}"]`,
            bbox: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            is_visible: true,
            is_enabled: !is_disabled,
            is_checked: is_checked,
            value: value,
            context: context.trim()
        });

        if (counter > 150) break; // Keep representation compact and bounded
    }

    return results;
})()
"""


class Inspector:
    def __init__(self, page_getter):
        self._get_page = page_getter
        self._cached_elements: dict[str, ElementInfo] = {}
        self._cached_url: str = ""

    async def inspect(self, force_refresh: bool = False) -> list[ElementInfo]:
        """
        Inspects the active page and extracts interactive elements with IDs (e1, e2...).
        """
        page: Page = await self._get_page()
        current_url = page.url

        if not force_refresh and current_url == self._cached_url and self._cached_elements:
            return list(self._cached_elements.values())

        try:
            raw_elements = await page.evaluate(INSPECTION_SCRIPT)
        except Exception as err:
            log.warning(f"Inspection script evaluation error: {err}")
            return []

        self._cached_elements.clear()
        self._cached_url = current_url

        elements: list[ElementInfo] = []
        for raw in raw_elements:
            info = ElementInfo(
                id=raw["id"],
                tag=raw["tag"],
                role=raw["role"],
                name=raw["name"],
                selector=raw["selector"],
                bbox=raw["bbox"],
                is_visible=raw["is_visible"],
                is_enabled=raw["is_enabled"],
                is_checked=raw["is_checked"],
                value=raw.get("value", ""),
                context=raw.get("context", ""),
            )
            self._cached_elements[info.id] = info
            elements.append(info)

        log.info(f"Inspected page at {current_url}: found {len(elements)} interactive elements.")
        return elements

    def get_element(self, element_id: str) -> ElementInfo | None:
        """Retrieve cached element by ID (e.g. 'e1')."""
        return self._cached_elements.get(element_id)

    async def resolve_target(self, target: str) -> str:
        """
        Resolves a target parameter (e.g. 'e3', '#submit', 'Share', 'button:has-text("Send")')
        into a concrete Playwright selector.
        """
        target = target.strip()
        if target.startswith("e") and target[1:].isdigit():
            # Ephemeral element reference
            cached = self.get_element(target)
            if cached:
                return cached.selector
            # Element not in cache, try selector directly
            return f'[data-dex-id="{target}"]'

        # Already a selector
        if target.startswith(("/", "#", ".", "[", "xpath=")) or any(c in target for c in " >:"):
            return target

        # Treat as visible text search
        return f'text="{target}"'

    async def get_compact_text(self) -> str:
        """
        Produces a compact text representation for LLM context.
        Example:
        BUTTON [e1] "Share"
        INPUT [e2] "Search" (value: "")
        """
        elements = await self.inspect()
        lines: list[str] = []

        for el in elements:
            state_parts: list[str] = []
            if not el.is_enabled:
                state_parts.append("disabled")
            if el.is_checked:
                state_parts.append("checked")
            if el.value:
                state_parts.append(f'value="{el.value}"')
            state_str = f" ({', '.join(state_parts)})" if state_parts else ""
            ctx_str = f" [Context: {el.context}]" if el.context else ""

            name_str = f'"{el.name}"' if el.name else f"<{el.tag}>"
            lines.append(f"{el.role.upper()} [{el.id}] {name_str}{state_str}{ctx_str}")

        return "\n".join(lines)

    async def get_accessibility_tree(self) -> dict[str, Any]:
        """Low-level accessibility tree via CDP."""
        page: Page = await self._get_page()
        try:
            cdp: CDPSession = await page.context.new_cdp_session(page)
            tree = await cdp.send("Accessibility.getFullAXTree")
            await cdp.detach()
            return tree
        except Exception as err:
            log.warning(f"CDP Accessibility extraction failed: {err}")
            return {"nodes": []}

    async def extract(self, selector: str | None) -> dict[str, Any]:
        """
        Text (and href, if present) for one element resolved from `selector`
        (an ephemeral e1/e2 id, a CSS selector, or visible text), or the whole
        page's visible text when no selector is given.
        """
        if not selector:
            return {"text": await self.get_visible_text(), "selector": None}

        page: Page = await self._get_page()
        resolved = await self.resolve_target(selector)
        try:
            locator = page.locator(resolved).first
            text = (await locator.inner_text()).strip()
            href = await locator.get_attribute("href")
            return {"text": text, "href": href, "selector": resolved}
        except Exception as err:
            log.warning(f"extract failed for selector '{selector}' ({resolved}): {err}")
            return {"text": "", "href": None, "selector": resolved, "error": str(err)}

    async def extract_table(self, which: int = 0) -> dict[str, Any]:
        """The `which`-th <table> on the page, as {headers, rows}."""
        page: Page = await self._get_page()
        js = """(idx) => {
            const tables = document.querySelectorAll('table');
            const table = tables[idx];
            if (!table) return null;
            const headerCells = table.querySelectorAll('thead th, tr:first-child th');
            const headers = Array.from(headerCells).map(c => c.innerText.trim());
            const bodyRows = table.querySelectorAll('tbody tr, tr');
            const rows = [];
            for (const row of bodyRows) {
                const cells = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
                if (cells.length) rows.push(cells);
            }
            return { headers, rows };
        }"""
        try:
            result = await page.evaluate(js, which)
        except Exception as err:
            log.warning(f"extract_table failed for table {which}: {err}")
            return {"headers": [], "rows": [], "error": str(err)}
        if result is None:
            return {"headers": [], "rows": [], "error": f"No table at index {which}"}
        return result

    async def get_visible_text(self) -> str:
        """Extracts readable text content from the page body."""
        page: Page = await self._get_page()
        try:
            text = await page.evaluate("() => document.body ? document.body.innerText : ''")
            return text.strip()
        except Exception as e:
            return f"Error extracting page text: {e}"
