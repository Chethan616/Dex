"""
The regression test for the bug that made set_dns look like it worked.

netsh reports failure on *stdout*, exits 1, and leaves stderr empty. The old
guard in network_handler was:

    if result.returncode != 0 and result.stderr:
        raise RuntimeError(result.stderr.strip())
    return result.stdout

so that failure was never raised, and the error text came back as the success
payload. `set_dns` reported success while changing nothing, for every run it
has ever had, and the telemetry database recorded those runs as COMPLETED.

Also covers single-instance exclusivity. A named pipe accepts many server
instances under one name by design, so a second daemon does not fail to start --
it joins the rota and requests go to whichever answers first. Seven had
accumulated here. FILE_FLAG_FIRST_PIPE_INSTANCE makes the OS refuse the second
one atomically, on the pipe itself.

Run: python tests/test_daemon_proc.py
"""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'daemon'))

from handlers._proc import CommandFailed, run, try_run  # noqa: E402

failures = []


def check(label: str, condition: bool, detail: str = '') -> None:
    if condition:
        print(f'ok   {label}')
    else:
        failures.append(label)
        print(f'FAIL {label}{": " + detail if detail else ""}')


def py(code: str) -> list:
    return [sys.executable, '-c', code]


def raises(cmd: list):
    """Return the CommandFailed, or None if the call unexpectedly succeeded."""
    try:
        run(cmd)
        return None
    except CommandFailed as err:
        return err


# ── a failure is a failure, whichever stream carried it ──────────────────────

STDOUT_ONLY = py("import sys; print('it went wrong'); sys.exit(1)")

probe = try_run(STDOUT_ONLY)
check('exit code is preserved', probe.returncode == 1)
check('stderr really is empty for this shape', probe.stderr.strip() == '')
check('a non-zero exit does not read as ok', not probe.ok)

err = raises(STDOUT_ONLY)
check(
    'stdout-only failure raises',
    err is not None,
    'this is the exact shape netsh produces, and it used to pass silently',
)
check(
    'the message carries what the process said',
    err is not None and 'it went wrong' in str(err),
    str(err),
)

err = raises(py("import sys; print('bad', file=sys.stderr); sys.exit(2)"))
check('stderr failure raises', err is not None and 'bad' in str(err))

err = raises(py('import sys; sys.exit(3)'))
check(
    'a silent non-zero exit still raises',
    err is not None and '3' in str(err),
    str(err),
)

check('success returns stdout', 'fine' in run(py("print('fine')")))


# ── elevation is named, because every privileged action fails the same way ───

for phrase in (
    'The requested operation requires elevation.',
    'Access is denied.',
    'Run as administrator to continue',
):
    err = raises(py(f'import sys; print({phrase!r}); sys.exit(1)'))
    check(
        f'recognised as an elevation problem: {phrase[:34]!r}',
        err is not None and err.needs_elevation,
    )
    check(
        '  and says how to fix it',
        err is not None and 'install-daemon-service' in str(err),
    )

err = raises(py("import sys; print('no such adapter'); sys.exit(1)"))
check(
    'an ordinary failure does not claim an elevation problem',
    err is not None and not err.needs_elevation,
)


# ── the measurement this fix came from, kept as a test ──────────────────────

netsh = try_run(
    ['netsh', 'interface', 'ipv4', 'show', 'dnsservers', 'name=NoSuchAdapter123'],
)
if netsh.ok:
    print('skip netsh accepted a bogus adapter name on this machine')
else:
    check('netsh fails with a non-zero code', netsh.returncode != 0)
    check(
        'netsh explains itself on stdout, not stderr',
        bool(netsh.stdout.strip()) and not netsh.stderr.strip(),
        f'stdout={netsh.stdout.strip()[:60]!r} stderr={netsh.stderr.strip()[:60]!r}',
    )
    check(
        'the real netsh failure raises',
        raises(['netsh', 'interface', 'ipv4', 'show', 'dnsservers',
                'name=NoSuchAdapter123']) is not None,
    )


# ── one daemon per session ──────────────────────────────────────────────────

daemon_py = ROOT / 'daemon' / 'DexDaemon.py'


def start_daemon():
    return subprocess.Popen(
        [sys.executable, str(daemon_py)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )


def try_start_once():
    """Start a daemon and wait for it to either settle or refuse."""
    return subprocess.run(
        [sys.executable, str(daemon_py)],
        capture_output=True, text=True, timeout=30,
    )


# Works whether or not a daemon is already up: if one is, the second must be
# refused; if not, start one and check the next is refused.
already_running = False
probe = subprocess.Popen(
    [sys.executable, str(daemon_py)],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
time.sleep(2.5)
if probe.poll() is not None:
    already_running = True
    output = probe.stdout.read() if probe.stdout else ''
    check(
        'a second daemon refuses to start',
        probe.returncode == 1,
        f'exit={probe.returncode} {output[:100]}',
    )
    check('and says why', 'already owns' in output, output[:120])
else:
    try:
        second = try_start_once()
        output = second.stdout + second.stderr
        check('a second daemon refuses to start', second.returncode == 1, output[:120])
        check('and says why', 'already owns' in output, output[:120])
    finally:
        probe.kill()
        probe.wait(timeout=10)

if already_running:
    print('note the guard was exercised against a daemon that was already up')


# ── the two properties that make this strict, not merely guarded ────────────

def alive_daemons():
    """Real python processes running DexDaemon.py, parents and children both."""
    listing = subprocess.run(
        ['powershell', '-NoProfile', '-Command',
         "(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' "
         "-and $_.CommandLine -match 'DexDaemon' }).Count"],
        capture_output=True, text=True, timeout=30,
    ).stdout.strip()
    return int(listing or 0)


def stop_all():
    subprocess.run(
        ['powershell', '-NoProfile', '-File',
         str(ROOT / 'scripts' / 'stop-dex.ps1'), '-Quiet'],
        capture_output=True, text=True, timeout=60,
    )
    time.sleep(0.6)


stop_all()

# Racing start: two launched at the same instant. A mutex checked-then-set would
# let both through; claiming the pipe is atomic, so exactly one can win.
racers = [start_daemon() for _ in range(4)]
time.sleep(4)
survivors = [r for r in racers if r.poll() is None]
refused = [r for r in racers if r.poll() == 1]
check(
    'exactly one of four simultaneous starts survives',
    len(survivors) == 1,
    f'{len(survivors)} survived, {len(refused)} refused',
)
check(
    'every loser exits non-zero rather than lingering',
    len(refused) == 3,
    f'{len(refused)} of 3 refused',
)
for r in survivors + refused:
    if r.poll() is None:
        r.kill()
    r.wait(timeout=10)

# No claim can outlive the process that made it. Windows destroys a process's
# pipe instances when it dies, so a daemon killed mid-flight -- which is how the
# seven strays were made -- cannot block the next one from starting.
stop_all()
victim = start_daemon()
time.sleep(2.5)
check('a daemon starts cleanly after the field is cleared', victim.poll() is None)
victim.kill()
victim.wait(timeout=10)
stop_all()
time.sleep(1.0)

replacement = start_daemon()
time.sleep(2.5)
check(
    'a killed daemon leaves no claim behind',
    replacement.poll() is None,
    'the replacement was refused, so something stale is still holding the pipe',
)
replacement.kill()
replacement.wait(timeout=10)
stop_all()

check('the field is empty afterwards', alive_daemons() == 0, f'{alive_daemons()} left')


print()
print(f'{"FAILED" if failures else "PASSED"} — {len(failures)} failure(s)')
sys.exit(1 if failures else 0)
