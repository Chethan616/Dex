"""
Browser Agent Server -- hosts the persistent BrowserManager on 127.0.0.1:8766.

The TypeScript BrowserAgent talks to it over HTTP.
Start: python agents/browser/server.py
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent))  # agents/credentials.py

load_dotenv(ROOT.parent.parent / ".env")

from dex_logging import configure as _configure_logging

# Configure logging to %LOCALAPPDATA%\DEX\browser.log
log = _configure_logging("browser")

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from browser_manager import BrowserManager
from browser_state import BrowserArtifact
from browser_runtime import BrowserRuntimeManager

PORT = int(os.environ.get("BROWSER_AGENT_PORT", "8766"))


def _configured_headless() -> bool:
    """
    Checked in order: DEX_BROWSER_HEADLESS env var, then settings.json's
    browserHeadless, defaulting True if neither says otherwise — same
    precedence provider_select.configured_provider() already uses for
    brainProvider. This used to be env-var-only, which meant the
    browserHeadless field in settings.json (and the Settings UI control
    backing it) had no actual effect on this process at all.
    """
    raw = os.environ.get("DEX_BROWSER_HEADLESS", "").strip().lower()
    if raw:
        return raw not in ("false", "0", "no")

    import json

    settings_path = (
        Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        / "DEX" / "settings.json"
    )
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        if "browserHeadless" in settings:
            return bool(settings["browserHeadless"])
    except (OSError, ValueError, TypeError):
        pass
    return True


HEADLESS = _configured_headless()

# Singleton BrowserManager
manager: BrowserManager | None = None
runtime: BrowserRuntimeManager | None = None

# Route recording state (record_route/stop_recording). One process-wide
# browser session exists today, so one in-flight recording is all there is
# to track — matching the same "no per-session isolation yet" pattern as
# /abandon above.
_recording_steps: list[dict[str, Any]] = []
_recording_origin: str = ""
_recording_goal: str = ""


async def _on_recorded_click(source: Any, info: dict[str, Any]) -> None:
    _recording_steps.append(info)


_RECORD_CLICK_JS = """
() => {
  if (window.__dexRecordingInstalled) return;
  window.__dexRecordingInstalled = true;
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a,button,[role="button"],input,select,textarea') || e.target;
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
    const selector = el.id ? ('#' + el.id) : el.tagName.toLowerCase();
    if (window.__dexRecordClick) window.__dexRecordClick({ text, selector, url: location.href });
  }, true);
}
"""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global manager, runtime
    log.info(f"Starting Browser Agent server on port {PORT} (headless={HEADLESS})...")
    manager = BrowserManager(headless=HEADLESS, auto_launch_owner_browser=True)
    runtime = BrowserRuntimeManager(manager)
    log.info("BROWSER_RUNTIME_STOPPED browser startup is lazy")
    yield
    if runtime:
        await runtime.close()


app = FastAPI(title="DEX Browser Agent", lifespan=lifespan)


class RunTaskRequest(BaseModel):
    task: str
    start_url: str | None = None
    max_steps: int = 25
    context: dict[str, Any] | None = None
    mode: str | None = None
    browser: str | None = None
    # Task isolation fields (Requirement: hard task/step scoping)
    request_id: str | None = None      # Top-level unique request ID
    step_id: str | None = None         # Sub-step ID within a plan
    target_site: str | None = None     # Explicit target domain, e.g. 'youtube.com'
    expected_url: str | None = None    # Expected final URL for hard verification
    expected_entity: str | None = None # Expected entity name (channel, account)


class ResumeRequest(BaseModel):
    task: str | None = None
    context: dict[str, Any] | None = None


class AbandonRequest(BaseModel):
    session_id: str | None = None


class ConfirmRequest(BaseModel):
    confirmed: bool = True
    task: str | None = None
    context: dict[str, Any] | None = None


class PlanTaskRequest(BaseModel):
    """Request to decompose a complex multi-application task into ordered sub-tasks."""
    task: str
    context: dict[str, Any] | None = None


class CheckpointResumeRequest(BaseModel):
    """Resume a task from a saved checkpoint (after a failure or application switch)."""
    checkpoint: dict[str, Any]
    context: dict[str, Any] | None = None


class PrimitiveRequest(BaseModel):
    action: str | None = None
    op: str | None = None
    params: dict[str, Any] = {}

    model_config = {"extra": "allow"}


class OpenOwnerBrowserRequest(BaseModel):
    """Explicit Mode B request; it never falls back to the DEX profile."""
    profile: str = ""
    url: str = ""


def _resolve_mode_hint(requested: str | None) -> str | None:
    """
    Which browser mode a request gets, as one policy instead of ten repeated
    ternaries. An explicit request always wins ("dex" opts into the isolated
    DEX profile, "owner" into the user's real browser).

    Unset now defaults to the isolated DEX profile ("dex"), not the owner's
    real browser. That used to be reversed, on the theory that the profile
    already signed into everything beats a second, separate login — true in
    principle, but in practice it meant every ordinary fetch/act request
    attached DEX to the owner's actual, already-running, heavily-used
    Vivaldi over CDP, and that negotiation proved to hang unpredictably even
    on a freshly launched instance tested in complete isolation from DEX. A
    task that just wants a result (a post, a portal page) does not need the
    owner's live browser at all, and the isolated profile is a real,
    persistent, DEX-owned profile — logging into a site once there keeps it
    logged in for every later headless fetch. DEX_BROWSER_DEFAULT_MODE can
    still force "owner" back as the default for whoever wants that; an
    explicit per-request "owner" always reaches it regardless.
    """
    if requested == "dex":
        return None
    if requested == "owner":
        return "owner"
    default = os.environ.get("DEX_BROWSER_DEFAULT_MODE", "dex").strip().lower()
    return "owner" if default == "owner" else None


@app.get("/health")
@app.get("/status")
async def health_check():
    is_alive = manager.session.is_connected if manager else False
    return {
        "status": "ok",
        "browser_connected": is_alive,
        "runtime_state": runtime.state.value if runtime else "STOPPED",
        "port": PORT,
    }


@app.get("/state")
async def get_state():
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    state = await manager.get_state()
    return state.to_dict()


@app.post("/run-task")
async def run_task(req: RunTaskRequest):
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    log.info(
        f"Received /run-task: '{req.task[:80]}' "
        f"(request_id={req.request_id}, target_site={req.target_site}, browser={req.browser})"
    )
    try:
        # Resolve which browser this task uses. An explicit request (or "in
        # my browser" in the task text) always wins; otherwise it's whatever
        # DEX_BROWSER_DEFAULT_MODE says (see _resolve_mode_hint) — normally
        # the owner's real browser, not the isolated DEX profile.
        explicit_browser = req.browser or ("owner" if "in my browser" in req.task.lower() else None)
        resolved_mode = _resolve_mode_hint(explicit_browser)
        want_owner_browser = resolved_mode == "owner"
        # Do NOT silently fall back to Mode A: verify CDP attachment/launch
        # succeeds before running the task, surfacing a clear failure if not.
        if want_owner_browser and not manager.session._is_cdp_attached:
            try:
                await manager.initialize(mode_hint="owner")
            except RuntimeError as cdp_err:
                log.warning(f"Mode B CDP attachment failed: {cdp_err}")
                return {
                    "success": False,
                    "error": str(cdp_err),
                    "retryable": False,
                }

        if not runtime:
            raise HTTPException(status_code=503, detail="Browser runtime not initialized")
        res = await runtime.run_task(
            mode_hint=resolved_mode,
            task=req.task,
            start_url=req.start_url,
            max_steps=req.max_steps,
            context=req.context,
            task_id=req.request_id,
            step_id=req.step_id,
            target_site=req.target_site,
            expected_url=req.expected_url,
            expected_entity=req.expected_entity,
        )
        handoff = res.get("needs_handoff") or {}
        # Only a wall that genuinely needs the owner's hands — login,
        # CAPTCHA, Cloudflare. Other needs_handoff kinds (about_blank's
        # stuck-page recovery, a login-wall reported via verification's own
        # "login_wall" kind further down the loop) already have their own
        # bounded recovery and do not need a visible window; forcing one
        # for those just adds a second, riskier failure mode.
        if handoff.get("kind") in ("login_required", "login_wall", "captcha", "cloudflare_challenge") \
                and not manager.session._is_cdp_attached:
            try:
                await manager.session.relaunch_for_human_handoff()
            except Exception as handoff_err:
                log.warning(f"Could not relaunch visibly for human handoff: {handoff_err}")
        return res
    except Exception as err:
        log.error(f"Error executing run_task: {err}", exc_info=True)
        return {"success": False, "error": str(err), "retryable": True}


@app.post("/open-owner-browser")
async def open_owner_browser(req: OpenOwnerBrowserRequest):
    """Attach to the user's already-CDP-enabled browser on explicit request."""
    if not runtime or not manager:
        raise HTTPException(status_code=503, detail="Browser runtime not initialized")
    try:
        await runtime.ensure_running(mode_hint="owner")
        page = await manager.tabs.new_tab(req.url or None) if req.url else await manager.get_active_page()
        return {
            "success": True,
            "data": {
                "attached": True,
                "profile": manager.session.browser_family or req.profile or "personal browser",
                "url": page.url,
            },
        }
    except Exception as err:
        return {"success": False, "error": str(err), "retryable": False}


@app.post("/resume")
async def resume_task(req: ResumeRequest):
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    log.info("Received /resume after user handoff.")
    # Check if wall has been cleared
    wall = await manager.recovery.detect_human_wall()
    if wall:
        return {
            "success": False,
            "needs_handoff": wall,
            "error": "Authentication or CAPTCHA check is still present.",
        }

    if manager.session._headless_before_handoff is not None:
        # The wall is clear — switch the same profile back to headless
        # before continuing, rather than leaving a window open for every
        # task after this one.
        try:
            await manager.session.resume_after_handoff()
        except Exception as resume_err:
            log.warning(f"Could not resume headlessly after handoff: {resume_err}")

    # Resume task execution
    task_desc = req.task or "Continue previous task"
    return await manager.runner.run_task(task_desc, context=req.context)


@app.post("/abandon")
async def abandon_task(req: AbandonRequest):
    """
    Releases the current task binding after the owner walks away from a
    hand-off instead of resuming it. There is one process-wide browser
    session today (not one per session_id), so this does not close the
    browser or the tab — it only clears `manager.set_current_task` so the
    next task starts with clean artifact scoping. A `session_id` that
    doesn't match the live session is reported rather than silently ignored,
    since that means the caller is abandoning a session that already ended.
    """
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    if req.session_id and req.session_id != manager.session.session_id:
        return {
            "success": False,
            "error": f"session_id {req.session_id} does not match the live session "
                     f"{manager.session.session_id}; nothing to abandon.",
        }
    manager.set_current_task("", "")
    return {"success": True, "data": {"session_id": manager.session.session_id}}


@app.post("/confirm")
async def confirm_task(req: ConfirmRequest):
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    log.info(f"Received /confirm: confirmed={req.confirmed}")
    if not req.confirmed:
        return {"success": False, "error": "Action cancelled by user.", "retryable": False}

    ctx = dict(req.context or {})
    ctx["confirmed"] = True
    task_desc = req.task
    if not task_desc and manager.runner and manager.runner._active_checkpoint:
        task_desc = manager.runner._active_checkpoint.task
    if not task_desc:
        task_desc = "Continue confirmed task"
    return await manager.runner.run_task(task_desc, context=ctx)


@app.post("/plan-task")
async def plan_task(req: PlanTaskRequest):
    """
    Decomposes a complex cross-application task into an ordered list of sub-tasks
    with dependency tracking. Each sub-task references artifacts from previous steps.

    Example: "Find Sidemen's latest Instagram post, download it, email to Rahul,
    open Blender and make a 3D scene from the image."
    → [{app: instagram, task: find_post}, {app: browser, task: download}, ...]
    """
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    log.info(f"Received /plan-task: '{req.task}'")
    try:
        llm = manager.runner._get_llm()
        if llm is None:
            # No LLM available: return task as a single-step plan
            return {
                "success": True,
                "plan": [
                    {"step": 1, "app": "browser", "task": req.task, "depends_on": [], "artifact_outputs": []}
                ],
                "llm_available": False,
            }

        prompt = f"""You are a DEX task planner. Decompose the following complex task into an ordered list of sub-tasks.

Each sub-task must specify:
- step: integer (1-based)
- app: the application or system (e.g. "browser", "instagram", "gmail", "blender", "files", "email")
- task: the specific sub-task description
- depends_on: list of step numbers this step depends on
- artifact_outputs: list of artifact types this step produces (e.g. ["post", "file", "email"])
- start_url: optional URL to navigate to first

COMPLEX TASK: {req.task}

Rules:
1. Break cross-application tasks into one sub-task per application.
2. Reference artifacts from previous steps explicitly (e.g. "the file from step 2").
3. Order steps by dependency (earlier steps must not depend on later steps).
4. If the task is simple (single-app, single action), return just one step.

Return ONLY a valid JSON object: {{"plan": [{{"step": 1, "app": "...", "task": "...", "depends_on": [], "artifact_outputs": []}}]}}"""

        messages = [{"role": "user", "content": prompt}]
        response = await llm.ainvoke(messages)
        result_text = str(response.content if hasattr(response, "content") else response)

        # Parse the plan
        start = result_text.find("{")
        end = result_text.rfind("}")
        if start != -1 and end > start:
            import json as _json
            parsed = _json.loads(result_text[start:end + 1])
            return {"success": True, "plan": parsed.get("plan", []), "llm_available": True}

        return {"success": False, "error": "Could not parse plan from LLM response."}

    except Exception as err:
        log.error(f"Error in /plan-task: {err}", exc_info=True)
        return {"success": False, "error": str(err)}


@app.post("/checkpoint")
async def resume_from_checkpoint(req: CheckpointResumeRequest):
    """
    Resumes a task from a serialized checkpoint (e.g. after a failure,
    application switch, or multi-turn continuation).
    """
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")

    ckpt = req.checkpoint
    task = ckpt.get("task", "Continue previous task")
    ctx = dict(req.context or {})
    ctx["checkpoint"] = ckpt  # Pass checkpoint context to runner

    log.info(f"Resuming from checkpoint: task='{task}' steps_taken={ckpt.get('steps_taken', 0)}")
    return await manager.runner.run_task(task, context=ctx)


@app.post("/primitive")
async def execute_primitive(req: PrimitiveRequest):
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")

    act_raw = req.action or req.op or ""
    action = act_raw.lower()

    # Merge top-level extra fields into params (Pydantic v1 & v2 compatible)
    dump_fn = getattr(req, "model_dump", None) or getattr(req, "dict")
    extra = dump_fn(exclude={"action", "op", "params"})
    p = {**extra, **req.params}
    log.info(f"Executing primitive action: '{action}' with params: {p}")

    try:
        if action == "navigate":
            if not runtime:
                raise HTTPException(status_code=503, detail="Browser runtime not initialized")
            await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            url = str(p.get("url") or "about:blank")
            res = await manager.navigation.goto(url)
            return {"success": True, "data": res}

        elif action in ("read", "read_page"):
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            text = await manager.inspector.get_visible_text()
            page = await manager.get_active_page()
            return {"success": True, "data": {"text": text, "url": page.url, "title": await page.title()}}

        elif action in ("inspect", "map_page", "page_model"):
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            compact = await manager.inspector.get_compact_text()
            elements = await manager.inspector.inspect()
            page = await manager.get_active_page()
            return {
                "success": True,
                "data": {
                    "compact": compact,
                    "elements": [e.__dict__ for e in elements],
                    "url": page.url,
                    "title": await page.title(),
                },
            }

        elif action in ("click", "click_text"):
            target = str(p.get("target") or p.get("text") or p.get("selector") or p.get("element_id") or "")
            res = await manager.interaction.click(target)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action in ("type", "type_text", "fill_form"):
            target = str(p.get("target") or p.get("selector") or p.get("element_id") or "")
            text = str(p.get("text") or p.get("value") or "")
            enter = bool(p.get("submit") or p.get("press_enter"))
            clear = bool(p.get("clear", True))
            res = await manager.interaction.type_text(target, text, press_enter=enter, clear=clear)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action == "select":
            target = str(p.get("target") or p.get("selector") or "")
            value = str(p.get("value") or "")
            res = await manager.interaction.select_option(target, value)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action == "hover":
            target = str(p.get("target") or p.get("selector") or "")
            res = await manager.interaction.hover(target)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action == "scroll":
            direction = str(p.get("direction") or p.get("to") or "down")
            amount = int(p.get("amount") or 500)
            res = await manager.interaction.scroll(direction, amount)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action == "press_key":
            key = str(p.get("key") or p.get("text") or "Enter")
            res = await manager.interaction.press_key(key)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action == "screenshot":
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            path = p.get("path")
            full_page = bool(p.get("full_page", False))
            res = await manager.visual.screenshot(save_path=path, full_page=full_page)
            return {"success": True, "data": res}

        elif action in ("download_current", "download_file"):
            target = p.get("trigger_target") or p.get("element_id")
            res = await manager.interaction.download_file(trigger_target=target)
            return {"success": res.success, "data": res.to_dict(), "error": res.error}

        elif action == "go_back":
            res = await manager.navigation.back()
            return {"success": True, "data": res}

        elif action == "reload":
            res = await manager.navigation.reload()
            return {"success": True, "data": res}

        elif action == "open_browser":
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            url = p.get("url")
            page = await manager.tabs.new_tab(url)
            return {"success": True, "data": {"url": page.url, "attached": True}}

        elif action == "session_status":
            state = await manager.get_state()
            return {"success": True, "data": state.to_dict()}

        elif action == "verify":
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            spec = p.get("spec") or p
            res = await manager.verifier.verify_spec(spec)
            return {"success": res["passed"], "data": res}

        elif action == "tabs":
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            sub = p.get("sub_action", "list")
            if sub == "list":
                tabs = await manager.tabs.list_tabs()
                return {"success": True, "data": [t.__dict__ for t in tabs]}
            elif sub == "new":
                page = await manager.tabs.new_tab(p.get("url"))
                return {"success": True, "data": {"url": page.url}}
            elif sub == "switch":
                page = await manager.tabs.switch_tab(p.get("tab_id") or p.get("target"))
                return {"success": True, "data": {"url": page.url}}
            elif sub == "close":
                ok = await manager.tabs.close_tab(p.get("tab_id"))
                return {"success": ok}

        elif action == "sign_in":
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            url = str(p.get("url") or "")
            if not url:
                return {"success": False, "error": "sign_in needs a url"}
            res = await manager.interaction.sign_in(url)
            needs_owner = bool(res.data and res.data.get("reason") and not res.success)
            return {"success": res.success, "data": res.to_dict(), "error": res.error, "needs_owner": needs_owner}

        elif action == "extract":
            selector = p.get("selector")
            data = await manager.inspector.extract(str(selector) if selector else None)
            return {"success": True, "data": data}

        elif action == "wait_for":
            data = await manager.navigation.wait_for(
                text=p.get("text"),
                selector=p.get("selector"),
                url=p.get("url"),
                idle=bool(p.get("idle")),
                timeout_ms=int((p.get("timeout") or 20) * 1000),
            )
            return {"success": True, "data": data}

        elif action == "extract_table":
            which = int(p.get("which") or p.get("table") or 0)
            data = await manager.inspector.extract_table(which)
            return {"success": True, "data": data}

        elif action == "record_route":
            global _recording_steps, _recording_origin, _recording_goal
            if runtime:
                await runtime.ensure_running(mode_hint=_resolve_mode_hint(p.get("browser")))
            url = str(p.get("url") or "")
            goal = str(p.get("goal") or "")
            if url:
                await manager.navigation.goto(url)
            page = await manager.get_active_page()
            _recording_steps = []
            _recording_origin = page.url
            _recording_goal = goal
            try:
                await page.expose_binding("__dexRecordClick", _on_recorded_click)
            except Exception:
                pass  # Already bound from an earlier recording on this same page.
            await page.add_init_script(_RECORD_CLICK_JS)
            await page.evaluate(_RECORD_CLICK_JS)
            return {"success": True, "data": {"origin": _recording_origin, "goal": goal}}

        elif action == "stop_recording":
            page = await manager.get_active_page()
            steps = list(_recording_steps)
            data = {"steps": steps, "landed_on": page.url, "origin": _recording_origin}
            _recording_steps = []
            return {"success": True, "data": data}

        return {"success": False, "error": f"Unknown primitive action: {action}"}

    except Exception as err:
        log.error(f"Primitive action '{action}' error: {err}", exc_info=True)
        return {"success": False, "error": str(err)}



@app.get("/browser/diagnostics")
async def browser_diagnostics():
    """
    Returns detailed diagnostics about the current browser session and task state.
    Implements Requirement 14 (visible browser-mode indicator in diagnostics).

    Fields include:
    - browser_mode: 'MODE_A_PERSISTENT' or 'MODE_B_USER_ATTACHED'
    - attached_to_user_browser: bool
    - current_task_id: the active task_id
    - task_artifact_counts: per-task artifact counts
    - all_tab_urls: all open tab URLs
    """
    if not manager:
        raise HTTPException(status_code=503, detail="Browser manager not initialized")
    try:
        diagnostics = await runtime.diagnostics() if runtime else await manager.get_diagnostics()
        return diagnostics
    except Exception as err:
        log.error(f"Error fetching diagnostics: {err}", exc_info=True)
        return {"error": str(err), "browser_connected": False}


if __name__ == "__main__":
    # pythonw.exe has no stdout/stderr. Uvicorn's default logging setup tries
    # to attach console handlers there and exits before the lifespan starts.
    # Keep the file handlers installed by dex_logging instead.
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="info",
        log_config=None,
    )
