"""
Browser Agent Server -- the process that owns the web browser.

Runs on 127.0.0.1:8766, mirroring the Desktop Agent's shape. The TypeScript
BrowserAgent talks to it over HTTP. Two backends live behind it:

  * browser_use  -- autonomous, reasons its own way through a task
  * primitives   -- exact: navigate / click / type / extract by CSS selector

The Brain picks per step; neither is a fallback in the "try again harder"
sense. Verification always runs through the primitives path, against the live
DOM, because a claim of success from the thing that acted is not evidence.

Start: python agents/browser/server.py
"""
from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))   # agents/credentials.py

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / '.env')

from dex_logging import configure as _configure_logging

# No console under pythonw, so the default stderr handler would raise on
# startup and the file is the only output. See agents/dex_logging.py.
log = _configure_logging('browser')

import uvicorn
from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from browser_use_backend import DEFAULT_MAX_STEPS, BrowserBackend, env_flag
from primitives import PrimitiveBrowser
from route_recorder import RouteRecorder

from credentials import resolve as resolve_credential

# Groq first: it is the free tier most owners will have, and it is what the
# model choice below was measured against. Anthropic is used when its key is the
# one present, or when DEX_BROWSER_PROVIDER says so.
#
# Defaults are measured, not guessed. Against browser-use's real 17 KB output
# schema, qwen3.8-27b chose the correct element 3/3 with zero reasoning tokens;
# qwen3.6-27b failed Groq's own schema validation; gpt-oss-120b was correct but
# spent ~158 of 203 output tokens thinking, which a 25-step loop cannot afford
# inside an 8,000 token-per-minute budget.
DEFAULT_MODELS = {
    'groq': 'qwen/qwen3.8-27b',
    'anthropic': 'claude-sonnet-4-6',
}


def _pick_provider() -> tuple:
    """
    Which model drives the browsing loop.

    Claude Code is the default, and it is the reason the browser agent stopped
    being a link-opener: the free-tier configuration it replaces ran a small
    model with vision off and the element list truncated. It needs no API key,
    it follows the composer's Fast/Smart/Deeper modes, and it can see the page.

    An explicit DEX_BROWSER_PROVIDER still wins, and a machine with a Groq or
    Anthropic key but no Claude Code CLI falls back to it, so nothing that
    worked before stops working.
    """
    wanted = os.environ.get('DEX_BROWSER_PROVIDER', '').lower()

    groq = resolve_credential('groq_api_key', 'GROQ_API_KEY')
    anthropic = resolve_credential('anthropic_api_key', 'ANTHROPIC_API_KEY')

    if wanted == 'claude-code':
        return 'claude-code', ''
    if wanted == 'anthropic':
        return 'anthropic', anthropic or ''
    if wanted == 'groq':
        return 'groq', groq or ''

    if _has_claude_code():
        return 'claude-code', ''
    if groq:
        return 'groq', groq
    if anthropic:
        return 'anthropic', anthropic
    return 'groq', ''


def _has_claude_code() -> bool:
    """Whether the CLI is installed. Signed-in-ness is discovered on first use."""
    import shutil
    return bool(
        shutil.which('claude') or shutil.which('claude.cmd') or shutil.which('claude.exe')
    )


PROVIDER, API_KEY = _pick_provider()
MODEL = os.environ.get('BROWSER_MODEL') or DEFAULT_MODELS.get(PROVIDER, 'smart')
PORT = int(os.environ.get('BROWSER_AGENT_PORT', '8766'))

# Headed by default and it matters: a Tier 1 hand-off asks the owner to solve a
# CAPTCHA in "the open browser window". If there is no window, that instruction
# is a lie and the task deadlocks until it times out.
HEADLESS = env_flag('BROWSER_HEADLESS', False)

_autonomous: BrowserBackend | None = None
_primitives = PrimitiveBrowser(headless=HEADLESS)


def autonomous() -> BrowserBackend:
    global _autonomous
    if _autonomous is None:
        _autonomous = BrowserBackend(
            provider=PROVIDER, api_key=API_KEY, model=MODEL, headless=HEADLESS,
        )
    return _autonomous


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Orphaned Chrome processes are the classic way this kind of server leaks a
    # machine dry over a week of dev restarts.
    if _autonomous is not None:
        await _autonomous.close_all()
    await _primitives.close()


import browser_choice
from bridge import bridge

app = FastAPI(title='DEX Browser Agent', version='0.1.0', lifespan=lifespan)


# -- models -------------------------------------------------------------------


