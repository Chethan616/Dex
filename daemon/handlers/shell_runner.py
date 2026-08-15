import subprocess
import logging
import os

log = logging.getLogger('ShellRunner')

# Read-only, non-destructive commands only
ALLOWED = {
    'ipconfig', 'netsh', 'powercfg', 'tasklist',
    'systeminfo', 'whoami', 'hostname',
}


class ShellRunner:

    @staticmethod
    def run(params: dict) -> dict:
        command = params.get('command', [])
        if isinstance(command, str):
            command = command.split()
        if not command:
            raise ValueError('No command provided')

        base = os.path.basename(command[0]).lower()
        if base.endswith('.exe'):
            base = base[:-4]
        if base not in ALLOWED:
            raise PermissionError(
                f'"{base}" is not in the shell allowlist: {sorted(ALLOWED)}'
            )

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            'stdout':     result.stdout,
            'stderr':     result.stderr,
            'returncode': result.returncode,
        }
