"""
Which commands Dex may run, and which it must ask about first.

Deliberately the same shape as `registry_handler.classify_write` — three bands,
one `DEX_ALLOW_*` escape hatch, and the same division of responsibility:

    elevation decides WHO gets asked.
    the band decides WHAT is possible at all.

That division is why Full Access does not reach into here. Turning off the
confirmation prompts and unlocking `diskpart` should not be the same gesture,
any more than they are for the registry.

    GREEN  runs silently. Reading things. `git status`, `Get-FileHash`,
           `netstat`, `rg`, a compiler being asked its version.
    AMBER  runs after the owner confirms — silently under Full Access. Anything
           that changes state but can be undone or noticed: `git commit`,
           `npm install`, a compiler, `mkdir`, setting an environment variable.
    RED    is refused. Reachable only with DEX_ALLOW_SHELL_RED set by hand, and
           even then it always raises a confirmation card. Partitioning,
           account management, boot configuration, shutting the machine down.

Two rules that decide whether this is a real boundary or a decoration:

**Unknown means AMBER, never GREEN.** A classifier that permits what it does not
recognise fails open, and the thing on the other side of it is a planner that
reads web pages. An unrecognised command is a command nobody has thought about.

**PowerShell is judged by what it calls.** Blocking `powershell.exe` would
achieve nothing — it is the shell every one of these use cases needs — so the
arguments are scanned instead. Anything that defeats scanning is RED on sight:
`Invoke-Expression`, `-EncodedCommand`, a download piped into the shell. Those
are not commands, they are ways of not saying what the command is.
"""
from __future__ import annotations

import os
import re
import shlex

GREEN = 'green'
AMBER = 'amber'
RED = 'red'

# ---------------------------------------------------------------------------
# RED — refused. Checked first, and against the whole command line.
# ---------------------------------------------------------------------------

RED_PATTERNS = [
    # Disks and volumes.
    (r'\bformat(\.com)?\b', 'formatting a drive'),
    (r'\bdiskpart\b', 'partitioning disks'),
    (r'\bconvert\s+[a-z]:\s', 'converting a filesystem'),
    (r'\bchkdsk\b.*\s/[frx]\b', 'repairing a volume in place'),
    # Boot and recovery.
    (r'\bbcdedit\b', 'boot configuration'),
    (r'\bbootrec\b', 'boot records'),
    (r'\bvssadmin\b.*\bdelete\b', 'deleting shadow copies'),
    (r'\bwbadmin\b.*\bdelete\b', 'deleting backups'),
    # Accounts and policy.
    (r'\bnet\s+(user|localgroup|group)\b', 'user accounts and groups'),
    (r'\bnew-localuser\b|\bremove-localuser\b', 'user accounts'),
    (r'\badd-localgroupmember\b', 'group membership'),
    (r'\bsecedit\b|\bgpupdate\b|\bgpedit\b', 'security policy'),
    (r'\bcipher\b.*\s/w', 'wiping free space'),
    # Turning the machine off under someone.
    (r'\bshutdown\b(?!.*\s/a\b)', 'shutting down or restarting'),
    (r'\brestart-computer\b|\bstop-computer\b', 'restarting the machine'),
    # Defender and firewall.
    (r'\bset-mppreference\b', 'Windows Defender settings'),
    (r'\badd-mppreference\b.*\bexclusionpath\b', 'Defender exclusions'),
    (r'\bnetsh\s+advfirewall\s+set\b', 'firewall policy'),
    # Registry deletes into policy territory.
    (r'\breg(\.exe)?\s+delete\b', 'deleting registry keys'),
    (r'\bremove-item\b.*\bhk(lm|cu):', 'deleting registry keys'),
    # Destroying system directories.
    (r'\b(rd|rmdir|del|erase)\b.*\b[a-z]:\\+(windows|program files)', 'deleting system files'),
    (r'\bremove-item\b.*\b[a-z]:\\+(windows|program files)', 'deleting system files'),
    (r'\bformat-volume\b', 'formatting a volume'),
    # Evasion. See the module docstring: these are not commands, they are ways
    # of not saying what the command is, and no classifier can see through them.
    (r'\b(iex|invoke-expression)\b', 'running a string as code, which cannot be inspected'),
    (r'-e(nc|ncoded|ncodedcommand)\b', 'a base64-encoded command, which cannot be inspected'),
    (r'\b(irm|iwr|invoke-webrequest|invoke-restmethod|curl|wget)\b[^|]*\|\s*(iex|invoke-expression|powershell|pwsh|cmd|bash|sh)\b',
     'piping a download straight into a shell'),
    (r'\bdownloadstring\b|\bdownloadfile\b.*\bstart-process\b', 'downloading and running code'),
    # No \b before the hyphen: a word boundary needs a word character on one
    # side, and " -verb" has none, so `\b-verb\b` never matches. The test caught
    # this — the pattern read correctly and matched nothing.
    (r'\bstart-process\b.*-verb\s+runas\b', 'self-elevation, which bypasses the daemon'),
    (r'\bschtasks\b.*\s/create\b', 'creating a scheduled task'),
    (r'\bsc(\.exe)?\s+(create|delete|config)\b', 'creating or changing a service'),
    (r'\bnew-service\b|\bset-service\b', 'creating or changing a service'),
]