class VerifySpec(BaseModel):
    url_contains: str | None = None
    text_on_page: str | None = None
    selector: str | None = None


class RunTaskRequest(BaseModel):
    task: str
    start_url: str | None = None
    max_steps: int = DEFAULT_MAX_STEPS
    verify: VerifySpec | None = None
    # Which browser to drive: "vivaldi", "chrome", a full path, or nothing for
    # Playwright's own Chromium. Resolved before anything launches, so an
    # uninstalled browser fails by name rather than silently using another one.
    browser: str | None = None
    mode: str | None = None
    request_id: str = ''
    step_id: str = ''


class ResumeRequest(BaseModel):
    session_id: str


class PrimitiveRequest(BaseModel):
    op: str      # navigate | read | click | type | extract | screenshot | verify
                 #  | sign_in | session_status | download_current | map_page
                 #  | page_model | fill_form | click_text | wait_for
                 #  | extract_table | scroll | press_key | go_back | reload
    url: str | None = None
    selector: str | None = None
    text: str | None = None
    path: str | None = None
    full_page: bool | None = None
    verify: VerifySpec | None = None
    browser: str | None = None
    goal: str | None = None
    # The verbs added with actions.py.
    fields: dict | None = None
    submit: bool | None = None
    timeout: float | None = None
    idle: bool | None = None
    which: object | None = None


# A recording in progress, if any.
#
# One at a time and process-global, because there is one owner and one pair of
# hands: two simultaneous recordings would be two people driving one browser.
_recording: RouteRecorder | None = None


# -- routes -------------------------------------------------------------------


@app.get('/health')
def health() -> dict[str, Any]:
    return {
        'status': 'ok',
        'headless': HEADLESS,
        'provider': PROVIDER,
        'model': MODEL,
        'has_api_key': bool(API_KEY) or PROVIDER == 'claude-code',
        'open_sessions': len(_autonomous.runs) if _autonomous else 0,
    }


@app.post('/run-task')
async def run_task(req: RunTaskRequest) -> dict[str, Any]:
    # Claude Code authenticates through the CLI's own session, so an absent API
    # key is the normal state there rather than a misconfiguration.
    if PROVIDER != 'claude-code' and not API_KEY:
        return {
            'success': False,
            'error': (
                f'No API key for the browser agent ({PROVIDER}). '
                f'Set one with: npm run cred -- set {PROVIDER}_api_key'
            ),
            'retryable': False,
        }
    log.info('[%s] task: %s', req.step_id, req.task)
    return await autonomous().start_task(
        task=req.task,
        start_url=req.start_url,
        max_steps=req.max_steps,
        verify=req.verify.model_dump() if req.verify else None,
        browser=req.browser, mode=req.mode,
    )


@app.post('/resume')
async def resume(req: ResumeRequest) -> dict[str, Any]:
    log.info('[%s] owner cleared the wall - resuming', req.session_id)
    return await autonomous().resume(req.session_id)


@app.post('/abandon')
async def abandon(req: ResumeRequest) -> dict[str, Any]:
    return {'closed': await autonomous().abandon(req.session_id)}


# ── the owner's own browser ────────────────────────────────────────────────
#
# The extension dials in here. This replaces `opendia-mcp`, the Node bridge
# that used to sit between the extension and an MCP client: this process is
# already a server, and hosting the socket here is what makes the browser's
# tools ordinary Dex actions rather than opaque MCP calls that would bypass
# the confirmation ladder entirely. See bridge.py.
#
# Port 5555 is where the extension looks first, and it is kept so an
# unmodified build of the upstream extension still finds Dex.


@app.websocket('/extension')
async def extension_socket(socket: WebSocket) -> None:
    await socket.accept()
    try:
        await bridge.attach(socket)
    except WebSocketDisconnect:
        await bridge.detach('the browser closed the connection')
    except Exception as exc:  # noqa: BLE001 - one bad browser is not a crash
        log.warning('extension socket failed: %s', exc)
        await bridge.detach(str(exc))


class OpenProfileRequest(BaseModel):
    browser: str | None = None
    url: str = ''


@app.post('/open-profile')
async def open_profile(req: OpenProfileRequest) -> dict[str, Any]:
    """
    Open Dex's browser profile so the owner can sign in to their accounts.

    Signing in once here saves the hand-off on every site afterwards: Dex
    browses with this profile, so an account signed in here is an account Dex
    can already act as. Nothing is automated and no password is ever seen — it
    launches a browser and stops.
    """
    result = browser_choice.open_profile(req.browser, req.url)
    if not result.get('ok'):
        return _bad(result.get('error', 'could not open the profile'))
    return {'success': True, 'data': result}


