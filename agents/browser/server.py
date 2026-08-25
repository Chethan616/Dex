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

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
)
log = logging.getLogger('BrowserServer')

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

from browser_use_backend import DEFAULT_MAX_STEPS, BrowserBackend, env_flag
from primitives import PrimitiveBrowser

API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
MODEL = os.environ.get('BROWSER_MODEL', 'claude-sonnet-4-6')
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
        _autonomous = BrowserBackend(api_key=API_KEY, model=MODEL, headless=HEADLESS)
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
    request_id: str = ''
    step_id: str = ''


class ResumeRequest(BaseModel):
    session_id: str


class PrimitiveRequest(BaseModel):
    op: str                       # navigate | read | click | type | extract | verify
    url: str | None = None
    selector: str | None = None
    text: str | None = None
    verify: VerifySpec | None = None


# -- routes -------------------------------------------------------------------


@app.get('/health')
def health() -> dict[str, Any]:
    return {
        'status': 'ok',
        'headless': HEADLESS,
        'model': MODEL,
        'has_api_key': bool(API_KEY),
        'open_sessions': len(_autonomous.runs) if _autonomous else 0,
    }


@app.post('/run-task')
async def run_task(req: RunTaskRequest) -> dict[str, Any]:
    if not API_KEY:
        return {
            'success': False,
            'error': 'ANTHROPIC_API_KEY not set in .env',
            'retryable': False,
        }
    log.info('[%s] task: %s', req.step_id, req.task)
    return await autonomous().start_task(
        task=req.task,
        start_url=req.start_url,
        max_steps=req.max_steps,
        verify=req.verify.model_dump() if req.verify else None,
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
            return {'success': True, 'data': await _primitives.navigate(req.url)}

        if req.op == 'read':
            return {'success': True, 'data': await _primitives.read()}

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
    log.info('Browser Agent Server on 127.0.0.1:%s (headless=%s)', PORT, HEADLESS)
    if not API_KEY:
        log.warning('ANTHROPIC_API_KEY not set - only the primitives backend will work')
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning')
