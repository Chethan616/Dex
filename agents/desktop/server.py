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

from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

from grounding import make_grounding
from agent_loop import AgentLoop
from computer import Computer
from worker_providers import make_worker

API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
OLLAMA_ENDPOINT = os.environ.get('OLLAMA_ENDPOINT', 'http://localhost:11434')
PORT = int(os.environ.get('DESKTOP_AGENT_PORT', '8765'))

app = FastAPI(title='DEX Desktop Agent', version='0.1.0')
_executor = Computer()


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
    try:
        worker_name = make_worker(API_KEY).name
    except RuntimeError as err:
        worker_name = f'unavailable: {err}'
    return {'status': 'ok', 'dpi_scale': _executor.dpi, 'worker': worker_name}


@app.post('/run-task', response_model=RunTaskResponse)
async def run_task(req: RunTaskRequest):
    log.info(f'[{req.step_id}] Task: {req.task}')

    try:
        worker = make_worker(API_KEY)
    except RuntimeError as err:
        return RunTaskResponse(success=False, error=str(err))

    grounding = make_grounding(API_KEY, OLLAMA_ENDPOINT)
    loop = AgentLoop(worker, grounding)
    log.info(f'Worker: {worker.name}')

    steps_log: list[StepRecord] = []

    def on_step(step_num: int, action: dict) -> None:
        steps_log.append(StepRecord(
            step=step_num + 1,
            action_type=action.get('action_type', ''),
            reasoning=action.get('reasoning', ''),
        ))

    result = await loop.run(req.task, _executor, on_step=on_step)

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
    import shutil
    has_groq = bool(os.environ.get('GROQ_API_KEY', '').strip())
    has_claude_code = shutil.which('claude') is not None
    has_anthropic = bool(API_KEY)
    if not (has_groq or has_claude_code or has_anthropic):
        log.error(
            'No vision-capable Worker provider available — set GROQ_API_KEY, '
            'ANTHROPIC_API_KEY, or install the claude CLI before starting.'
        )
        sys.exit(1)
    log.info(f'Desktop Agent Server starting on port {PORT}')
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
