"""
DEX Daemon — Windows Service wrapper.

Install (one-time, run as Administrator):
    python daemon/daemon_service.py install
    python daemon/daemon_service.py start

Uninstall:
    python daemon/daemon_service.py stop
    python daemon/daemon_service.py remove

After install the service auto-starts on every Windows boot — no admin prompts ever again.
"""
import sys
import socket
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def _import_service_deps():
    try:
        import win32service
        import win32serviceutil
        import win32event
        import servicemanager
        return win32service, win32serviceutil, win32event, servicemanager
    except ImportError:
        print('ERROR: pywin32 not installed. Run: pip install pywin32', file=sys.stderr)
        sys.exit(1)


class DexDaemonService:
    """Defined at module level so win32serviceutil can find it."""

    _svc_name_ = 'DexDaemon'
    _svc_display_name_ = 'DEX Privileged Daemon'
    _svc_description_ = (
        'DEX V3 system automation daemon — DNS, registry, power, audio, and OS control. '
        'Runs as LocalSystem so DEX never needs a UAC prompt after setup.'
    )

    def __init__(self, args):
        _, win32serviceutil, win32event, _ = _import_service_deps()
        win32serviceutil.ServiceFramework.__init__(self, args)
        self._stop_event = win32event.CreateEvent(None, 0, 0, None)
        socket.setdefaulttimeout(60)

    def SvcStop(self):
        _, _, win32event, _ = _import_service_deps()
        self.ReportServiceStatus(1)  # SERVICE_STOP_PENDING
        win32event.SetEvent(self._stop_event)

    def SvcDoRun(self):
        _, _, _, servicemanager = _import_service_deps()
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ''),
        )
        # Import here so the module path is resolved correctly at service runtime
        from DexDaemon import serve
        serve()


# Wire the class into win32serviceutil's ServiceFramework inheritance at import time.
# This must happen at module scope for the service dispatcher to find it.
try:
    import win32serviceutil
    DexDaemonService.__bases__ = (win32serviceutil.ServiceFramework,)
except ImportError:
    pass  # handled at runtime


if __name__ == '__main__':
    win32service, win32serviceutil, win32event, servicemanager = _import_service_deps()

    if len(sys.argv) == 1:
        # Running as a service (dispatched by SCM)
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(DexDaemonService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        # CLI: install / start / stop / remove
        win32serviceutil.HandleCommandLine(DexDaemonService)
