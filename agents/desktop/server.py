"""
Desktop Agent Server — FastAPI process that owns the screen.
Runs as a separate Python process on localhost:8765.
The TypeScript DesktopAgent talks to this via HTTP.

Start: python agents/desktop/server.py
"""
import logging
import os
import sys
from pathlib import Path

# Make sibling modules importable
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))   # agents/dex_logging.py

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent / '.env')

from dex_logging import configure as _configure_logging

# No console under pythonw, so the default stderr handler would raise on
# startup and the file is the only output. See agents/dex_logging.py.
log = _configure_logging('desktop')

import anthropic
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

from grounding import make_grounding
from agent_loop import AgentLoop
from executor import Executor

API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
OLLAMA_ENDPOINT = os.environ.get('OLLAMA_ENDPOINT', 'http://localhost:11434')
PORT = int(os.environ.get('DESKTOP_AGENT_PORT', '8765'))

app = FastAPI(title='DEX Desktop Agent', version='0.1.0')
_executor = Executor()


# ── request / response models ─────────────────────────────────────────────────

class RunTaskRequest(BaseModel):
    task: str
    request_id: str = ''
    step_id: str = ''


class StepRecord(BaseModel):
    step: int
    action_type: str
    reasoning: str


class RunTaskResponse(BaseModel):
    success: bool
    steps: list[StepRecord] = []
    error: str | None = None


# ── routes ────────────────────────────────────────────────────────────────────

@app.get('/health')
def health():
    return {'status': 'ok', 'dpi_scale': _executor.dpi}


@app.post('/run-task', response_model=RunTaskResponse)
def run_task(req: RunTaskRequest):
    log.info(f'[{req.step_id}] Task: {req.task}')

    if not API_KEY:
        return RunTaskResponse(success=False, error='ANTHROPIC_API_KEY not set in .env')

    grounding = make_grounding(API_KEY, OLLAMA_ENDPOINT)
    loop = AgentLoop(API_KEY, grounding)

    steps_log: list[StepRecord] = []

    def on_step(step_num: int, action: dict) -> None:
        steps_log.append(StepRecord(
            step=step_num + 1,
            action_type=action.get('action_type', ''),
            reasoning=action.get('reasoning', ''),
        ))

    result = loop.run(req.task, _executor, on_step=on_step)

    return RunTaskResponse(
        success=result.get('success', False),
        steps=steps_log,
        error=result.get('error'),
    )


@app.post('/screenshot')
def screenshot():
    return {'image_b64': _executor.screenshot_b64()}


# ── entry ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if not API_KEY:
        log.error('ANTHROPIC_API_KEY not set — edit .env before starting')
        sys.exit(1)
    log.info(f'Desktop Agent Server starting on port {PORT}')
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning')