# ── installing the extension without asking the owner to ───────────────────
#
# Chrome 152 removed --load-extension. The one route left is the enterprise
# policy ExtensionInstallForcelist, which wants a packed CRX and an update
# manifest over HTTP — it refuses a file:// URL. This process is already an
# HTTP server on loopback, so it serves both.
#
# Nothing here is reachable off this machine: the server binds 127.0.0.1 only.

EXTENSION_ID = 'joachahcdjdaeeiiocbooimlfbojagmm'


def _dist(name: str) -> Path:
    return Path(__file__).resolve().parents[2] / 'dist' / name


@app.get('/extension/update.xml')
async def extension_update_manifest() -> Response:
    """The update manifest Chrome's policy fetches."""
    crx = 'http://127.0.0.1:8766/extension/dex.crx'
    xml = (
        "<?xml version='1.0' encoding='UTF-8'?>"
        "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>"
        f"<app appid='{EXTENSION_ID}'>"
        f"<updatecheck codebase='{crx}' version='1.0.0' />"
        '</app></gupdate>'
    )
    return Response(content=xml, media_type='text/xml')


@app.get('/extension/dex.crx')
async def extension_crx() -> Response:
    """The packed extension itself."""
    crx = _dist('dex-extension.crx')
    if not crx.exists():
        return Response(content=b'', status_code=404)
    return Response(
        content=crx.read_bytes(),
        media_type='application/x-chrome-extension',
    )


@app.get('/handshake')
async def handshake() -> dict[str, Any]:
    """
    Where the core is, and the token to talk to it.

    For the extension's chat panel, which cannot read
    the core's handshake file on disk - an extension has no filesystem
    access. It can reach 127.0.0.1, so the address is handed over here.

    This is not a widening of anything. The token authenticates a *loopback*
    socket, and anything able to call this endpoint can already reach that
    socket; both are refused from anywhere but this machine. What it protects
    against is a web page reaching the core, and a web page cannot call this
    either — there is no CORS header, so the browser blocks the read before it
    starts. The extension is exempt because it holds a host permission the
    owner granted when they installed it.
    """
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('USERPROFILE') or '.'
    path = Path(base) / 'DEX' / 'ui.json'
    if not path.exists():
        return _bad('the core is not running')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        return _bad(f'could not read the handshake: {exc}')


@app.get('/extension/status')
async def extension_status() -> dict[str, Any]:
    """Whether a browser is really attached, and what it can do."""
    return {'success': True, 'data': bridge.status()}


class BrowserToolRequest(BaseModel):
    method: str
    params: dict[str, Any] = {}


@app.post('/extension/call')
async def extension_call(req: BrowserToolRequest) -> dict[str, Any]:
    """
    Run one tool in the owner's browser.

    Errors come back in the same `{success: false, error}` shape as every other
    endpoint here, so the TypeScript side does not learn a second failure
    convention for this one path.
    """
    try:
        return {'success': True, 'data': await bridge.call(req.method, req.params)}
    except Exception as exc:  # noqa: BLE001
        return _bad(str(exc))


