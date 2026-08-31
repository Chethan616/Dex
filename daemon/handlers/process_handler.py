"""
Processes — Tier 1.

Listing and ending processes through the OS rather than by driving Task
Manager's UI. Killing something is irreversible from Dex's point of view, so the
guards here are deliberately strict: a name must match exactly one process
unless the caller says otherwise, and a small set of processes are refused
outright.
"""
from __future__ import annotations

import logging
import subprocess

from ._proc import NO_WINDOW, try_run

log = logging.getLogger('ProcessHandler')

# Ending any of these takes the desktop down with it. There is no plausible
# owner request that is better served by killing one of these than by saying no.
PROTECTED = {
    'system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe',
    'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'svchost.exe',
    'dwm.exe', 'explorer.exe', 'memory compression',
    # Dex's own moving parts — killing these mid-task ends the task reporting it.
    'python.exe', 'node.exe',
}


def _tasklist() -> list[dict]:
    output = subprocess.run(
        ['tasklist', '/fo', 'csv', '/nh'],
        capture_output=True, text=True, timeout=15,
        creationflags=NO_WINDOW,
    ).stdout

    processes = []
    for line in output.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) < 5:
            continue
        name = parts[0].strip('"')
        try:
            pid = int(parts[1])
        except ValueError:
            continue
        mem = parts[4].strip('"').replace(' K', '').replace(',', '')
        processes.append({
            'name': name,
            'pid': pid,
            'memory_kb': int(mem) if mem.isdigit() else 0,
        })
    return processes


class ProcessHandler:

    @staticmethod
    def list_processes(params: dict) -> dict:
        processes = _tasklist()
        needle = (params.get('name') or '').lower()
        if needle:
            processes = [p for p in processes if needle in p['name'].lower()]

        # Heaviest first: "what's eating my RAM" is the common question.
        processes.sort(key=lambda p: p['memory_kb'], reverse=True)
        limit = int(params.get('limit', 40))
        return {'count': len(processes), 'processes': processes[:limit]}

    @staticmethod
    def kill_process(params: dict) -> dict:
        name = (params.get('name') or '').strip()
        pid = params.get('pid')

        if not name and pid is None:
            raise ValueError('kill_process needs a name or a pid')

        if name and name.lower() in PROTECTED:
            raise PermissionError(
                f'"{name}" is a protected system process and will not be ended'
            )

        if pid is None:
            matches = [
                p for p in _tasklist()
                if p['name'].lower() == name.lower()
                or p['name'].lower() == f'{name.lower()}.exe'
            ]
            if not matches:
                raise ValueError(f'No running process named "{name}"')
            # Ambiguity is the owner's to resolve. Picking one at random and
            # calling it done is how the wrong browser window dies.
            if len(matches) > 1 and not params.get('all'):
                pids = ', '.join(str(m['pid']) for m in matches[:10])
                raise ValueError(
                    f'{len(matches)} processes named "{name}" (pids: {pids}). '
                    'Pass a specific pid, or all=true to end every one.'
                )
            targets = [m['pid'] for m in matches]
        else:
            targets = [int(pid)]

        ended, failed, reasons = [], [], []
        for target in targets:
            result = try_run(['taskkill', '/PID', str(target), '/F'])
            if result.ok:
                ended.append(target)
            else:
                failed.append(target)
                reasons.append(f'{target}: {result.message}')

        if not ended:
            # Say what taskkill said. The old message guessed "it may need
            # higher privileges" for every failure, which sent the reader after
            # elevation when the real answer was usually that the process had
            # already exited.
            raise RuntimeError(f'Could not end {failed} — {"; ".join(reasons)}')

        log.info('Ended pids %s', ended)
        return {'ended': ended, 'failed': failed}
