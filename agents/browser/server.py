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
from fastapi import FastAPI
from pydantic import BaseModel

from browser_use_backend import DEFAULT_MAX_STEPS, BrowserBackend, env_flag
from primitives import PrimitiveBrowser

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
    wanted = os.environ.get('DEX_BROWSER_PROVIDER', '').lower()

    groq = resolve_credential('groq_api_key', 'GROQ_API_KEY')
    anthropic = resolve_credential('anthropic_api_key', 'ANTHROPIC_API_KEY')

    if wanted == 'anthropic' or (not wanted and not groq and anthropic):
        return 'anthropic', anthropic or ''
    return 'groq', groq or ''


PROVIDER, API_KEY = _pick_provider()
MODEL = os.environ.get('BROWSER_MODEL') or DEFAULT_MODELS.get(PROVIDER, '')
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
    request_id: str = ''
    step_id: str = ''


class ResumeRequest(BaseModel):
    session_id: str


class PrimitiveRequest(BaseModel):
    op: str      # navigate | read | click | type | extract | screenshot | verify
    url: str | None = None
    selector: str | None = None
    text: str | None = None
    path: str | None = None
    full_page: bool | None = None
    verify: VerifySpec | None = None
    browser: str | None = None


# -- routes -------------------------------------------------------------------


@app.get('/health')
def health() -> dict[str, Any]:
    return {
        'status': 'ok',
        'headless': HEADLESS,
        'provider': PROVIDER,
        'model': MODEL,
        'has_api_key': bool(API_KEY),
        'open_sessions': len(_autonomous.runs) if _autonomous else 0,
    }


@app.post('/run-task')
async def run_task(req: RunTaskRequest) -> dict[str, Any]:
    if not API_KEY:
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
        browser=req.browser,
    )


@app.post('/resume')
async def resume(req: ResumeRequest) -> dict[str, Any]:
    log.info('[%s] owner cleared the wall - resuming', req.session_id)
    return await autonomous().resume(req.session_id)


@app.post('/abandon')
async def abandon(req: ResumeRequest) -> dict[str, Any]:
    return {'closed': await autonomous().abandon(req.session_id)}


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
            return {'success': True, 'data': await _primitives.click(req.selector)}

        if req.op == 'type':
            if not req.selector:
                return _bad('type needs a selector')
            return {
                'success': True,
                'data': await _primitives.type_text(req.selector, req.text or ''),
            }

        if req.op == 'extract':
            return {'success': True, 'data': await _primitives.extract(req.selector)}

        if req.op == 'screenshot':
            return {
                'success': True,
                'data': await _primitives.screenshot(
                    req.path, True if req.full_page is None else req.full_page,
                ),
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
    if not API_KEY:
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
