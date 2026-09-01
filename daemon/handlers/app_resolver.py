"""
Turning "chrome", "Microsoft Edge" or "spotify" into something Windows can start.

This exists because of a failure that looked like nothing at all:

    you> open chrome and logon to vtop.vit.ac.in
         SystemAgent could not complete the step:
         [WinError 2] The system cannot find the file specified

`WinError 2` is CreateProcess saying "that name is not on PATH". And it is not:

    chrome    PATH: NOT FOUND
    msedge    PATH: NOT FOUND
    notepad   PATH: C:\\WINDOWS\\system32\\notepad.exe

No browser installer puts itself on PATH. What they *do* register is an
**App Paths** key, and that is what `start chrome` reads. Dex never looked
there, so every application outside System32 was unopenable, and the message
said neither what was looked for nor where.

So this resolves the way Windows itself does, in the same order, and — just as
importantly — reports every place it looked when it fails. A resolver that
cannot say what it tried is how a one-line registry lookup became a mystery.

The PATH+PATHEXT walk here is the third copy in this repo, after
`core/settings/which.ts` and `ui/dex-bar/lib/core/supervisor/dex_paths.dart`.
Three languages, one algorithm; there is no way to share it across the process
boundary, so it is written out and labelled rather than quietly duplicated.
"""
from __future__ import annotations

import difflib
import os
import winreg
from dataclasses import dataclass, field

APP_PATHS_KEY = r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths'


@dataclass
class Resolution:
    """What to run, and how it was found."""

    target: str
    method: str
    """One of: known, app_paths, path, start_menu, shell_protocol, uwp, literal."""

    args: list = field(default_factory=list)
    """Extra arguments — the Start Menu route can carry a shortcut's own."""

    display: str = ''
    """The name a person would use for it, for the confirmation card."""

    @property
    def is_shell(self) -> bool:
        """True when this must go through the shell rather than CreateProcess."""
        return self.method in ('shell_protocol', 'uwp')


class AppNotFound(Exception):
    """
    Raised with the full account of where Dex looked.

    The message is the whole point. `WinError 2` told the owner nothing; this
    names each mechanism, how many candidates it held, and the nearest matches
    so a typo is obvious.
    """

    def __init__(self, name: str, tried: list, suggestions: list):
        self.name = name
        self.tried = tried
        self.suggestions = suggestions

        message = f'Could not find an application called "{name}".\nLooked in: ' + \
            '; '.join(tried) + '.'
        if suggestions:
            message += '\nClosest matches: ' + ', '.join(suggestions) + '.'
        else:
            message += '\nNothing on this machine has a similar name.'
        super().__init__(message)


def app_paths_lookup(name: str) -> str | None:
    """
    The App Paths registry key — how Windows resolves `start chrome`.

    HKCU first: a per-user install of an application shadows a machine-wide one,
    and running the machine copy when the owner installed their own is the kind
    of "worked, but not the thing you meant" that is hard to notice.

    The default value can be quoted and can carry environment variables, both of
    which appear in the wild.
    """
    stem = name if name.lower().endswith('.exe') else f'{name}.exe'

    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, f'{APP_PATHS_KEY}\\{stem}') as key:
                value, _ = winreg.QueryValueEx(key, '')
        except OSError:
            continue

        if not value:
            continue
        resolved = os.path.expandvars(str(value).strip().strip('"'))
        if os.path.isfile(resolved):
            return resolved
    return None


def path_lookup(name: str, env: dict | None = None) -> str | None:
    """PATH + PATHEXT, the way the shell searches. See the module docstring."""
    environment = env if env is not None else os.environ
    if os.path.dirname(name):
        return name if os.path.isfile(name) else None

    extensions = [
        e for e in environment.get('PATHEXT', '.COM;.EXE;.BAT;.CMD').split(';') if e
    ]
    has_extension = os.path.splitext(name)[1] != ''

    for directory in environment.get('PATH', '').split(os.pathsep):
        if not directory:
            continue
        base = os.path.join(directory, name)
        if has_extension and os.path.isfile(base):
            return base
        for extension in extensions:
            candidate = base + extension.lower()
            if os.path.isfile(candidate):
                return candidate
    return None


def start_menu_index() -> dict:
    """
    Every Start Menu shortcut, keyed by its display name.

    This is the step that understands "Microsoft Edge" — a display name, not an
    executable, and the form a person is most likely to say. Both trees are
    read, user first, for the same shadowing reason as App Paths.

    Shortcuts are returned as `.lnk` paths and started through the shell rather
    than resolved to their target: a shortcut carries its own arguments and
    working directory, and honouring them is the difference between launching
    an application and launching its updater.
    """
    roots = [
        os.path.join(
            os.environ.get('APPDATA', ''),
            r'Microsoft\Windows\Start Menu\Programs',
        ),
        os.path.join(
            os.environ.get('ProgramData', ''),
            r'Microsoft\Windows\Start Menu\Programs',
        ),
    ]

    index: dict = {}
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        for folder, _, files in os.walk(root):
            for filename in files:
                if not filename.lower().endswith(('.lnk', '.url')):
                    continue
                display = os.path.splitext(filename)[0]
                index.setdefault(display.lower(), (display, os.path.join(folder, filename)))
    return index


