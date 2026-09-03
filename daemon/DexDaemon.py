"""
DEX V3 — Privileged Daemon
Runs as an elevated process (or Windows Service in production).
Accepts JSON commands over a named pipe, dispatches to handlers.
"""
import json
import logging
import os
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers.app_handler import AppHandler
from handlers.audio_handler import AudioHandler
from handlers.network_handler import NetworkHandler
from handlers.power_handler import PowerHandler
from handlers.process_handler import ProcessHandler
from handlers.registry_handler import RegistryHandler
from handlers.shell_runner import ShellRunner
from handlers.clipboard_handler import ClipboardHandler
from handlers.env_handler import EnvHandler
from handlers.display_handler import DisplayHandler
from handlers.screen_handler import ScreenHandler
from handlers.backlight_handler import BacklightHandler
from handlers.program_handler import ProgramHandler

def _log_handlers() -> list:
    """
    Console when there is one, and always a file.

    Started from a terminal the daemon's output is right there. Started by the
    logon task it has nowhere to go at all, so a daemon that dies on startup
    dies silently and the only symptom anywhere is "Daemon not running" from a
    client that cannot see why. A background process with no log is a process
    you cannot debug.

    **The stdout check is load-bearing.** The daemon runs under `pythonw.exe` so
    that it has no console window, and pythonw sets `sys.stdout` to None.
    `logging.StreamHandler(None)` falls back to stderr, which is also None, and
    raises while this module is still being imported — a daemon that dies before
    it can write the log that would have explained why. The file handler exists
    precisely so there is somewhere to look when there is no console, so it must
    not depend on there being one.
    """
    handlers: list = []
    if sys.stdout is not None:
        handlers.append(logging.StreamHandler(sys.stdout))

    base = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
    log_dir = Path(base) / 'DEX'
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        handlers.append(
            RotatingFileHandler(
                log_dir / 'daemon.log', maxBytes=1_000_000, backupCount=2,
                encoding='utf-8',
            )
        )
    except OSError:
        # A daemon that cannot open its log still has a job to do.
        pass

    return handlers


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
    handlers=_log_handlers(),
)
log = logging.getLogger('DexDaemon')
log.info('Log file: %s', Path(
    os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData' / 'Local'
) / 'DEX' / 'daemon.log')

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
    'run_command':      ShellRunner.run_command,
    'classify_command': ShellRunner.classify_command,
    'get_env':          EnvHandler.get_env,
    'set_env':          EnvHandler.set_env,
    'clipboard_read':   ClipboardHandler.clipboard_read,
    'clipboard_write':  ClipboardHandler.clipboard_write,
    'get_display':      DisplayHandler.get_display,
    'set_display':      DisplayHandler.set_display,
    'get_brightness':   DisplayHandler.get_brightness,
    'set_brightness':   DisplayHandler.set_brightness,
    'get_volume':       AudioHandler.get_volume,
    'set_volume':       AudioHandler.set_volume,
    'set_mute':         AudioHandler.set_mute,
    'list_processes':   ProcessHandler.list_processes,
    'kill_process':     ProcessHandler.kill_process,
    'launch_app':       AppHandler.launch_app,
    'close_app':        AppHandler.close_app,
    'capture_screen':   ScreenHandler.capture,
    'find_program':     ProgramHandler.find_program,
    'get_keyboard_backlight': BacklightHandler.get_keyboard_backlight,
    'set_keyboard_backlight': BacklightHandler.set_keyboard_backlight,
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

    return {
        'elevated': elevated,
        'session_id': session,
        # What this daemon will actually do, so one call answers "what mode am
        # I in" instead of the core inferring it from its own config and being
        # wrong whenever the two disagree.
        'full_access': _flag('DEX_FULL_ACCESS') or _flag('FULL_ACCESS'),
        'allow_red': _flag('DEX_ALLOW_RED'),
    }


def _flag(name: str) -> bool:
    return os.environ.get(name, '').strip().lower() == 'true'


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