@app.post('/primitive')
async def primitive(req: PrimitiveRequest) -> dict[str, Any]:
    try:
        if req.op == 'navigate':
            if not req.url:
                return _bad('navigate needs a url')
            return {'success': True, 'data': await _primitives.navigate(req.url, req.browser)}

        if req.op == 'read':
            return {'success': True, 'data': await _primitives.read(req.browser)}

        if req.op == 'click':
            if not req.selector:
                return _bad('click needs a selector')
            return {
                'success': True,
                'data': await _primitives.click(req.selector, req.browser),
            }

        if req.op == 'type':
            if not req.selector:
                return _bad('type needs a selector')
            return {
                'success': True,
                'data': await _primitives.type_text(
                    req.selector, req.text or '', req.browser,
                ),
            }

        if req.op == 'extract':
            return {
                'success': True,
                'data': await _primitives.extract(req.selector, req.browser),
            }

        if req.op == 'screenshot':
            return {
                'success': True,
                'data': await _primitives.screenshot(
                    req.path, True if req.full_page is None else req.full_page,
                ),
            }

        if req.op == 'page_model':
            return {'success': True, 'data': await _primitives.page_model(req.browser)}

        if req.op == 'fill_form':
            return {'success': True, 'data': await _primitives.fill_form(
                req.fields or {}, req.browser, bool(req.submit))}

        if req.op == 'click_text':
            return {'success': True, 'data': await _primitives.click_text(
                req.text, req.selector, req.browser)}

        if req.op == 'wait_for':
            return {'success': True, 'data': await _primitives.wait_for(
                req.browser, req.timeout or 20.0,
                text=req.text, selector=req.selector, url=req.url,
                idle=bool(req.idle))}

        if req.op == 'extract_table':
            return {'success': True, 'data': await _primitives.extract_table(
                req.which if req.which is not None else 0, req.browser)}

        if req.op == 'scroll':
            return {'success': True, 'data': await _primitives.scroll(
                req.text or 'down', req.browser)}

        if req.op == 'press_key':
            return {'success': True, 'data': await _primitives.press_key(
                req.text or 'Enter', req.browser)}

        if req.op == 'go_back':
            return {'success': True, 'data': await _primitives.go_back(req.browser)}

        if req.op == 'reload':
            return {'success': True, 'data': await _primitives.reload(req.browser)}

        if req.op == 'map_page':
            return {
                'success': True,
                'data': await _primitives.map_page(
                    req.text, req.browser,
                    True if req.full_page is None else bool(req.full_page),
                ),
            }

        if req.op == 'session_status':
            if not req.url:
                return _bad('session_status needs a url')
            return {
                'success': True,
                'data': await _primitives.session_status(req.url, req.browser),
            }

        if req.op == 'sign_in':
            if not req.url:
                return _bad('sign_in needs a url')
            # needs_owner is carried up so the Orchestrator raises the hand-off
            # card rather than treating a half-finished login as a success.
            data = await _primitives.sign_in(req.url, req.browser)
            return {
                'success': True,
                'data': data,
                'needs_owner': bool(data.get('needs_owner')),
            }

        if req.op == 'download_current':
            return {
                'success': True,
                'data': await _primitives.download_current(req.text, req.browser),
            }

        if req.op == 'record_route':
            global _recording
            if not req.url or not req.goal:
                return _bad('record_route needs a url and a goal')
            session = await _primitives.session(req.browser)
            await session.navigate_to(req.url)
            _recording = RouteRecorder(session, req.url, req.goal)
            await _recording.start()
            return {
                'success': True,
                'data': {
                    'recording': True,
                    'goal': req.goal,
                    'url': req.url,
                    'instruction': (
                        'Click your way to it in the open window. Dex is noting '
                        'what each thing is called. Say when you are there.'
                    ),
                },
                'needs_owner': True,
            }

        if req.op == 'stop_recording':
            if _recording is None:
                return _bad('nothing is being recorded')
            recorder, _recording = _recording, None
            steps = await recorder.stop()
            snap = await _primitives.read(req.browser)
            return {
                'success': True,
                'data': {
                    'goal': recorder.goal,
                    'origin': recorder.origin,
                    'steps': steps,
                    'landed_on': snap.get('url'),
                    'title': snap.get('title'),
                },
            }

        if req.op == 'verify':
            spec = req.verify.model_dump() if req.verify else {}
            return {'success': True, 'data': await _primitives.verify(spec)}

        return _bad(f'unknown primitive op "{req.op}"')

    except PermissionError as err:
        # A refused password field is a hand-off, not a bug. Say so precisely.
        return {'success': False, 'error': str(err), 'retryable': False, 'needs_owner': True}
    except LookupError as err:
        return {'success': False, 'error': str(err), 'retryable': True}
    except Exception as err:  # noqa: BLE001
        log.exception('primitive %s failed', req.op)
        return {'success': False, 'error': f'{type(err).__name__}: {err}', 'retryable': True}


def _bad(message: str) -> dict[str, Any]:
    return {'success': False, 'error': message, 'retryable': False}


# -- entry --------------------------------------------------------------------

if __name__ == '__main__':
    log.info(
        'Browser Agent Server on 127.0.0.1:%s (headless=%s, %s/%s)',
        PORT, HEADLESS, PROVIDER, MODEL,
    )
    if PROVIDER != 'claude-code' and not API_KEY:
        log.warning(
            'No %s key - only the deterministic primitives backend will work', PROVIDER,
        )
    # log_config=None is load-bearing, not tidiness.
    #
    # uvicorn's default logging config attaches StreamHandlers to stdout and
    # stderr. Under pythonw.exe -- which is how these servers run so they have
    # no console window -- both are None, and uvicorn dies the moment it
    # configures logging. The symptom is the worst kind: the line above is
    # written to the log, then nothing, and the port never opens.
    #
    # None means "leave logging alone", so uvicorn inherits the file handler
    # dex_logging already installed.
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning', log_config=None)
