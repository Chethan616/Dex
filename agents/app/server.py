"""
App Agent Server — Tier 2, the UI Automation tier.

Runs on 127.0.0.1:8767, mirroring the Desktop (8765) and Browser (8766) agent
servers. The TypeScript AppAgent talks to it over HTTP.

The only interesting logic here is how failures are classified, because that
classification is what drives Dex's execution ladder:

  WindowNotFound  -> retryable      (the app may still be launching)
  ElementNotFound -> not retryable  (the control genuinely is not there;
                                     candidate names come back so the failure
                                     is readable instead of mysterious)
  NotActionable   -> ESCALATE       (no accessible tree — this step belongs to
                                     the vision tier, and the Orchestrator
                                     re-dispatches it there)
  SecretField     -> needs owner    (a password box; Dex hands off)

Start: python agents/app/server.py
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))   # agents/dex_logging.py

from dex_logging import configure as _configure_logging

# No console under pythonw, so the default stderr handler would raise on
# startup and the file is the only output. See agents/dex_logging.py.
log = _configure_logging('app')

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

import uia_driver as uia
import canvas_driver

PORT = int(os.environ.get('APP_AGENT_PORT', '8767'))

app = FastAPI(title='DEX App Agent', version='0.1.0')


class ActRequest(BaseModel):
    op: str                       # list | click | set_text | set_value | read | toggle | menu | wait | state | find_canvas | draw
    window: str = ''
    name: str | None = None
    control_type: str | None = None
    text: str | None = None
    path: list[str] | None = None
    on: bool | None = None
    value: float | None = None
    strokes: list | None = None
    canvas: dict | None = None
    settle: float = 0.0
    timeout: float = 10.0
    request_id: str = ''
    step_id: str = ''


@app.get('/health')
def health() -> dict[str, Any]:
    try:
        import uiautomation  # noqa: F401
        ready = True
        detail = ''
    except ImportError as exc:
        ready = False
        detail = str(exc)
    return {'status': 'ok' if ready else 'degraded', 'uia': ready, 'detail': detail}


@app.post('/act')
def act(req: ActRequest) -> dict[str, Any]:
    log.info('[%s] %s window=%r name=%r', req.step_id, req.op, req.window, req.name)
    try:
        return {'success': True, 'data': _dispatch(req)}

    except uia.SecretField as exc:
        return {
            'success': False,
            'error': str(exc),
            'retryable': False,
            'needs_owner': True,
        }

    except uia.NotActionable as exc:
        # The defining moment of the middle tier: admit it cannot see, and say
        # which tier can. Failing here would send a solvable task to the owner.
        return {
            'success': False,
            'error': str(exc),
            'retryable': False,
            'escalate': 'can_control_gui',
        }

    except uia.ElementNotFound as exc:
        return {
            'success': False,
            'error': str(exc),
            'retryable': False,
            'candidates': exc.candidates,
        }

    except uia.AmbiguousWindow as exc:
        # Not retryable and not escalatable: retrying re-rolls the same dice and
        # the vision tier would guess too. The plan has to name one window.
        return {
            'success': False,
            'error': str(exc),
            'retryable': False,
            'candidates': exc.titles,
        }

    except uia.WindowNotFound as exc:
        return {'success': False, 'error': str(exc), 'retryable': True}

    except Exception as exc:  # noqa: BLE001
        log.exception('[%s] %s failed', req.step_id, req.op)
        return {
            'success': False,
            'error': f'{type(exc).__name__}: {exc}',
            'retryable': True,
        }


def _dispatch(req: ActRequest) -> Any:
    if req.op == 'list':
        return uia.list_elements(req.window, req.control_type)

    if req.op == 'state':
        return uia.window_state(req.window)

    if req.op == 'click':
        _need(req.name, 'click needs a name')
        return uia.click_element(req.window, req.name, req.control_type)

    if req.op == 'set_text':
        _need(req.name, 'set_text needs a field name')
        return uia.set_text(req.window, req.name, req.text or '')

    if req.op == 'read':
        _need(req.name, 'read needs a name')
        return uia.read_element(req.window, req.name)

    if req.op == 'find_canvas':
        return canvas_driver.find_canvas(req.window)

    if req.op == 'draw':
        if not req.strokes:
            raise ValueError('draw needs strokes')
        return canvas_driver.draw_strokes(
            req.window, req.strokes, req.canvas, req.settle,
        )

    if req.op == 'set_value':
        _need(req.name, 'set_value needs a name')
        if req.value is None:
            raise ValueError('set_value needs a numeric value')
        return uia.set_value(req.window, req.name, float(req.value))

    if req.op == 'toggle':
        _need(req.name, 'toggle needs a name')
        if req.on is None:
            raise ValueError('toggle needs on=true/false')
        return uia.toggle(req.window, req.name, req.on)

    if req.op == 'menu':
        if not req.path:
            raise ValueError('menu needs a path, e.g. ["File","Save As"]')
        return uia.select_menu(req.window, req.path)

    if req.op == 'wait':
        _need(req.name, 'wait needs a name')
        return uia.wait_for(req.window, req.name, req.timeout)

    raise ValueError(f'unknown op "{req.op}"')


def _need(value: str | None, message: str) -> None:
    if not value:
        raise ValueError(message)


if __name__ == '__main__':
    log.info('App Agent Server (UI Automation) on 127.0.0.1:%s', PORT)
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
