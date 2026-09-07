"""
WhatsAppAdapter: Fast-path adapter for WhatsApp Web messaging workflows.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from playwright.async_api import Page

from browser_state import ActionResult, BrowserArtifact
from adapters.base_adapter import AdapterFallbackException, SiteAdapter

log = logging.getLogger("WhatsAppAdapter")


class WhatsAppAdapter(SiteAdapter):
    name = "WhatsAppAdapter"
    domains = ["web.whatsapp.com"]

    def can_handle(self, task: str, current_url: str, target_site: str | None = None) -> bool:
        if target_site and not self._domain_matches_target(target_site):
            return False
        if self._task_mentions_other_site(task):
            return False
        t = task.lower()
        is_wa = "whatsapp" in t or (target_site and "whatsapp" in target_site.lower())
        return bool(is_wa) and any(k in t for k in ["message", "send", "chat", "contact", "text"])

    async def execute(self, task: str, manager: Any, context: dict[str, Any]) -> ActionResult:
        log.info(f"Executing WhatsApp workflow for task: '{task}'")
        page: Page = await manager.get_active_page()

        recipient = context.get("recipient") or ""
        if not recipient:
            m = re.search(r"(?:to|message)\s+([a-zA-Z0-9\s._]+?)(?:\s+saying|\s+with|$)", task, re.IGNORECASE)
            recipient = m.group(1).strip() if m else ""

        message_text = context.get("message") or ""
        if not message_text:
            m = re.search(r"(?:saying|with text|message)\s+[\"']?([^\"']+)[\"']?", task, re.IGNORECASE)
            message_text = m.group(1).strip() if m else "Hello from DEX"

        try:
            if "web.whatsapp.com" not in page.url:
                await manager.navigation.goto("https://web.whatsapp.com/", wait_until="domcontentloaded")
                await asyncio.sleep(2.0)

            # Check if QR code / phone login is required
            has_qr = await page.evaluate("() => !!document.querySelector('canvas[aria-label*=\"Scan\"], [data-ref]')")
            if has_qr:
                raise AdapterFallbackException("WhatsApp Web requires QR code authentication", {"login_required": True})

            # Search contact
            search_box = page.locator('div[contenteditable="true"][data-tab="3"], [aria-label="Search or start new chat"]').first
            try:
                await search_box.wait_for(state="visible", timeout=15000)
                await search_box.fill(recipient)
                await asyncio.sleep(1.0)
            except Exception as err:
                raise AdapterFallbackException(f"WhatsApp search box not found: {err}")

            # Click chat result
            chat_result = page.locator(f'div[role="listitem"] span[title*="{recipient}"], div[role="listitem"]:has-text("{recipient}")').first
            try:
                await chat_result.wait_for(state="visible", timeout=6000)
                await chat_result.click()
                await asyncio.sleep(0.5)
            except Exception as err:
                raise AdapterFallbackException(f"Contact '{recipient}' not found in WhatsApp chats")

            # Type message
            msg_box = page.locator('footer div[contenteditable="true"][data-tab="10"], footer [aria-label="Type a message"]').first
            try:
                await msg_box.wait_for(state="visible", timeout=6000)
                await msg_box.fill(message_text)
                await msg_box.press("Enter")
                await asyncio.sleep(1.0)
            except Exception as err:
                raise AdapterFallbackException(f"Failed to send message: {err}")

            return ActionResult(
                success=True,
                action="whatsapp_send_message",
                target=recipient,
                details=f"Sent message to {recipient} on WhatsApp Web",
                state_changed=True,
                verification={
                    "passed": True,
                    "checks": [{"check": f"Sent message to {recipient}", "passed": True}],
                },
                data={"recipient": recipient, "message": message_text},
            )
        except AdapterFallbackException:
            raise
        except Exception as err:
            raise AdapterFallbackException(f"WhatsApp adapter error: {err}")