def uwp_index() -> dict:
    """
    Installed Store apps, keyed by display name, valued by AUMID.

    A packaged app has no executable to find — it is started through
    `shell:AppsFolder\\<AUMID>`. Enumerated through the shell's AppsFolder
    namespace rather than by shelling out to PowerShell's `Get-StartApps`,
    which would cost a process and a console window on every failed lookup.

    Returns empty when the COM interfaces are unavailable; this is the last
    resort in the chain and its absence must not break the ones before it.
    """
    try:
        import pythoncom  # noqa: F401
        from win32com.shell import shell, shellcon
    except ImportError:
        return {}

    APPS_FOLDER = '{4234d49b-0245-4df3-b780-3893943456e1}'
    index: dict = {}
    try:
        folder = shell.SHGetDesktopFolder().ParseDisplayName(
            0, None, f'shell:::{APPS_FOLDER}',
        )[1]
        apps = shell.SHGetDesktopFolder().BindToObject(
            folder, None, shell.IID_IShellFolder,
        )
        for item in apps.EnumObjects(0, shellcon.SHCONTF_NONFOLDERS):
            display = apps.GetDisplayNameOf(item, shellcon.SHGDN_NORMAL)
            aumid = apps.GetDisplayNameOf(item, shellcon.SHGDN_FORPARSING)
            if display and aumid:
                index.setdefault(display.lower(), (display, aumid))
    except Exception:  # noqa: BLE001 — an optional last resort, never fatal
        return {}
    return index


def resolve(name: str, known: dict | None = None) -> Resolution:
    """
    Find something to launch, or raise [AppNotFound] saying where we looked.

    Order matters and follows Windows' own: the curated map, then the registry
    Windows itself consults, then PATH, then what the Start Menu shows the
    owner, then packaged apps. Each step is cheaper and more certain than the
    one after it.
    """
    raw = name.strip()
    key = raw.lower()
    tried: list = []
    catalogue = known or {}

    # 0. Shell protocols pass straight through — "ms-settings:" is not a file.
    mapped = catalogue.get(key, raw)
    if mapped.endswith(':') or '://' in mapped:
        return Resolution(mapped, 'shell_protocol', display=raw)

    # 1. The curated map. Short, and covers what people say most.
    if key in catalogue:
        target = catalogue[key]
        resolved = app_paths_lookup(target) or path_lookup(target)
        if resolved:
            return Resolution(resolved, 'known', display=raw)
        # A mapped name that does not resolve keeps looking under its real
        # name rather than failing — "paint" maps to mspaint.exe, and if that
        # moved, the Start Menu still knows where it went.
        raw, key = target, target.lower()
    tried.append(f'known apps ({len(catalogue)})')

    # 2. App Paths — the registry key `start chrome` reads. Fixes browsers.
    resolved = app_paths_lookup(raw)
    if resolved:
        return Resolution(resolved, 'app_paths', display=raw)
    tried.append('App Paths registry')

    # 3. PATH.
    resolved = path_lookup(raw)
    if resolved:
        return Resolution(resolved, 'path', display=raw)
    tried.append('PATH')

    # 4. Start Menu display names — how "Microsoft Edge" is found.
    shortcuts = start_menu_index()
    hit = shortcuts.get(key) or _fuzzy_hit(key, shortcuts)
    if hit:
        display, target = hit
        return Resolution(target, 'start_menu', display=display)
    tried.append(f'Start Menu ({len(shortcuts)} shortcuts)')

    # 5. Packaged Store apps.
    packaged = uwp_index()
    hit = packaged.get(key) or _fuzzy_hit(key, packaged)
    if hit:
        display, aumid = hit
        return Resolution(f'shell:AppsFolder\\{aumid}', 'uwp', display=display)
    tried.append(f'Store apps ({len(packaged)})')

    raise AppNotFound(name, tried, _suggest(key, shortcuts, packaged, catalogue))


def _fuzzy_hit(key: str, index: dict):
    """
    A prefix or containment match, but only when it is unambiguous.

    "edge" should find "Microsoft Edge". "office" should not silently pick one
    of nine Office entries — with more than one candidate this returns nothing
    and lets the caller raise, listing them. Guessing between applications is
    exactly the class of mistake that opens the wrong thing and looks like it
    worked.
    """
    # An exact name wins outright. Without this, "Microsoft Word" is ambiguous
    # against "Microsoft WordPad" — both start with it — and asking for a
    # program by its exact name would refuse to find it.
    if key in index:
        return index[key]

    matches = [v for k, v in index.items() if k.startswith(key) or key in k]
    if len(matches) == 1:
        return matches[0]

    exact_word = [
        v for k, v in index.items() if key in k.replace('-', ' ').split()
    ]
    return exact_word[0] if len(exact_word) == 1 else None


def _suggest(key: str, shortcuts: dict, packaged: dict, catalogue: dict) -> list:
    """The nearest names, so an obvious typo reads as an obvious typo."""
    names = (
        [display for display, _ in shortcuts.values()]
        + [display for display, _ in packaged.values()]
        + list(catalogue.keys())
    )
    close = difflib.get_close_matches(key, [n.lower() for n in names], n=4, cutoff=0.55)

    seen, out = set(), []
    for match in close:
        for name in names:
            if name.lower() == match and name.lower() not in seen:
                seen.add(name.lower())
                out.append(name)
    return out