def _pipe_security():
    """
    An explicit DACL on the pipe: the owner, SYSTEM, Administrators. Nobody else.

    Two reasons this is not optional.

    Security: SAFETY.md requires the pipe to carry an explicit DACL, because
    anything that can open it can ask the daemon to change DNS or write the
    registry. Passing None inherits the creating token's default, which is not a
    decision anyone made.

    Function: the default DACL on a pipe created by an *elevated* process does
    not admit the same user's ordinary, medium-integrity processes. So the
    moment the daemon started running elevated -- the whole point of Full Access
    -- the unelevated core could no longer talk to it, and got ACCESS_DENIED
    reported as "Daemon not running". Naming the owner's own SID is what makes
    an elevated daemon usable by the desktop it serves.

    Returns None if the security machinery is unavailable, which is not worth
    refusing to start over on a machine where nothing else works either.
    """
    try:
        import ntsecuritycon
        import win32api
        import win32security
    except ImportError:  # pragma: no cover
        log.warning('pywin32 security modules missing — pipe uses the default DACL')
        return None

    token = win32security.OpenProcessToken(
        win32api.GetCurrentProcess(), win32security.TOKEN_QUERY,
    )
    owner_sid = win32security.GetTokenInformation(token, win32security.TokenUser)[0]

    dacl = win32security.ACL()
    for sid in (
        owner_sid,
        win32security.CreateWellKnownSid(win32security.WinLocalSystemSid),
        win32security.CreateWellKnownSid(win32security.WinBuiltinAdministratorsSid),
    ):
        dacl.AddAccessAllowedAce(
            win32security.ACL_REVISION, ntsecuritycon.FILE_ALL_ACCESS, sid,
        )

    descriptor = win32security.SECURITY_DESCRIPTOR()
    # (present=1, dacl, defaulted=0) — an empty-but-present DACL denies everyone,
    # so this must be the populated one.
    descriptor.SetSecurityDescriptorDacl(1, dacl, 0)

    attributes = win32security.SECURITY_ATTRIBUTES()
    attributes.SECURITY_DESCRIPTOR = descriptor
    log.info(
        'Pipe DACL: owner %s, SYSTEM, Administrators',
        win32security.ConvertSidToStringSid(owner_sid),
    )
    return attributes


def serve():
    try:
        import win32pipe
        import win32file
        import pywintypes
        import winerror
    except ImportError:
        log.error('pywin32 not installed. Run: pip install pywin32')
        sys.exit(1)

    # Exclusivity is enforced by the operating system, on the thing actually
    # being contended.
    #
    # A named pipe accepts many *server* instances under one name by design, so
    # a second daemon does not fail to start -- it joins the rota and Windows
    # hands each client connection to whichever instance is free. Seven had
    # accumulated on the development machine from previous runs, several of them
    # executing weeks-old handler code, and a request was served by whichever
    # answered first. The same command worked, then did not, with nothing having
    # changed in between.
    #
    # FILE_FLAG_FIRST_PIPE_INSTANCE is the exact primitive for this: the create
    # succeeds only if no instance of this pipe exists, and fails with
    # ERROR_ACCESS_DENIED otherwise. It is atomic, so two daemons launched at the
    # same instant cannot both win, and it needs no cleanup -- Windows destroys
    # a process's pipe instances when it dies, so a crashed daemon cannot leave
    # a claim behind that blocks the next one.
    #
    # A mutex was tried first and is strictly worse: advisory, held beside the
    # resource rather than on it, and one more thing to keep in step.
    first = True
    security = _pipe_security()

    while True:
        mode = win32pipe.PIPE_ACCESS_DUPLEX
        if first:
            mode |= win32pipe.FILE_FLAG_FIRST_PIPE_INSTANCE

        try:
            pipe = win32pipe.CreateNamedPipe(
                PIPE_NAME,
                mode,
                win32pipe.PIPE_TYPE_BYTE | win32pipe.PIPE_READMODE_BYTE | win32pipe.PIPE_WAIT,
                win32pipe.PIPE_UNLIMITED_INSTANCES,
                65536,
                65536,
                0,
                security,
            )
        except pywintypes.error as exc:
            if first and exc.winerror == winerror.ERROR_ACCESS_DENIED:
                log.error(
                    'Another DEX daemon already owns %s. Two daemons on one pipe '
                    'answer requests unpredictably, often with different code. '
                    'Stop the running one first:  scripts/stop-dex.ps1',
                    PIPE_NAME,
                )
                sys.exit(1)
            raise

        if first:
            log.info(f'Listening on {PIPE_NAME}')
            first = False

        # Accept, hand off, and immediately create the next instance.
        #
        # This loop used to serve the client inline and only create the next
        # instance afterwards, so between one client disconnecting and the next
        # instance existing there was no listener at all. Every step of a plan
        # opens its own connection, so a multi-step task raced that window on
        # each step and got ERROR_FILE_NOT_FOUND, which the System Agent
        # reports -- accurately but misleadingly -- as "Daemon not running".
        # Measured: nine of seventeen conformance probes failed that way.
        win32pipe.ConnectNamedPipe(pipe, None)
        log.info('Client connected')

        threading.Thread(
            target=_handle_connection,
            args=(pipe, win32file, pywintypes),
            daemon=True,
        ).start()


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


if __name__ == '__main__':
    log.info('DEX Daemon starting...')
    try:
        serve()
    except KeyboardInterrupt:
        log.info('Daemon stopped')