# ---------------------------------------------------------------------------
# GREEN — reads. Program name, plus a subcommand where the program has both
# read and write modes.
# ---------------------------------------------------------------------------

GREEN_PROGRAMS = {
    # Inspecting the machine.
    'ipconfig', 'netsh', 'powercfg', 'tasklist', 'systeminfo', 'whoami',
    'hostname', 'netstat', 'ver', 'date', 'time', 'echo', 'where', 'which',
    'arp', 'route', 'nslookup', 'ping', 'tracert', 'pathping', 'getmac',
    'driverquery', 'wmic', 'query', 'set',
    # Reading files and finding things.
    'type', 'more', 'find', 'findstr', 'rg', 'ripgrep', 'fc', 'comp',
    'tree', 'dir', 'ls', 'certutil',
}

# Deliberately NOT in the set above: gcc, javac, python, node, make and the
# rest of the toolchain.
#
# They were, briefly, on the reasoning that "every dev task starts by asking a
# compiler its version". The tests caught what that actually meant: `gcc main.c`
# and `python build.py` classified GREEN and would have run arbitrary code with
# no confirmation and no record. A version probe is a read; a compiler is not,
# and the two are told apart by VERSION_FLAGS below, which is checked first —
# not by trusting the program's name.

# Programs above that are only GREEN for these subcommands or flags. Anything
# else they are asked to do falls through to AMBER.
GREEN_SUBCOMMANDS = {
    'git': {'status', 'log', 'diff', 'show', 'branch', 'remote', 'config',
            'rev-parse', 'describe', 'blame', 'ls-files', 'shortlog', 'tag',
            'stash', 'whatchanged', 'reflog', 'count-objects', 'version'},
    'npm': {'list', 'ls', 'view', 'outdated', 'why', 'root', 'prefix',
            'config', 'ping', 'whoami', 'version', 'audit'},
    'pnpm': {'list', 'ls', 'why', 'outdated', 'root', 'config'},
    'pip': {'list', 'show', 'freeze', 'check', 'download'},
    'dotnet': {'--info', '--list-sdks', '--list-runtimes', '--version'},
    'go': {'version', 'env', 'list', 'vet'},
    'cargo': {'version', 'tree', 'metadata', 'check'},
    'flutter': {'--version', 'doctor', 'devices', 'analyze'},
    'netsh': {'show', 'dump', 'interface', 'wlan', 'advfirewall'},
    'wmic': set(),   # read-only in practice; writes are caught by RED patterns
}

# Version and help flags make any known program GREEN — "javac -version" is a
# capability probe, not a compile, and every dev-workspace task begins with one.
VERSION_FLAGS = {'-v', '--version', '-version', '--help', '-h', '/?', 'version'}

# PowerShell cmdlets that only read. Verb-first, because PowerShell's naming
# convention is the most reliable signal it has: Get-, Test-, Measure- and
# friends do not change state, by the language's own guidelines.
GREEN_PS_VERBS = {
    'get', 'test', 'measure', 'select', 'where', 'compare', 'format',
    'out', 'sort', 'group', 'convertfrom', 'convertto', 'resolve', 'show',
}

# ---------------------------------------------------------------------------
# AMBER — changes something, recoverably. Named so the confirmation card can
# say what is about to happen rather than echoing a command line.
# ---------------------------------------------------------------------------

AMBER_DESCRIPTIONS = [
    (r'\bgit\s+(commit|push|pull|merge|rebase|checkout|switch|reset|clean|init|clone|add|tag\s+-)', 'change a git repository'),
    (r'\b(npm|pnpm|yarn)\s+(install|i|add|remove|uninstall|update|ci|run|exec|link)', 'install or run package scripts'),
    (r'\bpip\s+(install|uninstall)', 'install Python packages'),
    (r'\b(gcc|g\+\+|clang|javac|msbuild|cmake|make|cargo\s+build|go\s+build|dotnet\s+build)', 'compile code'),
    (r'\b(mkdir|md|copy|xcopy|robocopy|move|ren|rename)\b', 'create or move files'),
    (r'\b(new-item|copy-item|move-item|rename-item|set-content|add-content|out-file)\b', 'create or change files'),
    (r'\bcompress-archive\b|\bexpand-archive\b|\btar\b', 'archive or extract files'),
    (r'\bsetenv\b|\bsetx\b|\[environment\]::setenvironmentvariable', 'set an environment variable'),
    (r'\b(del|erase|rm|remove-item)\b', 'delete files'),
    (r'\b(stop-process|taskkill)\b', 'end a process'),
    (r'\bpython\b|\bnode\b|\bdart\b|\bruby\b', 'run a program'),
]


class CommandRefused(PermissionError):
    """A RED command, or a policy the daemon will not cross."""


def _flag(name: str) -> bool:
    return os.environ.get(name, '').strip().lower() == 'true'


