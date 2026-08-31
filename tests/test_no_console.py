"""
No child process may put a console on the owner's desktop.

    npm run test:no-console

This is a static check over the source rather than a runtime one, because the
failure it guards against is invisible in development and obvious in
production, which is the worst way round.

Here is the mechanism. The daemon and the agents run under ``pythonw.exe`` --
the GUI-subsystem build of Python, which has **no console at all**. When a
process with no console starts a console program, Windows gives the child a
brand new console, and a new console is a visible black rectangle. So every
``netsh``, every ``tasklist``, every DPAPI decrypt flashes a window in the
middle of whatever the owner is doing.

During development none of this shows, because the daemon is started from a
terminal and its children quietly inherit that terminal's console. It appears
only once Dex starts itself with no terminal anywhere -- which is precisely the
configuration nobody is watching a log in.

It was found exactly that way: the app was launched, the desktop was watched
for sixty seconds, and a PowerShell window appeared. Fixing the four call sites
by hand would leave the fifth one, written next month, to be found the same
way. So instead every call site is checked here, and adding one without the
flag fails the build.

The escape hatch is ``# noqa: console`` on the call, for the genuinely rare
case where a visible console is the point.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Where windowless code lives. Anything started from here may be running under
# pythonw with no console to inherit.
SEARCHED = ['daemon', 'agents']

# The calls that start a process. ``os.startfile`` is deliberately absent: it
# hands the path to the shell, which applies the file's own association, and a
# document opening in its own application is not a console.
SPAWNERS = {'run', 'Popen', 'call', 'check_call', 'check_output'}

# Either flag suppresses the window. DETACHED_PROCESS is used where the child
# is meant to outlive us and own nothing of ours.
ACCEPTABLE = ('CREATE_NO_WINDOW', 'NO_WINDOW', 'DETACHED_PROCESS')

failures: list[str] = []
checked = 0


def is_subprocess_call(node: ast.Call) -> bool:
    """``subprocess.run(...)`` or a bare ``run(...)`` imported from it."""
    func = node.func
    if isinstance(func, ast.Attribute) and func.attr in SPAWNERS:
        return isinstance(func.value, ast.Name) and func.value.id == 'subprocess'
    return False


def flag_source(node: ast.Call) -> str | None:
    for keyword in node.keywords:
        if keyword.arg == 'creationflags':
            return ast.unparse(keyword.value)
    return None


for folder in SEARCHED:
    for path in sorted((ROOT / folder).rglob('*.py')):
        source = path.read_text(encoding='utf-8')
        lines = source.splitlines()
        try:
            tree = ast.parse(source)
        except SyntaxError as err:  # a file that will not parse is its own failure
            failures.append(f'{path.relative_to(ROOT)}: does not parse -- {err}')
            continue

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not is_subprocess_call(node):
                continue

            line = lines[node.lineno - 1] if node.lineno <= len(lines) else ''
            if 'noqa: console' in line:
                continue

            checked += 1
            flags = flag_source(node)
            where = f'{path.relative_to(ROOT)}:{node.lineno}'

            if flags is None:
                failures.append(
                    f'{where}: subprocess call with no creationflags. Under '
                    f'pythonw this opens a visible console window.'
                )
            elif not any(name in flags for name in ACCEPTABLE):
                failures.append(
                    f'{where}: creationflags={flags} does not suppress the '
                    f'console window. Add CREATE_NO_WINDOW.'
                )

print(f'Checked {checked} subprocess call(s) across {", ".join(SEARCHED)}/\n')

if failures:
    for failure in failures:
        print(f'FAIL {failure}')
    print(f'\n{len(failures)} call(s) would show a console window.')
    sys.exit(1)

# A check that finds nothing to check has stopped being a check. This has caught
# a real bug once already; if the call sites move somewhere this does not look,
# it should say so rather than pass silently.
if checked == 0:
    print('FAIL no subprocess calls were found at all -- has the layout moved?')
    sys.exit(1)

print('PASSED  every subprocess call suppresses its console window.')
