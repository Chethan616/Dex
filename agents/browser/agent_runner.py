"""
AgentRunner: Autonomous web task coordinator implementing the 5-tier architecture.

Execution Priority (STRICTLY enforced):
1. Deterministic browser operations whenever possible
2. Site-specific adapters as fast paths (falling back to generic on unexpected UI)
3. LLM reasoning for planning, ambiguity resolution, and recovery
4. Accessibility / DOM inspection with temporary element references (e1, e2...)
5. Screenshot / vision + mouse/keyboard as fallback

NEVER make an LLM call for an operation that can be performed deterministically.

Adapters are NEVER hard dependencies. If an adapter raises AdapterFallbackException
(e.g. due to UI change), AgentRunner seamlessly continues with the generic loop.

Every meaningful browser result is registered as a BrowserArtifact for cross-turn
and cross-application reference resolution ("that post", "it", "the downloaded image").

Supports both:
  A) Multi-turn conversational artifact chaining
  B) Single complex cross-application plans with dependency tracking
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

from adapters.base_adapter import AdapterFallbackException
from adapters.registry import AdapterRegistry
from browser_state import ActionResult, BrowserArtifact, Target, WebTask
from site_knowledge import detect_site
from verification import RiskLevel, classify_action_risk, log_verification_step

log = logging.getLogger("AgentRunner")

# Maximum LLM calls per task to prevent runaway token usage.
MAX_LLM_CALLS_PER_TASK = 20

# Heuristic determinism confidence: if we are >=this certain, skip LLM entirely.
HEURISTIC_CONFIDENCE_THRESHOLD = 0.75

# Consecutive reasoning-provider failures (not bad decisions — failures to
# decide at all) before the loop gives up rather than continuing to scroll
# blindly for the rest of the step budget.
MAX_CONSECUTIVE_LLM_FAILURES = 3

# Same action, same target, same URL, no state change, this many times in a
# row: the loop is stuck, not making progress toward the task.
STUCK_REPEAT_THRESHOLD = 4


class TaskCheckpoint:
    """
    Persists intermediate state for a running task so it can be resumed
    after failures, handoffs, or application switches.
    """

    def __init__(self, task: str):
        self.task = task
        self.started_at = time.time()
        self.steps: list[dict[str, Any]] = []
        self.artifacts: list[dict[str, Any]] = []
        self.sub_tasks: list[dict[str, Any]] = []  # for multi-step plans
        self.current_sub_task_idx: int = 0
        self.completed = False
        self.llm_calls = 0
        # Consecutive LLM decision failures (parse/API errors, not "the model
        # chose badly") and the most recent one's message — see
        # AgentRunner._llm_decide. Distinct from a bad-but-real decision:
        # this is the provider or the response itself failing, and the two
        # must not be collapsed into the same silent "scroll and hope" path.
        self.consecutive_llm_failures = 0
        self.last_llm_error = ""

    def record_step(self, step: dict[str, Any]) -> None:
        self.steps.append(step)

    def record_artifact(self, artifact: BrowserArtifact) -> None:
        self.artifacts.append(artifact.to_dict())

    def to_context(self) -> dict[str, Any]:
        """Serializes checkpoint into context dict for LLM/adapter calls."""
        return {
            "task": self.task,
            "steps_taken": len(self.steps),
            "artifacts": self.artifacts[-10:],
            "sub_tasks": self.sub_tasks,
            "current_sub_task_idx": self.current_sub_task_idx,
            "elapsed_seconds": round(time.time() - self.started_at, 1),
        }


class AgentRunner:
    def __init__(self, browser_manager: Any, adapter_registry: AdapterRegistry | None = None):
        self.manager = browser_manager
        self.adapters = adapter_registry or AdapterRegistry()
        self._llm: Any = None  # Lazy-loaded ChatClaudeCode

    def _get_llm(self, mode: str = "smart") -> Any:
        """Lazy-loads the LLM client. Only instantiated when Tier 3 is actually needed."""
        if self._llm is None:
            try:
                provider = _configured_browser_provider()
                if provider == "groq":
                    from groq_llm import ChatGroq
                    self._llm = ChatGroq(mode=mode)
                elif provider == "claude-code":
                    from claude_code_llm import ChatClaudeCode
                    self._llm = ChatClaudeCode(mode=mode)
                else:
                    log.warning(
                        "No browser LLM provider is configured; Tier 3 will be skipped. "
                        "Set DEX_BRAIN_PROVIDER=groq or select a provider in DEX Settings."
                    )
                    return None
                log.info(f"Tier 3 LLM initialized: {self._llm.name}")
            except Exception as e:
                log.warning(f"LLM unavailable (Tier 3 will be skipped): {e}")
        return self._llm

    async def run_task(
        self,
        task: str,
        start_url: str | None = None,
        max_steps: int = 25,
        context: dict[str, Any] | None = None,
        task_id: str | None = None,
        step_id: str | None = None,
        target_site: str | None = None,
        expected_url: str | None = None,
        expected_entity: str | None = None,
    ) -> dict[str, Any]:
        """
        Public entry point. Delegates to `_run_task_impl` and stamps the
        current session id onto whichever return dict comes back, so the
        handoff-resume protocol (browser_agent.ts reads `response.session_id`
        to drive /resume and /abandon) always has it — regardless of which of
        the many internal early-return branches produced the result.
        """
        result = await self._run_task_impl(
            task,
            start_url=start_url,
            max_steps=max_steps,
            context=context,
            task_id=task_id,
            step_id=step_id,
            target_site=target_site,
            expected_url=expected_url,
            expected_entity=expected_entity,
        )
        result["session_id"] = self.manager.session.session_id
        return result

    async def _run_task_impl(
        self,
        task: str,
        start_url: str | None = None,
        max_steps: int = 25,
        context: dict[str, Any] | None = None,
        task_id: str | None = None,
        step_id: str | None = None,
        target_site: str | None = None,
        expected_url: str | None = None,
        expected_entity: str | None = None,
    ) -> dict[str, Any]:
        """
        Executes an autonomous browsing task using the 5-tier architecture.

        Args:
            task: The user-facing task description.
            start_url: Optional URL to navigate to before execution.
            max_steps: Maximum generic loop iterations.
            context: Additional key-value context.
            task_id: Unique ID for this top-level request. Used for artifact scoping
                     and cross-task contamination prevention.
            step_id: Sub-step ID within a multi-step plan.
            target_site: Explicit target domain (e.g. 'youtube.com', 'instagram.com').
                         When set, only adapters for this domain are allowed to run.
            expected_url: Full expected URL for hard post-execution URL matching.
            expected_entity: Expected entity name (e.g. channel name, account handle).

        Returns a structured result including:
        - success: bool
        - result: summary string
        - artifacts: list of BrowserArtifact dicts (posts, files, pages) for THIS task only
        - downloads: list of downloaded file dicts
        - steps: execution trace
        - verification: proof of task completion
        - checkpoint: serialized state for resumption
        """
        ctx = dict(context or {})
        checkpoint = TaskCheckpoint(task)
        visited_urls: list[str] = []
        downloads: list[dict[str, Any]] = []

        # Derive task_id if not provided (use a per-call unique default).
        import uuid
        effective_task_id = task_id or str(uuid.uuid4())[:12]
        effective_step_id = step_id or ""

        # Bind task context to manager so artifacts get stamped correctly.
        self.manager.set_current_task(effective_task_id, effective_step_id)

        # Pass identity into context so adapters can include it in their artifacts.
        ctx["task_id"] = effective_task_id
        ctx["request_id"] = ctx.get("request_id") or effective_task_id
        ctx["step_id"] = effective_step_id
        ctx["target_site"] = target_site
        ctx["expected_url"] = expected_url
        ctx["expected_entity"] = expected_entity

        # One typed object carrying task identity/target, alongside (not
        # replacing) the existing loose kwargs and ctx dict above — see
        # browser_state.WebTask. Exposed on ctx so any helper down the call
        # chain can read structured target info instead of re-deriving it.
        web_task = WebTask(
            description=task,
            task_id=effective_task_id,
            step_id=effective_step_id,
            request_id=ctx["request_id"],
            start_url=start_url,
            max_steps=max_steps,
            session_id=self.manager.session.session_id,
            confirmed=bool(ctx.get("confirmed", False)),
            target=Target(
                site_id=target_site,
                expected_url=expected_url,
                expected_entity=expected_entity,
            ),
            context=dict(ctx),  # a snapshot, not the live dict — avoids a
                                 # ctx -> web_task -> context -> ctx cycle.
        )
        ctx["web_task"] = web_task

        # Structured task log header (Requirement 14)
        log.info(
            f"\n{'='*60}\n"
            f"TASK_ID:      {effective_task_id}\n"
            f"STEP_ID:      {effective_step_id or '(none)'}\n"
            f"REQUEST:      {task[:120]}\n"
            f"TARGET_SITE:  {target_site or '(auto)'}\n"
            f"EXPECTED_URL: {expected_url or '(none)'}\n"
            f"START_URL:    {start_url or '(none)'}\n"
            f"SESSION_ID:   {web_task.session_id}\n"
            f"{'='*60}"
        )

        # ── 0. Initial Navigation ──────────────────────────────────────────
        if start_url:
            nav_res = await self.manager.navigation.goto(start_url)
            visited_urls.append(nav_res["url"])
            await self.manager.recovery.dismiss_common_overlays()

        # Check for immediate login / CAPTCHA wall before doing any work
        wall = await self.manager.recovery.detect_human_wall()
        if wall:
            log.info(f"Human intervention wall detected: {wall['reason']}")
            return {
                "success": False,
                "needs_handoff": wall,
                "visited": visited_urls,
                "steps": checkpoint.steps,
                "downloads": downloads,
                "checkpoint": checkpoint.to_context(),
            }

        page = await self.manager.get_active_page()
        current_url = page.url

        # ── Tier 2: Site Adapter Fast Path ────────────────────────────────
        # Pass target_site to find_adapter so it can hard-reject mismatched adapters.
        adapter = self.adapters.find_adapter(task, current_url, target_site=target_site)
        if adapter:
            log.info(
                f"[TASK_ID={effective_task_id}] SELECTED_ADAPTER: {adapter.name} "
                f"(target_site={target_site or 'auto'}, current_url={current_url[:80]})"
            )
            try:
                risk = classify_action_risk(adapter.name, task)
                if risk == RiskLevel.HIGHER and not ctx.get("confirmed", False):
                    return {
                        "success": False,
                        "needs_confirmation": {
                            "action": adapter.name,
                            "prompt": f"I am about to {task}. Proceed?",
                            "risk": risk,
                        },
                        "visited": visited_urls,
                        "steps": checkpoint.steps,
                        "checkpoint": checkpoint.to_context(),
                    }

                adapter_result: ActionResult = await adapter.execute(task, self.manager, ctx)

                # Hard Verification Gate: Never accept success without passed verification
                has_verification = (
                    adapter_result.verification is not None
                    and isinstance(adapter_result.verification, dict)
                )
                verif_passed = has_verification and adapter_result.verification.get("passed") is True

                if adapter_result.success and verif_passed:
                    log_verification_step(
                        action=f"Adapter {adapter.name}",
                        expected=f"Execution and state verification for '{task}'",
                        observed=f"Verified: {adapter_result.details}",
                        result="PASS",
                        artifact_status="verified",
                    )
                    page = await self.manager.get_active_page()
                    visited_urls.append(page.url)
                    checkpoint.record_step({
                        "step": 1,
                        "tier": "adapter",
                        "adapter": adapter.name,
                        "action": adapter_result.action,
                        "url": page.url,
                        "details": adapter_result.details,
                    })
                    # Register verified artifacts
                    for art in self.manager.artifacts:
                        checkpoint.record_artifact(art)

                    # A screenshot on any verified-successful web task, not
                    # gated on the request happening to contain a specific
                    # word — a phrasing heuristic here always misses some
                    # future wording, and we're already inside the "this
                    # genuinely succeeded" branch, so there's no cost to
                    # just always capturing the evidence.
                    screenshot_path = adapter_result.screenshot_path or adapter_result.data.get("screenshot_path")
                    if not screenshot_path:
                        try:
                            ss_res = await self.manager.visual.screenshot()
                            if isinstance(ss_res, dict) and ss_res.get("path"):
                                screenshot_path = ss_res["path"]
                        except Exception as e:
                            log.warning(f"Could not capture post-verification screenshot: {e}")

                    # Return only artifacts belonging to this task (prevents cross-task leakage).
                    task_artifacts = self.manager.get_task_artifacts(effective_task_id)
                    return {
                        "success": True,
                        "result": adapter_result.details,
                        "url": page.url,
                        "visited": visited_urls,
                        "steps": checkpoint.steps,
                        "downloads": [a.to_dict() for a in task_artifacts if a.kind == "file"],
                        "artifacts": [a.to_dict() for a in task_artifacts],
                        "verification": adapter_result.verification,
                        "screenshot_path": screenshot_path,
                        "checkpoint": checkpoint.to_context(),
                        "task_id": effective_task_id,
                        "target_site": target_site,
                        "adapter_used": adapter.name,
                    }
                elif adapter_result.success and not verif_passed:
                    # Adapter claims success but state verification did not pass!
                    log_verification_step(
                        action=f"Adapter {adapter.name}",
                        expected=f"Verified real browser state for '{task}'",
                        observed=f"Adapter claimed success without valid verification: {adapter_result.details}",
                        result="FAIL",
                        artifact_status="unverified",
                    )
                    raise AdapterFallbackException(
                        f"Adapter {adapter.name} returned unverified state. Falling back to generic agent loop."
                    )
            except AdapterFallbackException as fallback_err:
                log.warning(
                    f"Adapter {adapter.name} raised fallback ({fallback_err.reason}). "
                    "Gracefully continuing with generic BrowserManager loop."
                )
                # If the adapter explicitly signals needs_handoff (e.g. modal could
                # not be dismissed and blocks content), surface it immediately rather
                # than re-attempting with the generic loop which cannot do better.
                fallback_context = getattr(fallback_err, 'context', {}) or {}
                if fallback_context.get('needs_handoff'):
                    handoff_reason = fallback_context.get('needs_handoff')
                    if isinstance(handoff_reason, str):
                        handoff_signal = {
                            'kind': 'login_wall',
                            'reason': handoff_reason,
                            'instruction': 'Please sign in or dismiss the modal in the browser window, then click "Done, continue".',
                        }
                    else:
                        handoff_signal = handoff_reason
                    log.info(f"Adapter propagated needs_handoff: {handoff_signal}")
                    page = await self.manager.get_active_page()
                    return {
                        'success': False,
                        'needs_handoff': handoff_signal,
                        'visited': visited_urls,
                        'steps': checkpoint.steps,
                        'downloads': downloads,
                        'checkpoint': checkpoint.to_context(),
                    }
                checkpoint.record_step({
                    'step': len(checkpoint.steps) + 1,
                    'tier': 'adapter_fallback',
                    'action': 'adapter_fallback',
                    'url': page.url,
                    'details': f'Adapter fell back: {fallback_err.reason}. Switching to generic agent loop.',
                })
            except Exception as e:
                log.warning(f"Adapter exception: {e}. Falling back to generic agent loop.")

        # ── Generic Browser Agent Loop (Tiers 1, 3, 4, 5) ─────────────────
        log.info("Executing via generic BrowserManager reason-act loop...")
        return await self._generic_loop(task, max_steps, ctx, checkpoint, visited_urls, downloads)

    async def _generic_loop(
        self,
        task: str,
        max_steps: int,
        ctx: dict[str, Any],
        checkpoint: TaskCheckpoint,
        visited_urls: list[str],
        downloads: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        The generic 5-tier reason-act loop. Runs when no adapter is available
        or after an adapter fallback.
        """
        page = await self.manager.get_active_page()
        about_blank_retries = 0
        MAX_ABOUT_BLANK_RETRIES = 2

        for step_idx in range(1, max_steps + 1):
            page = await self.manager.get_active_page()
            current_url = page.url

            # ── ABOUT_BLANK recovery (bounded, explicit) ────────────────────
            # about:blank is not a page to inspect or scroll — there is
            # nothing there. The forbidden failure mode this replaces:
            # adapter_fallback @ about:blank / scroll @ about:blank looping
            # until max_steps. Try a deliberate navigation back to a known
            # target a bounded number of times; only hand off once that's
            # exhausted or there is no target to recover to.
            if await self.manager.recovery.is_about_blank():
                recovery_target = ctx.get("expected_url") or (visited_urls[0] if visited_urls else None)
                if recovery_target and about_blank_retries < MAX_ABOUT_BLANK_RETRIES:
                    about_blank_retries += 1
                    log.info(
                        f"[Step {step_idx}] ABOUT_BLANK recovery {about_blank_retries}/{MAX_ABOUT_BLANK_RETRIES}: "
                        f"navigating to {recovery_target}"
                    )
                    try:
                        await self.manager.navigation.goto(recovery_target)
                    except Exception as nav_err:
                        # A recovery attempt that can't even reach the target
                        # counts against the retry budget like any other
                        # failed attempt — it must not crash the task.
                        log.warning(f"ABOUT_BLANK recovery navigation failed: {nav_err}")
                    await asyncio.sleep(0.3)
                    continue
                return {
                    "success": False,
                    "needs_handoff": {
                        "kind": "about_blank",
                        "reason": (
                            "Browser is stuck on a blank page with no reachable navigation target."
                            if not recovery_target else
                            f"Browser is still on about:blank after {about_blank_retries} recovery attempts."
                        ),
                        "instruction": "Please navigate to the site in the open browser window, then click 'Done, continue'.",
                    },
                    "visited": visited_urls,
                    "steps": checkpoint.steps,
                    "downloads": downloads,
                    "checkpoint": checkpoint.to_context(),
                }

            if current_url not in visited_urls:
                visited_urls.append(current_url)

            # Check human walls mid-task
            wall = await self.manager.recovery.detect_human_wall()
            if wall:
                return {
                    "success": False,
                    "needs_handoff": wall,
                    "visited": visited_urls,
                    "steps": checkpoint.steps,
                    "downloads": downloads,
                    "checkpoint": checkpoint.to_context(),
                }

            # Dismiss overlays deterministically (Tier 1)
            await self.manager.recovery.dismiss_common_overlays()

            # ── Tier 4: Smart DOM inspection (always runs first) ───────────
            elements = await self.manager.inspector.inspect(force_refresh=True)
            compact_repr = await self.manager.inspector.get_compact_text()

            # ── Tier 1+3: Decide next action ───────────────────────────────
            # First try heuristic deterministic match; if confidence is low, escalate to LLM.
            heuristic_decision, confidence = self._heuristic_decision(
                task, elements, current_url, checkpoint.steps
            )

            if confidence >= HEURISTIC_CONFIDENCE_THRESHOLD:
                action_decision = heuristic_decision
                log.info(
                    f"[Step {step_idx}] Tier 1 heuristic decision "
                    f"(confidence={confidence:.0%}): {action_decision}"
                )
            else:
                # ── Tier 3: LLM reasoning ──────────────────────────────────
                log.info(
                    f"[Step {step_idx}] Heuristic confidence low ({confidence:.0%}), "
                    "escalating to Tier 3 LLM..."
                )
                action_decision = await self._llm_decide(
                    task, compact_repr, current_url, checkpoint, ctx
                )
                log.info(f"[Step {step_idx}] Tier 3 LLM decision: {action_decision}")

            # ── Bounded LLM-failure escape hatch ────────────────────────────
            # A reasoning-provider failure (parse error, API error, no
            # provider configured) is not "the model chose to scroll" — it is
            # the model not answering at all. Silently defaulting to the same
            # blind scroll every time is exactly the forbidden failure mode:
            # a real production run hit this and burned its entire step
            # budget scrolling with zero progress. Distinguish the failure
            # instead of collapsing it into a generic timeout.
            if checkpoint.consecutive_llm_failures >= MAX_CONSECUTIVE_LLM_FAILURES:
                return {
                    "success": False,
                    "error": (
                        f"The reasoning provider failed {checkpoint.consecutive_llm_failures} times in a row "
                        f"and no deterministic action was available: {checkpoint.last_llm_error}"
                    ),
                    "url": page.url,
                    "visited": visited_urls,
                    "steps": checkpoint.steps,
                    "downloads": downloads,
                    "checkpoint": checkpoint.to_context(),
                }

            # Task complete?
            if action_decision.get("is_complete"):
                summary = action_decision.get("summary") or "Task completed successfully."

                # Hard gate: Reject contradictory phrases in agent's own summary
                CONTRADICTORY_PHRASES = [
                    "requested url wasn't loaded",
                    "requested post wasn't loaded",
                    "couldn't open requested post",
                    "fell back to profile",
                    "target not reached",
                    "post was not loaded",
                    "post wasn't loaded",
                    "wasn't loaded",
                    "could not load",
                    "couldn't load",
                ]
                if any(p in summary.lower() for p in CONTRADICTORY_PHRASES):
                    log.warning(f"Task completion rejected due to contradictory failure admission in summary: '{summary}'")
                    return {
                        "success": False,
                        "error": f"Task incomplete: {summary}",
                        "url": page.url,
                        "visited": visited_urls,
                        "steps": checkpoint.steps,
                        "verification": {
                            "passed": False,
                            "target_reached": False,
                            "reason": f"Agent admitted failure: {summary}",
                            "actual_url": page.url,
                        },
                        "checkpoint": checkpoint.to_context(),
                    }

                # Hard state verification check on the real page before completing.
                # Driven by SiteKnowledge instead of per-site if/elif branches, so
                # every site (not just the ones with a hand-written branch) gets
                # exact-target verification instead of a missing-method crash.
                t_lower = task.lower()
                target_site_hint = str(ctx.get("target_site") or "").lower()
                site = detect_site(task, target_site_hint)
                is_post_task = any(
                    w in t_lower for w in ["post", "reel", "video", "latest", "photo"]
                )
                matched_page_type = None
                if site:
                    for pt_name, pt_rule in site.page_types.items():
                        if any(w in t_lower for w in pt_rule.keywords):
                            matched_page_type = pt_name
                            break

                if site and matched_page_type:
                    expected_ent = (
                        site.entity_extractor(task, ctx.get("expected_entity"))
                        if site.entity_extractor else None
                    )
                    if not expected_ent:
                        v_res = {
                            "passed": False,
                            "target_reached": False,
                            "reason": f"{site.site_id.capitalize()} {matched_page_type} task has no identifiable account/channel; refusing to guess.",
                        }
                    else:
                        v_res = await self.manager.verifier.verify_site(
                            site_id=site.site_id,
                            page_type=matched_page_type,
                            expected_entity=expected_ent,
                            expected_url=ctx.get("expected_url"),
                            expected_id=ctx.get("expected_post_id") or ctx.get("expected_video_id"),
                        )
                else:
                    v_res = await self.manager.verifier.verify_browser_state(
                        action=f"verify completion of '{task}'",
                        expected={"url_contains": ctx.get("expected_url") or ""},
                        artifact_status_on_pass="verified",
                    )
                    # For tasks that asked to find or open specific content, generic
                    # liveliness is NOT sufficient. Note this is `is_post_task` alone,
                    # not `site or is_post_task`: reaching this branch with `site`
                    # truthy already means the task named a known site (e.g.
                    # "instagram") but matched no page-type keyword (e.g. "post"),
                    # so it isn't asking for specific content in the first place —
                    # "open Instagram website" must not be held to the same bar as
                    # "find Sidemen's latest post" just for mentioning the site name.
                    if is_post_task and v_res.get("is_generic_check"):
                        v_res["passed"] = False
                        v_res["target_reached"] = False
                        v_res["reason"] = "Generic browser liveliness passed but task-specific state verification was not performed"

                if not v_res["passed"]:
                    log.warning(f"Task completion proposed but page state verification failed: {v_res.get('reason') or v_res.get('checks')}")
                    if v_res.get("needs_handoff") or v_res.get("login_modal_detected"):
                        return {
                            "success": False,
                            "needs_handoff": {
                                "kind": "login_wall",
                                "reason": v_res.get("reason") or "Login/signup modal is blocking requested content",
                                "instruction": "Please sign in or dismiss the modal in the browser window, then click 'Done, continue'.",
                            },
                            "url": page.url,
                            "visited": visited_urls,
                            "steps": checkpoint.steps,
                            "verification": v_res,
                            "checkpoint": checkpoint.to_context(),
                        }
                    # If on final step or specific target was requested and not reached, fail cleanly
                    if step_idx >= max_steps or v_res.get("target_reached") is False:
                        return {
                            "success": False,
                            "error": f"Browser verification failed on target state: {v_res.get('reason') or 'checks failed'}",
                            "url": page.url,
                            "visited": visited_urls,
                            "steps": checkpoint.steps,
                            "verification": v_res,
                            "checkpoint": checkpoint.to_context(),
                        }
                else:
                    # Verification passed — capture the evidence unconditionally,
                    # not gated on the request happening to contain a specific
                    # word (see the adapter branch above for the same change).
                    screenshot_path = None
                    try:
                        ss_res = await self.manager.visual.screenshot()
                        if isinstance(ss_res, dict) and ss_res.get("path"):
                            screenshot_path = ss_res["path"]
                    except Exception as e:
                        log.warning(f"Screenshot capture failed: {e}")

                    effective_task_id = ctx.get("task_id", "")
                    page_art = BrowserArtifact(
                        kind="page",
                        name=await page.title() or "Visited Webpage",
                        locator=page.url,
                        task_id=effective_task_id,
                        step_id=ctx.get("step_id", ""),
                        source_site=page.url,
                        source_url=page.url,
                        verification_status="verified",
                        metadata={"task": task, "summary": summary, "screenshot_path": screenshot_path},
                        verification_metadata={
                            "actual_url": page.url,
                            "source_site": page.url,
                            "verification_status": "verified",
                            "screenshot_ref": screenshot_path,
                            "timestamp": time.time(),
                            "observed_facts": v_res.get("observed", {}),
                        },
                    )
                    self.manager.add_artifact(page_art)
                    checkpoint.completed = True
                    task_artifacts = self.manager.get_task_artifacts(effective_task_id)
                    return {
                        "success": True,
                        "result": summary,
                        "url": page.url,
                        "visited": visited_urls,
                        "steps": checkpoint.steps,
                        "downloads": [a.to_dict() for a in task_artifacts if a.kind == "file"],
                        "artifacts": [a.to_dict() for a in task_artifacts],
                        "verification": v_res,
                        "screenshot_path": screenshot_path,
                        "checkpoint": checkpoint.to_context(),
                        "task_id": effective_task_id,
                    }

            # High-risk confirmation check
            act_type = action_decision.get("type", "")
            risk = classify_action_risk(act_type, action_decision.get("target", ""))
            if risk == RiskLevel.HIGHER and not ctx.get("confirmed", False):
                return {
                    "success": False,
                    "needs_confirmation": {
                        "action": act_type,
                        "prompt": f"Confirmation required to {act_type} on {current_url}. Proceed?",
                        "risk": risk,
                        "target": action_decision.get("target", ""),
                    },
                    "visited": visited_urls,
                    "steps": checkpoint.steps,
                    "checkpoint": checkpoint.to_context(),
                }

            # ── Execute the action ─────────────────────────────────────────
            exec_res = await self._execute_action(action_decision, task=task)
            step_record = {
                "step": step_idx,
                "tier": action_decision.get("_tier", "generic"),
                "action": act_type,
                "target": action_decision.get("target"),
                "url": current_url,
                "success": exec_res.success,
                "details": exec_res.details,
                "state_changed": exec_res.state_changed,
            }

            # ── Tier 5: Visual Coordinate Fallback ─────────────────────────
            if not exec_res.success:
                log.warning(f"Step {step_idx} failed: {exec_res.error}. Attempting Tier 5 visual fallback...")
                recovered = await self._visual_fallback(action_decision)
                if recovered:
                    step_record["success"] = True
                    step_record["details"] = f"Recovered via Tier 5 visual fallback"
                    step_record["tier"] = "visual_fallback"

            checkpoint.record_step(step_record)

            # ── Stuck detector ───────────────────────────────────────────────
            # The same action, on the same target, on the same URL, repeated
            # back to back: nothing is progressing, whatever exec_res.success
            # says. This is what a live run actually hit — repeated blind
            # `scroll` (which always reports state_changed=True regardless of
            # whether the page moved) burning the entire step budget with no
            # forward progress. Give up cleanly instead of exhausting max_steps
            # with a message that explains nothing.
            recent = checkpoint.steps[-STUCK_REPEAT_THRESHOLD:]
            if len(recent) == STUCK_REPEAT_THRESHOLD and all(
                s.get("action") == step_record["action"]
                and s.get("target") == step_record["target"]
                and s.get("url") == step_record["url"]
                for s in recent
            ):
                return {
                    "success": False,
                    "error": (
                        f"Stuck: '{step_record['action']}' on "
                        f"{step_record['target'] or step_record['url']} repeated "
                        f"{STUCK_REPEAT_THRESHOLD}x with no progress."
                    ),
                    "url": page.url,
                    "visited": visited_urls,
                    "steps": checkpoint.steps,
                    "downloads": downloads,
                    "checkpoint": checkpoint.to_context(),
                }

            # Register download artifacts
            if exec_res.action in ("download_file", "download_media") and exec_res.success:
                file_path = exec_res.data.get("path") if exec_res.data else None
                if file_path:
                    artifact = BrowserArtifact(
                        kind="file",
                        name=exec_res.data.get("filename", "downloaded_file"),
                        locator=file_path,
                        metadata=exec_res.data,
                    )
                    self.manager.add_artifact(artifact)
                    checkpoint.record_artifact(artifact)
                    downloads.append(artifact.to_dict())

            # A successful navigation is a complete task when the request was
            # only to open the destination. Without this gate, the heuristic
            # keeps selecting the same high-confidence navigate action on every
            # loop iteration until max_steps, even though the page is already
            # at the requested URL. This path is deterministic and does not
            # depend on the LLM provider (Groq, Claude, or any other backend).
            if (
                exec_res.success
                and act_type == "navigate"
                and _is_navigation_only_task(task)
            ):
                requested_url = str(action_decision.get("url") or "")
                after_page = await self.manager.get_active_page()
                if _navigation_reached(after_page.url, requested_url):
                    verification = await self.manager.verifier.verify_browser_state(
                        action=f"open {requested_url}",
                        expected={"url_contains": _url_host(requested_url)},
                        artifact_status_on_pass="verified",
                    )
                    if verification.get("passed"):
                        checkpoint.completed = True
                        # Same structural rule as the other two completion
                        # branches: a verified-successful web task always
                        # gets a screenshot, not gated on wording and not
                        # hardcoded away just because this is the fast
                        # navigation-only path.
                        screenshot_path = None
                        try:
                            ss_res = await self.manager.visual.screenshot()
                            if isinstance(ss_res, dict) and ss_res.get("path"):
                                screenshot_path = ss_res["path"]
                        except Exception as e:
                            log.warning(f"Screenshot capture failed: {e}")
                        return {
                            "success": True,
                            "result": f"Opened {after_page.url}",
                            "url": after_page.url,
                            "visited": visited_urls,
                            "steps": checkpoint.steps,
                            "downloads": downloads,
                            "artifacts": [
                                a.to_dict() for a in self.manager.get_task_artifacts(ctx.get("task_id", ""))
                            ],
                            "verification": verification,
                            "screenshot_path": screenshot_path,
                            "checkpoint": checkpoint.to_context(),
                            "task_id": ctx.get("task_id", ""),
                        }

            await asyncio.sleep(0.5)

        return {
            "success": False,
            "error": f"Max steps ({max_steps}) reached without completing task.",
            "url": page.url,
            "visited": visited_urls,
            "steps": checkpoint.steps,
            "downloads": downloads,
            "checkpoint": checkpoint.to_context(),
        }

    def _heuristic_decision(
        self,
        task: str,
        elements: list[Any],
        current_url: str,
        history: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], float]:
        """
        Tier 1: Attempts to determine the next action using fast, deterministic heuristics.

        Returns (decision_dict, confidence) where confidence is [0.0, 1.0].
        - confidence >= HEURISTIC_CONFIDENCE_THRESHOLD → use this decision directly
        - confidence < threshold → escalate to Tier 3 LLM
        """
        t = task.lower()

        # ── Read / extract tasks ──────────────────────────────────────────
        if any(k in t for k in ["what does this page say", "read page", "read this page", "extract text"]):
            return {"is_complete": False, "type": "read_page", "_tier": "heuristic"}, 1.0


        # ── Search / find tasks ────────────────────────────────────────────
        search_kw = None
        if "search" in t or "find" in t or "look for" in t:
            m = re.search(
                r"(?:search|find|look for)(?:\s+for)?[\s\"']+([^\"'\n]+?)[\s\"']*(?:on|in|at|$)",
                task,
                re.IGNORECASE,
            )
            if m:
                search_kw = m.group(1).strip()

        for el in elements:
            name_lower = el.name.lower() if el.name else ""

            # Type into search box if we have a keyword and haven't typed yet
            if search_kw and el.role in ("input", "searchbox", "combobox") and el.is_enabled:
                if not any(h.get("action") == "type" for h in history):
                    return {
                        "type": "type",
                        "target": el.id,
                        "text": search_kw,
                        "press_enter": True,
                        "_tier": "heuristic",
                    }, 0.9

            # Direct button/link text match for the task
            if name_lower and len(name_lower) > 2:
                task_words = set(re.findall(r'\w+', t))
                name_words = set(re.findall(r'\w+', name_lower))
                overlap = len(task_words & name_words)
                if overlap >= 2 and not any(h.get("target") == el.id for h in history[-2:]):
                    return {
                        "type": "click",
                        "target": el.id,
                        "_tier": "heuristic",
                    }, 0.7  # Below threshold → LLM will verify or override

        # ── Navigation tasks ──────────────────────────────────────────────
        url_match = re.search(
            r"(?:go to|navigate to|open|visit)\s+(https?://\S+|[\w.-]+\.(com|org|net|io|co|ai|app)[\S]*)",
            task,
            re.IGNORECASE,
        )
        if url_match:
            raw = url_match.group(1)
            if not raw.startswith("http"):
                raw = "https://" + raw
            # Once the requested host is already active, navigation is no
            # longer progress.  Repeating it starves the actual task (scroll,
            # click, extract, etc.) and eventually produces "max steps".
            if not _navigation_reached(current_url, raw):
                return {"type": "navigate", "url": raw, "_tier": "heuristic"}, 0.95

        # ── Scroll to discover more content ──────────────────────────────
        if any(k in t for k in ["scroll", "more", "load more", "show more"]):
            return {"type": "scroll", "direction": "down", "amount": 500, "_tier": "heuristic"}, 0.85

        # Insufficient heuristic signal → hand off to Tier 3 LLM
        return {"type": "scroll", "direction": "down", "amount": 300, "_tier": "heuristic"}, 0.2

    async def _llm_decide(
        self,
        task: str,
        compact_repr: str,
        current_url: str,
        checkpoint: TaskCheckpoint,
        ctx: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Tier 3: Asks the LLM for the next browser action.

        Only called when heuristic confidence is insufficient. Uses compact DOM
        representation (not screenshots) by default to minimize token cost.
        Screenshots (Tier 5 vision) are added when the DOM is ambiguous.
        """
        llm = self._get_llm()
        if llm is None or checkpoint.llm_calls >= MAX_LLM_CALLS_PER_TASK:
            reason = (
                "Max LLM calls reached for this task"
                if checkpoint.llm_calls >= MAX_LLM_CALLS_PER_TASK
                else "No browser reasoning provider is configured"
            )
            log.warning(f"{reason}. Falling back to scroll.")
            checkpoint.consecutive_llm_failures += 1
            checkpoint.last_llm_error = reason
            return {"type": "scroll", "direction": "down", "amount": 300, "_tier": "llm_unavailable"}

        checkpoint.llm_calls += 1

        history_summary = _format_step_history(checkpoint.steps[-5:])
        artifacts_summary = _format_artifacts(checkpoint.artifacts[-5:])

        prompt = f"""You are a browser automation agent for DEX. Your job is to determine the single next action to take to progress toward completing the task.

TASK: {task}

CURRENT URL: {current_url}

INTERACTIVE ELEMENTS ON PAGE (compact DOM):
{compact_repr or "(no interactive elements detected)"}

STEP HISTORY (last {len(checkpoint.steps[-5:])} steps):
{history_summary}

KNOWN ARTIFACTS (files, posts, downloads produced so far):
{artifacts_summary}

AVAILABLE ACTIONS:
- click: Click element by ID (e.g. e3) or visible text
- type: Type text into an input field
- navigate: Go to a URL
- scroll: Scroll the page (direction: up/down, amount: pixels)
- press_key: Press a keyboard key (e.g. Enter, Escape, Tab)
- download_file: Trigger a file download (a page that offers an explicit download button/link)
- download_media: Save the image/video that IS this page's content — use this instead of download_file when there is no download button/link (e.g. an Instagram post, a raw media page)
- read_page: Extract visible text from the current page
- done: Mark the task as complete with a summary

RULES:
1. Prefer clicking visible elements by their ID (e1, e2, e3...) over text matching.
2. Never repeat the exact same action+target as the immediately preceding step.
3. If the task is clearly complete based on the page state, return "done".
4. If you need to navigate to a specific URL, return "navigate" with the full URL.
5. Be concise. One action at a time.
6. "Save/download this post/image/video" with no download button visible means download_media, not download_file.

Return ONLY a valid JSON object with exactly one action:
For click:       {{"type": "click", "target": "e3"}}
For type:        {{"type": "type", "target": "e2", "text": "your text", "press_enter": true}}
For navigate:    {{"type": "navigate", "url": "https://example.com"}}
For scroll:      {{"type": "scroll", "direction": "down", "amount": 500}}
For press_key:   {{"type": "press_key", "key": "Enter"}}
For download:    {{"type": "download_file", "target": "e5"}}
For download_media: {{"type": "download_media"}}
For done:        {{"type": "done", "summary": "Task completed: ..."}}
"""

        try:
            messages = [{"role": "user", "content": prompt}]
            response = await llm.ainvoke(messages)
            result_text = str(response.content if hasattr(response, "content") else response)
            decision = _parse_llm_action(result_text)
            decision["_tier"] = "llm"
            log.info(f"LLM action decision (call {checkpoint.llm_calls}): {decision}")

            # A real decision came back — the failure streak, if any, is over.
            checkpoint.consecutive_llm_failures = 0

            # Normalize "done" → is_complete
            if decision.get("type") == "done":
                decision["is_complete"] = True
                decision["summary"] = decision.pop("summary", "Task completed.")

            return decision

        except Exception as e:
            checkpoint.consecutive_llm_failures += 1
            checkpoint.last_llm_error = str(e)
            log.warning(
                f"LLM Tier 3 decision failed ({checkpoint.consecutive_llm_failures} in a row): {e}. "
                "Falling back to scroll."
            )
            return {"type": "scroll", "direction": "down", "amount": 300, "_tier": "llm_error"}

    async def _visual_fallback(self, action_decision: dict[str, Any]) -> bool:
        """
        Tier 5: Visual coordinate fallback when DOM-based action fails.
        Uses bounding box of cached element to compute center coordinates.
        """
        target = action_decision.get("target", "")
        if target and target.startswith("e") and target[1:].isdigit():
            el = self.manager.inspector.get_element(target)
            if el and el.bbox.get("width", 0) > 0:
                center_x = el.bbox["x"] + el.bbox["width"] // 2
                center_y = el.bbox["y"] + el.bbox["height"] // 2
                log.info(f"Tier 5: visual coordinate click at ({center_x}, {center_y})")
                return await self.manager.visual.click_coordinate(center_x, center_y)
        return False

    async def _execute_action(self, decision: dict[str, Any], task: str = "") -> ActionResult:
        """Dispatches an action decision to the appropriate BrowserManager subsystem."""
        act = decision.get("type", "")
        target = decision.get("target", "")

        if act == "click":
            return await self.manager.interaction.click(target)
        elif act == "type":
            return await self.manager.interaction.type_text(
                target,
                decision.get("text", ""),
                press_enter=decision.get("press_enter", False),
                clear=decision.get("clear", True),
            )
        elif act == "scroll":
            return await self.manager.interaction.scroll(
                decision.get("direction", "down"),
                decision.get("amount", 500),
            )
        elif act == "press_key":
            return await self.manager.interaction.press_key(decision.get("key", "Enter"))
        elif act == "download_file":
            return await self.manager.interaction.download_file(target)
        elif act == "download_media":
            hint = _media_selector_hint(task)
            return await self.manager.interaction.download_media(selector_hint=hint)
        elif act == "navigate":
            url = decision.get("url", "")
            nav = await self.manager.navigation.goto(url)
            return ActionResult(success=True, action="navigate", details=str(nav))
        elif act == "read_page":
            text = await self.manager.inspector.get_visible_text()
            return ActionResult(success=True, action="read_page", details=text[:2000])
        elif act == "hover":
            return await self.manager.interaction.hover(target)
        elif act in ("done", "is_complete"):
            # Should never reach here (is_complete handled above), but be safe
            return ActionResult(success=True, action="done", details=decision.get("summary", "Done."))

        return ActionResult(success=False, action=act, error=f"Unknown action type: {act}")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _url_host(value: str) -> str:
    """Return a stable host hint for navigation verification."""
    from urllib.parse import urlparse

    parsed = urlparse(value if "://" in value else f"https://{value}")
    return parsed.netloc.lower().removeprefix("www.")


def _configured_browser_provider() -> str:
    """Read the same non-secret provider selection used by the TypeScript core."""
    from provider_select import configured_provider
    return configured_provider()


def _navigation_reached(actual: str, requested: str) -> bool:
    """Treat redirects/trailing slashes as success when the requested host matches."""
    if not actual or not requested or actual.startswith("about:"):
        return False
    actual_host = _url_host(actual)
    requested_host = _url_host(requested)
    return bool(actual_host and requested_host and (
        actual_host == requested_host
        or actual_host.endswith(f".{requested_host}")
        or requested_host.endswith(f".{actual_host}")
    ))


def _is_navigation_only_task(task: str) -> bool:
    """Whether a navigate action can safely complete the whole request."""
    t = task.lower()
    follow_up_markers = (
        "scroll", "latest", "post", "reel", "video", "screenshot", "share",
        "send", "find", "search", "click", "download", "read", "extract",
        "type", "login", "sign in", "open it", "show me", "verify",
    )
    return not any(marker in t for marker in follow_up_markers)


def _media_selector_hint(task: str) -> str | None:
    """
    The detected site's known media selectors (e.g. Instagram's post-image
    selectors, already used by verify_site to confirm a post loaded), joined
    into one CSS selector for download_media — reusing SiteKnowledge rather
    than a second, site-specific selector list.
    """
    site = detect_site(task)
    if not site:
        return None
    for spec in site.verification_rules.values():
        if spec.media_selectors:
            return ", ".join(spec.media_selectors)
    return None

def _format_step_history(steps: list[dict[str, Any]]) -> str:
    if not steps:
        return "(no steps yet)"
    lines = []
    for s in steps:
        status = "✓" if s.get("success") else "✗"
        lines.append(
            f"  {status} Step {s.get('step', '?')}: {s.get('action', '?')} "
            f"target={s.get('target', '-')} on {s.get('url', '-')}"
        )
    return "\n".join(lines)


def _format_artifacts(artifacts: list[dict[str, Any]]) -> str:
    if not artifacts:
        return "(none)"
    lines = []
    for a in artifacts:
        lines.append(f"  [{a.get('kind', '?')}] \"{a.get('name', '?')}\" → {a.get('locator', '?')}")
    return "\n".join(lines)


def _parse_llm_action(text: str) -> dict[str, Any]:
    """
    Robustly extracts the JSON action object from LLM response text.
    Handles markdown code fences, leading prose, etc.
    """
    # Strip code fences
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        inner = "\n".join(lines[1:])
        end = inner.rfind("```")
        stripped = inner[:end].strip() if end != -1 else inner.strip()

    # Find the outermost JSON object
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(stripped[start:end + 1])
        except json.JSONDecodeError:
            pass

    # Final fallback: try to parse the whole string
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        log.warning(f"Could not parse LLM response as JSON: {text[:200]}")
        return {"type": "scroll", "direction": "down", "amount": 300}