def _flatten(command) -> str:
    """The whole command as one lowercase string, for pattern matching."""
    if isinstance(command, str):
        return command.lower()
    return ' '.join(str(part) for part in command).lower()


def _program(command) -> str:
    """The executable name, without a path or extension."""
    if isinstance(command, str):
        parts = shlex.split(command, posix=False) or ['']
        first = parts[0]
    else:
        first = str(command[0]) if command else ''
    base = os.path.basename(first.strip('"')).lower()
    for extension in ('.exe', '.cmd', '.bat', '.com', '.ps1'):
        if base.endswith(extension):
            base = base[: -len(extension)]
    return base


def _arguments(command) -> list:
    if isinstance(command, str):
        return [a.lower() for a in shlex.split(command, posix=False)[1:]]
    return [str(a).lower() for a in command[1:]]


def _is_shell(program: str) -> bool:
    return program in ('powershell', 'pwsh', 'cmd', 'bash', 'sh', 'wsl')


def _powershell_band(flat: str) -> str:
    """
    Classify a PowerShell command by the cmdlets it names.

    Every cmdlet mentioned must be a reading verb for the whole line to be
    GREEN. One `Remove-Item` in a pipeline of `Get-`s makes the line a delete,
    and it is the delete that matters.
    """
    cmdlets = re.findall(r'\b([a-z]+)-[a-z]+\b', flat)
    if not cmdlets:
        # No cmdlet at all: an expression, a native command, or something being
        # deliberately unreadable. Not something to wave through.
        return AMBER
    return GREEN if all(verb in GREEN_PS_VERBS for verb in cmdlets) else AMBER


def classify(command) -> tuple:
    """
    Return `(band, reason)` for a command.

    `reason` is written to be shown to the owner on a confirmation card, so it
    says what the command will do rather than repeating the command.
    """
    flat = _flatten(command)
    program = _program(command)
    args = _arguments(command)

    # 1. RED first, and against the entire line. A dangerous fragment buried in
    #    a long pipeline is still dangerous, and checking the program name alone
    #    would miss every one of these.
    for pattern, what in RED_PATTERNS:
        if re.search(pattern, flat):
            return RED, what

    # 2. Version and help probes are reads whatever the program.
    if args and args[0] in VERSION_FLAGS:
        return GREEN, f'ask {program} its version'
    if len(args) == 1 and args[0] in VERSION_FLAGS:
        return GREEN, f'ask {program} its version'

    # 3. A shell: judge it by what it is being asked to run, not by its name.
    if _is_shell(program):
        if program in ('powershell', 'pwsh'):
            band = _powershell_band(flat)
            if band == GREEN:
                return GREEN, 'read system information through PowerShell'
        return _describe_amber(flat, 'run a shell command')

    # 4. A bare cmdlet, with no `powershell -Command` around it.
    #
    # `Get-FileHash file.exe` is not an executable and cannot be started by
    # CreateProcess at all, but a planner will write it that way because that is
    # how it is written everywhere else. Classifying by verb here means the band
    # does not depend on which of two equivalent phrasings the model chose —
    # which is what the conformance probe caught.
    if re.fullmatch(r'[a-z]+-[a-z]+', program):
        band = _powershell_band(flat)
        if band == GREEN:
            return GREEN, f'read through {program}'
        return _describe_amber(flat, f'run {program}')

    # 5. Programs with both read and write modes, judged on the subcommand.
    if program in GREEN_SUBCOMMANDS:
        subcommand = next((a for a in args if not a.startswith('-')), '')
        allowed = GREEN_SUBCOMMANDS[program]
        if not args or subcommand in allowed or (not allowed and args):
            return GREEN, f'read from {program}'
        return _describe_amber(flat, f'run {program} {subcommand}')

    # 6. Plain read-only programs.
    if program in GREEN_PROGRAMS:
        return GREEN, f'run {program}'

    # 7. Everything else. Unknown is AMBER — see the module docstring.
    return _describe_amber(flat, f'run {program or "a command"}')


def _describe_amber(flat: str, fallback: str) -> tuple:
    for pattern, what in AMBER_DESCRIPTIONS:
        if re.search(pattern, flat):
            return AMBER, what
    return AMBER, fallback


def guard(command) -> tuple:
    """
    Classify, and refuse outright if the band forbids running at all.

    Returns `(band, reason)` for anything that may proceed. The AMBER
    confirmation is the core's business — the Orchestrator raises the card —
    so it is not enforced here; what is enforced here is RED, which no amount
    of elevation or Full Access can talk its way past.
    """
    band, reason = classify(command)

    if band == RED and not _flag('DEX_ALLOW_SHELL_RED'):
        raise CommandRefused(
            f'Refused: this command would {reason}. That is the RED band — '
            'partitioning, accounts, boot configuration, services, Defender, '
            'shutting down, and anything that hides what it runs. Full Access '
            'does not reach it. Set DEX_ALLOW_SHELL_RED=true to make it '
            'possible; even then Dex will ask every time.'
        )

    return band, reason
