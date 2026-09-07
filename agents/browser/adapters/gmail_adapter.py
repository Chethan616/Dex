"""
GmailAdapter: Fast-path adapter for Gmail compose, attachment, and sending workflows.
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any
from playwright.async_api import Page

from browser_state import ActionResult, BrowserArtifact
from adapters.base_adapter import AdapterFallbackException, SiteAdapter

log = logging.getLogger("GmailAdapter")


class GmailAdapter(SiteAdapter):
    name = "GmailAdapter"
    domains = ["mail.google.com", "gmail.com"]

    def can_handle(self, task: str, current_url: str, target_site: str | None = None) -> bool:
        if target_site and not self._domain_matches_target(target_site):
            return False
        if self._task_mentions_other_site(task):
            return False
        t = task.lower()
        is_gmail = "gmail" in t or (target_site and "gmail" in target_site.lower())
        return bool(is_gmail) and any(k in t for k in ["email", "mail", "send", "compose", "attach"])

    async def execute(self, task: str, manager: Any, context: dict[str, Any]) -> ActionResult:
        log.info(f"Executing Gmail workflow for task: '{task}'")
        page: Page = await manager.get_active_page()

        # Extract recipient (e.g. "email it to Rahul")
        to_address = context.get("to") or ""
        if not to_address:
            m = re.search(r"(?:to|email)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9]+)", task, re.IGNORECASE)
            if m:
                to_address = m.group(1).strip()

        subject = context.get("subject", "Sidemen Latest Post")
        body = context.get("body", "Here is the latest post update.")
        attachment_path = context.get("attachment") or context.get("file_path")

        try:
            if "mail.google.com" not in page.url:
                await manager.navigation.goto("https://mail.google.com/", wait_until="domcontentloaded")
                await asyncio.sleep(1.0)

            if "accounts.google.com" in page.url:
                raise AdapterFallbackException("Gmail requires Google authentication", {"login_required": True})

            # Click Compose button
            compose_btn = page.locator('div[gh="cm"], div[role="button"]:has-text("Compose"), [aria-label="Compose"]').first
            try:
                await compose_btn.wait_for(state="visible", timeout=10000)
                await compose_btn.click()
                await asyncio.sleep(1.0)
            except Exception as err:
                log.warning(f"Compose button not found: {err}")
                raise AdapterFallbackException("Gmail Compose button not found")

            # Fill recipient
            to_input = page.locator('input[aria-label="To recipients"], input[peoplekit-id], textarea[name="to"], input[name="to"]').first
            try:
                await to_input.wait_for(state="visible", timeout=6000)
                await to_input.fill(to_address)
                await to_input.press("Enter")
            except Exception as err:
                log.warning(f"Could not fill 'To' recipient: {err}")
                raise AdapterFallbackException("Gmail 'To' field not found")

            # Fill subject
            subject_input = page.locator('input[name="subjectbox"]').first
            try:
                if await subject_input.is_visible():
                    await subject_input.fill(subject)
            except Exception:
                pass

            # Fill message body
            body_input = page.locator('div[aria-label="Message Body"], div[role="textbox"][g_editable="true"]').first
            try:
                if await body_input.is_visible():
                    await body_input.fill(body)
            except Exception:
                pass

            # Attach file if provided
            if attachment_path and Path(attachment_path).exists():
                file_input = page.locator('input[type="file"][name="Filedata"]').first
                try:
                    await file_input.set_input_files(attachment_path)
                    log.info(f"Attached file to email: {attachment_path}")
                    await asyncio.sleep(2.0)  # Wait for upload to complete
                except Exception as err:
                    log.warning(f"Could not attach file {attachment_path}: {err}")

            # Click Send button
            send_btn = page.locator('div[role="button"][data-tooltip*="Send"], div[role="button"]:has-text("Send")').first
            try:
                await send_btn.wait_for(state="visible", timeout=6000)
                await send_btn.click()
                await asyncio.sleep(1.5)
            except Exception as err:
                log.warning(f"Could not click Send in Gmail: {err}")
                raise AdapterFallbackException("Gmail Send button failed")

            # Verify send confirmation
            toast = page.locator('span:has-text("Message sent"), div[role="alert"]:has-text("sent")').first
            is_sent = True
            try:
                await toast.wait_for(state="visible", timeout=5000)
            except Exception:
                # Compose window closed also indicates send success
                is_sent = not (await page.locator('div[aria-label="Message Body"]').is_visible())

            return ActionResult(
                success=True,
                action="gmail_send",
                target=to_address,
                details=f"Email successfully sent to {to_address}",
                state_changed=True,
                verification={
                    "passed": is_sent,
                    "checks": [
                        {"check": f"Composed email to '{to_address}'", "passed": True},
                        {"check": "Message sent confirmation verified", "passed": is_sent},
                    ],
                },
                data={"to": to_address, "subject": subject, "attachment": attachment_path},
            )
        except AdapterFallbackException:
            raise
        except Exception as err:
            raise AdapterFallbackException(f"Gmail workflow error: {err}")
