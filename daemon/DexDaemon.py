"""
DEX V3 — Privileged Daemon
Runs as an elevated process (or Windows Service in production).
Accepts JSON commands over a named pipe, dispatches to handlers.
"""
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers.network_handler import NetworkHandler
from handlers.power_handler import PowerHandler
from handlers.registry_handler import RegistryHandler
from handlers.shell_runner import ShellRunner

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s — %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('DexDaemon')

PIPE_NAME = r'\\.\pipe\dex_privileged_daemon'

DISPATCH = {
    'set_dns':         NetworkHandler.set_dns,
    'get_dns':         NetworkHandler.get_dns,
    'set_wifi':        NetworkHandler.set_wifi,
    'get_wifi_status': NetworkHandler.get_wifi_status,
    'set_power_plan':  PowerHandler.set_power_plan,
    'get_power_plan':  PowerHandler.get_power_plan,
    'registry_read':   RegistryHandler.read,
    'registry_write':  RegistryHandler.write,
    'run_shell':       ShellRunner.run,
}


def handle(msg: dict) -> dict:
    msg_id = msg.get('id', 'unknown')
    action = msg.get('action', '')
    params = msg.get('params') or {}

    handler = DISPATCH.get(action)
    if handler is None:
        return {'id': msg_id, 'success': False, 'error': f'Unknown action: {action}'}

    try:
        data = handler(params)
        return {'id': msg_id, 'success': True, 'data': data}
    except Exception as exc:
        log.exception(f'Handler "{action}" raised: {exc}')
        return {'id': msg_id, 'success': False, 'error': str(exc)}


def serve():
    try:
        import win32pipe
        import win32file
        import pywintypes
    except ImportError:
        log.error('pywin32 not installed. Run: pip install pywin32')
        sys.exit(1)

    log.info(f'Listening on {PIPE_NAME}')

    while True:
        pipe = win32pipe.CreateNamedPipe(
            PIPE_NAME,
            win32pipe.PIPE_ACCESS_DUPLEX,
            win32pipe.PIPE_TYPE_BYTE | win32pipe.PIPE_READMODE_BYTE | win32pipe.PIPE_WAIT,
            win32pipe.PIPE_UNLIMITED_INSTANCES,
            65536,
            65536,
            0,
            None,  # TODO production: restrict DACL to admin + SYSTEM only
        )

        try:
            win32pipe.ConnectNamedPipe(pipe, None)
            log.info('Client connected')
            _serve_client(pipe, win32file, pywintypes)
        finally:
            win32file.CloseHandle(pipe)


def _serve_client(pipe, win32file, pywintypes):
    buf = b''
    while True:
        try:
            _, data = win32file.ReadFile(pipe, 65536)
            buf += data

            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    log.info(f'→ {msg.get("action")} id={msg.get("id")}')
                    resp = handle(msg)
                    payload = (json.dumps(resp) + '\n').encode('utf-8')
                    win32file.WriteFile(pipe, payload)
                    log.info(f'← success={resp.get("success")}')
                except json.JSONDecodeError as exc:
                    log.warning(f'Bad JSON from client: {exc}')

        except pywintypes.error as exc:
            code = exc.args[0]
            if code in (109, 232):  # ERROR_BROKEN_PIPE, ERROR_NO_DATA
                log.info('Client disconnected')
            else:
                log.error(f'Pipe error {code}: {exc}')
            break


if __name__ == '__main__':
    log.info('DEX Daemon starting...')
    try:
        serve()
    except KeyboardInterrupt:
        log.info('Daemon stopped')
