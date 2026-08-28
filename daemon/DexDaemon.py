"""
DEX V3 — Privileged Daemon
Runs as an elevated process (or Windows Service in production).
Accepts JSON commands over a named pipe, dispatches to handlers.
"""
import json
import logging
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers.app_handler import AppHandler
from handlers.audio_handler import AudioHandler
from handlers.network_handler import NetworkHandler
from handlers.power_handler import PowerHandler
from handlers.process_handler import ProcessHandler
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
    'set_dns':          NetworkHandler.set_dns,
    'get_dns':          NetworkHandler.get_dns,
    'set_wifi':         NetworkHandler.set_wifi,
    'get_wifi_status':  NetworkHandler.get_wifi_status,
    'set_power_plan':   PowerHandler.set_power_plan,
    'get_power_plan':   PowerHandler.get_power_plan,
    'registry_read':    RegistryHandler.read,
    'registry_write':   RegistryHandler.write,
    'registry_classify': RegistryHandler.classify,
    'run_shell':        ShellRunner.run,
    'get_volume':       AudioHandler.get_volume,
    'set_volume':       AudioHandler.set_volume,
    'set_mute':         AudioHandler.set_mute,
    'list_processes':   ProcessHandler.list_processes,
    'kill_process':     ProcessHandler.kill_process,
    'launch_app':       AppHandler.launch_app,
    'close_app':        AppHandler.close_app,
}


def _describe(_params: dict) -> dict:
    """
    What this daemon can actually do.

    Exists to kill a whole class of bug: the Brain's prompt advertises an action
    list, the dispatch table implements one, and the two were maintained by hand
    in separate files. They drifted -- the planner offered set_volume and
    friends that the daemon had never heard of, so the Brain confidently planned
    steps that came back "Unknown action" mid-task. Now the daemon is the single
    source of truth and the core checks itself against it at startup.
    """
    return {
        'actions': sorted(DISPATCH.keys()),
        'version': '0.3.0',
        **_privilege(),
    }


def _privilege() -> dict:
    """
    Whether this daemon can actually do the privileged half of its job.

    Two separate facts, and both matter:

      elevated    netsh, powercfg and HKLM writes need it. Without it they fail,
                  and until recently they failed *silently* -- see
                  handlers/_proc.py for how that happened.

      session_id  0 means this is running as a service, isolated from the
                  desktop since Vista. In session 0 the audio endpoint is not
                  the owner's and a launched app appears on a desktop nobody is
                  looking at -- so a daemon can be perfectly elevated and still
                  unable to set the volume. That is a miserable thing to debug
                  from the outside, so it is reported rather than inferred.
    """
    elevated = False
    session = None
    try:
        import ctypes
        elevated = bool(ctypes.windll.shell32.IsUserAnAdmin())
        pid = ctypes.windll.kernel32.GetCurrentProcessId()
        out = ctypes.c_ulong()
        if ctypes.windll.kernel32.ProcessIdToSessionId(pid, ctypes.byref(out)):
            session = int(out.value)
    except Exception:  # noqa: BLE001 - a daemon that cannot introspect still serves
        pass

    return {'elevated': elevated, 'session_id': session}


DISPATCH['describe'] = _describe


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

    # One thread per connection, and the next pipe instance is created before
    # the current one is served.
    #
    # This loop used to run the client inline: create instance, accept, serve
    # until disconnect, close, create the next one. Between the close and the
    # next create there is no instance listening at all, so a client connecting
    # in that window gets ERROR_FILE_NOT_FOUND -- which the System Agent
    # reports, accurately but misleadingly, as "Daemon not running".
    #
    # Every step of a plan opens its own connection, so a two-step task races
    # this window every time. It is the second half of "it works, then it
    # doesn't, with nothing changed in between"; the first half was several
    # daemons sharing the pipe. Measured: nine of seventeen conformance probes
    # failed this way on a serial loop, none on this one.
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

        win32pipe.ConnectNamedPipe(pipe, None)
        log.info('Client connected')

        worker = threading.Thread(
            target=_handle_connection,
            args=(pipe, win32file, pywintypes),
            daemon=True,
        )
        worker.start()


def _handle_connection(pipe, win32file, pywintypes):
    try:
        _serve_client(pipe, win32file, pywintypes)
    except Exception:  # noqa: BLE001 - one bad client must not take the daemon down
        log.exception('Connection handler crashed')
    finally:
        try:
            win32file.CloseHandle(pipe)
        except Exception:  # noqa: BLE001
            pass


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


_SINGLETON_HANDLE = None


def claim_single_instance() -> bool:
    """
    Refuse to start when a daemon is already serving this session.

    Windows named pipes allow many *server* instances under one name, so a
    second daemon does not fail to bind the way a TCP listener would — it
    quietly joins the rota, and each client connection is handed to whichever
    instance happens to be free.

    Seven of these had accumulated on the development machine, left behind by
    previous `run-dev.ps1` runs, several of them running weeks-old handler code.
    Requests were served by whichever answered first, so the same command worked
    and then did not with nothing having changed in between. That is close to
    undebuggable from the outside, and it is exactly the sort of failure the
    owner reports as "it just doesn't work sometimes".

    Local\\ rather than Global\\ because the scope that matters is the session:
    one daemon per logged-in desktop.
    """
    global _SINGLETON_HANDLE
    import ctypes

    ERROR_ALREADY_EXISTS = 183
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, 'Local\\DexDaemonSingleton')
    if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        return False

    # Held for the life of the process. Dropping it would release the claim.
    _SINGLETON_HANDLE = handle
    return True


if __name__ == '__main__':
    if not claim_single_instance():
        log.error(
            'Another DEX daemon is already serving this session. Two daemons on '
            'one pipe answer requests unpredictably — often with different code. '
            'Stop the running one first:  scripts/stop-dex.ps1'
        )
        sys.exit(1)

    log.info('DEX Daemon starting...')
    try:
        serve()
    except KeyboardInterrupt:
        log.info('Daemon stopped')
