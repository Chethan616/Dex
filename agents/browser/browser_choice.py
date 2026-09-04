"""
Which browser to drive, and where its profile lives.

Two things the browser agent could not do, and they turn out to be the same
change.

**Use a named browser.** `BrowserSession(headless=...)` and nothing else meant
Playwright's own bundled Chromium, always. Asked to "open Vivaldi and go to
instagram", Dex had no way to honour the first half. The installed
`browser_use` accepts `executable_path`, so the fix is to resolve the name to a
path — and the resolver for that already exists in the daemon, doing exactly
the five-step search Windows itself does. Nothing here hardcodes a browser: a
name that is not installed fails saying so, and a new Chromium browser works on
the day it is installed.

**Stay signed in.** Playwright's default is a fresh profile every launch, so
every task started logged out of everything. That is why "message myself on
Instagram" could not work: there was no session, and Dex will not type a
password to make one. A persistent profile directory fixes it — sign in once,
by hand, in Dex's window, and it is still signed in tomorrow.

The profile is **Dex's own**, deliberately not the owner's real browser
profile. Pointing at their live Vivaldi would mean Dex driving a browser
already logged into their bank and their email, where a page it reads could try
to steer it. Its own profile contains only what was signed into for Dex to use,
which is a blast radius the owner chooses one site at a time.
"""
from __future__ import annotations

import logging
import json
import os
import sys
from pathlib import Path

log = logging.getLogger('BrowserChoice')

# Chromium-family only. Playwright drives these through CDP; Firefox and Safari
# speak different protocols and would fail in a confusing way partway through a
# task rather than at the start.
CHROMIUM_FAMILY = {
    'chrome', 'chromium', 'msedge', 'edge', 'brave', 'vivaldi', 'opera',
    'operagx', 'arc', 'thorium', 'ungoogled-chromium',
}

NOT_CHROMIUM = {
    'firefox': 'Firefox',
    'librewolf': 'LibreWolf',
    'safari': 'Safari',
    'waterfox': 'Waterfox',
    'zen': 'Zen',
}


def profile_dir(browser: str | None = None) -> str:
    """
    Dex's own browser profile, one per browser.

    Beside the logs and the settings, in %LOCALAPPDATA%\\DEX, so everything Dex
    keeps about itself is in one place the owner can inspect or delete.

    **One directory per browser, not one overall.** Chromium allows a single
    process per profile directory, so a Chromium session holding this path made
    a later Vivaldi launch sit on the lock until it timed out — the "open
    vivaldi and go to instagram" failure, which took a minute and forty seconds
    to say nothing useful.

    Separate directories also mean Dex's Vivaldi and the owner's Vivaldi are
    different processes with different profiles, so both run at once and Dex is
    signed in only to what the owner signed *Dex* into.
    """
    base = os.environ.get('LOCALAPPDATA') or os.environ.get('USERPROFILE') or '.'
    path = Path(base) / 'DEX' / 'browser-profile' / _profile_leaf(browser)
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _profile_leaf(browser: str | None) -> str:
    """
    A directory name from a browser name.

    `default` for Playwright's own Chromium. Anything else is reduced to safe
    characters, because the name reaches here from a plan and could be a path.
    """
    name = (browser or '').strip().lower()
    if not name:
        return 'default'
    if os.path.sep in name or name.endswith('.exe'):
        name = Path(name).stem
    safe = ''.join(c if c.isalnum() else '-' for c in name).strip('-')
    return safe or 'default'


def resolve(name: str | None) -> str | None:
    """
    A browser name to an executable path, or None for Playwright's own.

    Accepts a path directly, so an unusual install can be named exactly. Raises
    for a browser that exists but cannot be driven, because "Firefox is not
    something Dex can drive" is a better answer than silently using Chromium
    and reporting success.
    """
    if not name:
        return None

    wanted = str(name).strip()
    if not wanted:
        return None

    # An explicit path wins, and is checked rather than trusted.
    if os.path.sep in wanted or wanted.lower().endswith('.exe'):
        if os.path.exists(wanted):
            return wanted
        raise ValueError(f'No browser at {wanted}')

    key = wanted.lower().replace(' ', '').replace('-', '')
    if key in NOT_CHROMIUM:
        raise ValueError(
            f'Dex drives Chromium-based browsers. {NOT_CHROMIUM[key]} uses a '
            'different automation protocol. Chrome, Edge, Vivaldi, Brave and '
            'Opera all work.'
        )

    path = _find(wanted)
    if path is None:
        raise ValueError(
            f'{wanted} does not appear to be installed. Dex looked in the App '
            'Paths registry, on PATH, and in the Start Menu.'
        )

    if key not in CHROMIUM_FAMILY:
        # Found, but unknown. Say so and use it: the family list is a
        # convenience, not a permission, and refusing something the owner
        # installed on the grounds that it is not on a list is unhelpful.
        log.info('%s is not a browser Dex knows; trying it as Chromium.', wanted)

    return path


def _find(name: str) -> str | None:
    """
    The daemon's resolver, reused.

    Imported lazily and by path because this process is an agent, not the
    daemon, and the two are separate services that happen to live in one tree.
    A duplicate copy of the App Paths search here would be a second answer to
    "where is Vivaldi", and this project has been bitten by second answers.
    """
    daemon = Path(__file__).resolve().parents[2] / 'daemon'
    if str(daemon) not in sys.path:
        sys.path.insert(0, str(daemon))

    try:
        from handlers import app_resolver  # type: ignore
    except Exception as exc:  # noqa: BLE001
        log.debug('resolver unavailable: %s', exc)
        return None

    try:
        found = app_resolver.resolve(name)
    except Exception:  # noqa: BLE001 - AppNotFound, and anything else
        return None

    # A Store app or a shell protocol has no executable Playwright can launch.
    if found.is_shell or not os.path.exists(found.target):
        return None
    return found.target


def extension_dir() -> str:
    """The forked OpenDia extension, in this checkout."""
    return str(Path(__file__).resolve().parents[2] / 'extension')


def owner_profiles() -> list[dict]:
    """
    The owner's real Chrome profiles, from Chrome's own index.

    Read rather than guessed: the folder is `Profile 1` or `Profile 3` with no
    relation to the name on it, and only `Local State` knows which is which.
    """
    base = Path(os.environ.get('LOCALAPPDATA', '')) / 'Google' / 'Chrome' / 'User Data'
    state = base / 'Local State'
    if not state.exists():
        return []

    try:
        data = json.loads(state.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []

    cache = data.get('profile', {}).get('info_cache', {})
    last = data.get('profile', {}).get('last_used', '')

    return [
        {
            'directory': folder,
            'name': meta.get('name', folder),
            'email': meta.get('user_name', ''),
            'user_data_dir': str(base),
            'last_used': folder == last,
        }
        for folder, meta in cache.items()
    ]


def owner_profile(match: str = '') -> dict | None:
    """
    One of the owner's own profiles, by name, email or folder.

    Empty picks whichever Chrome used last, which is the one they were in.
    """
    profiles = owner_profiles()
    if not profiles:
        return None

    wanted = match.strip().lower()
    if not wanted:
        for profile in profiles:
            if profile['last_used']:
                return profile
        return profiles[0]

    for profile in profiles:
        if wanted in (
            profile['name'].lower(),
            profile['email'].lower(),
            profile['directory'].lower(),
        ):
            return profile

    # A partial name, because "chethankrishna" should find "Chethankrishna".
    for profile in profiles:
        if wanted in profile['name'].lower() or wanted in profile['email'].lower():
            return profile
    return None


def prepare_profile(browser: str | None = None) -> dict:
    """
    Make Dex's profile behave like a browser somebody actually uses.

    Two settings, and the reason is the same for both: this profile is where
    the owner signs in to Instagram, GitHub, VTOP and their bank so that Dex
    can act as them. A profile that forgets a login every session turns every
    task into a hand-off, which is exactly what signing in was meant to stop.

        credentials_enable_service     offer to save passwords
        password_manager_leak_detection off — it sends a hash of every password
                                        typed here to Google, and this profile
                                        exists to be automated. That is not a
                                        trade the owner agreed to.

    Cookies are what actually keep a session, and those were already being
    thrown away for a different reason: `--user-data-dir` was passed as a
    launch argument, which browser_use ignores, so every session ran in a fresh
    temp directory. That is fixed in `session_kwargs`; this is the rest of it.

    Chrome writes Preferences on exit, so anything set here while it is running
    is overwritten. Callers do this before launching.
    """
    prefs_file = Path(profile_dir(browser)) / 'Default' / 'Preferences'
    if not prefs_file.exists():
        return {'ok': False, 'reason': 'the profile has not been used yet'}

    try:
        data = json.loads(prefs_file.read_text(encoding='utf-8'))

        extensions = data.setdefault('extensions', {})
        extensions.setdefault('ui', {})['developer_mode'] = True

        # Save passwords, and offer to.
        data['credentials_enable_service'] = True
        data['credentials_enable_autosignin'] = True
        profile = data.setdefault('profile', {})
        profile['password_manager_enabled'] = True

        # Not the leak check. It hashes every password typed in this profile
        # and sends it to Google; a profile that exists to be driven by an
        # assistant should not be doing that quietly.
        data.setdefault('profile', {})['password_manager_leak_detection'] = False

        prefs_file.write_text(json.dumps(data), encoding='utf-8')
        return {'ok': True, 'developer_mode': True, 'passwords': True}
    except (OSError, ValueError) as err:
        return {'ok': False, 'reason': str(err)}


def enable_developer_mode(browser: str | None = None) -> bool:
    """
    Turn on Developer mode in Dex's profile, so loading the extension is one
    click rather than a settings hunt.

    Chrome keeps this in the profile's Preferences as an ordinary boolean. It
    is not one of the hash-protected values, so writing it is safe — unlike
    forging an extension entry, which Chrome detects and disables.

    Returns False when there is no profile yet: Chrome writes Preferences on
    first run, so this is called after the profile has been used at least once.
    """
    prefs = Path(profile_dir(browser)) / 'Default' / 'Preferences'
    if not prefs.exists():
        return False

    try:
        data = json.loads(prefs.read_text(encoding='utf-8'))
        data.setdefault('extensions', {}).setdefault('ui', {})['developer_mode'] = True
        prefs.write_text(json.dumps(data), encoding='utf-8')
        return True
    except (OSError, ValueError):
        return False


def open_owner_browser(profile_match: str | None = None, url: str = '') -> dict:
    """
    Open the owner's own Chrome, in their own profile.

    Not Dex's profile: the extension is installed in theirs and the session is
    theirs. Nothing is automated — this launches a window and returns, and the
    extension inside it dials Dex on its own.

    Chromium allows one process per profile directory, so if their Chrome is
    already running this hands the request to that instance and it opens a tab
    there. That is the behaviour wanted: a second window in the same profile is
    fine, a second *process* is what fails.
    """
    import subprocess

    executable = resolve('chrome')
    if executable is None:
        return {'ok': False, 'error': 'Chrome is not installed, or Dex cannot find it.'}

    profile = owner_profile(profile_match or '')
    if profile is None:
        return {
            'ok': False,
            'error': (
                'No Chrome profile could be found. Chrome keeps them under '
                'AppData\\Local\\Google\\Chrome\\User Data.'
            ),
        }

    args = [
        executable,
        f'--profile-directory={profile["directory"]}',
        '--no-first-run',
        '--no-default-browser-check',
    ]
    if url:
        args.append(url)

    try:
        subprocess.Popen(
            args,
            creationflags=(
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                if os.name == 'nt' else 0
            ),
            close_fds=True,
        )
    except OSError as err:
        return {'ok': False, 'error': str(err)}

    return {
        'ok': True,
        'profile': profile['name'],
        'email': profile['email'],
        'directory': profile['directory'],
        'detail': f'Opened Chrome as {profile["name"]}.',
    }


def open_profile(browser: str | None = None, url: str = '') -> dict:
    """
    Open Dex's own browser profile, for the owner to sign in with.

    The gap this fills: Dex keeps a separate profile so its browsing cannot
    touch the owner's session, which is right, and it means Dex is signed in to
    nothing. Every task behind a login then hits the hand-off — Dex stops, the
    owner types the password, Dex resumes — once per site per session. Doing
    that on VTOP, on Gmail and on a bank is three interruptions to answer one
    question.

    Signing in *once*, in this profile, fixes all of them at once. It is the
    owner's choice to make: this profile is where Dex browses, so an account
    signed in here is an account Dex can act as.

    Deliberately not headless and deliberately not driven. This launches a
    browser and walks away — no automation attaches, nothing is typed, and Dex
    never sees the password. The owner signs in the way they would anywhere
    else, closes the window, and the cookies are there for the next task.

    Refuses to launch while Dex is using the profile: Chromium allows one
    process per profile directory, so a second launch would sit on the lock and
    then fail with something that says nothing about why.
    """
    import subprocess

    executable = resolve(browser)
    if executable is None and browser:
        return {
            'ok': False,
            'error': f'{browser} is not installed, or Dex cannot find it.',
        }

    directory = profile_dir(browser)

    if executable is None:
        # Playwright's bundled Chromium. It has no stable path Dex should hard
        # code, so this is the one case where there is nothing to launch and
        # saying so beats guessing.
        return {
            'ok': False,
            'profile': directory,
            'error': (
                'That is Playwright\'s own Chromium, which has no window to open '
                'for signing in. Choose Chrome, Edge, Brave or Vivaldi instead.'
            ),
        }

    lock = Path(directory) / 'SingletonLock'
    if lock.exists():
        return {
            'ok': False,
            'profile': directory,
            'error': (
                'Dex is using that profile right now. Chromium allows one '
                'process per profile, so close what Dex has open and try again.'
            ),
        }

    # Developer mode on, and passwords remembered — done now, because Chrome
    # rewrites Preferences on exit and would undo anything written while it is
    # running.
    prepared = prepare_profile(browser)
    developer_mode = prepared.get('ok', False)

    args = [
        executable,
        f'--user-data-dir={directory}',
        '--no-first-run',
        '--no-default-browser-check',
        # Harmless where it is ignored, and it still works on Chromium builds
        # that have not removed it.
        f'--load-extension={extension_dir()}',
    ]
    if url:
        args.append(url)

    try:
        # Detached: this outlives the request, because the owner is going to
        # spend a few minutes in it.
        subprocess.Popen(
            args,
            creationflags=(
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                if os.name == 'nt' else 0
            ),
            close_fds=True,
        )
    except OSError as err:
        return {'ok': False, 'profile': directory, 'error': str(err)}

    return {
        'ok': True,
        'profile': directory,
        'browser': browser or 'chrome',
        'extension': extension_dir(),
        'developer_mode': developer_mode,
        'detail': (
            'Signed in here, Dex is signed in too — this is the profile it '
            'browses with. Close the window when you are done.'
        ),
        # Said rather than left for the owner to discover. Chrome 152 removed
        # command-line extension loading, so this is the one step Dex cannot
        # do for them.
        'extension_note': (
            'Chrome no longer lets a program install an extension, so load it '
            'once: chrome://extensions → Load unpacked → pick the folder '
            'above. Developer mode is already on.'
            if developer_mode else
            'To let Dex act in this browser, load the extension once from '
            'chrome://extensions → Developer mode → Load unpacked.'
        ),
    }


def session_kwargs(
    browser: str | None,
    headless: bool,
    owner_profile_match: str | None = None,
) -> dict:
    """
    What to hand `BrowserSession`, for a named browser with a kept profile.

    `--user-data-dir` rather than a Playwright persistent context: Dex launches
    a real browser binary, and that flag is how a real Chromium is told where
    its profile lives. The two remaining flags are not optional —
    `--no-first-run` suppresses the welcome tab that would otherwise be the
    page every task starts on, and `--no-default-browser-check` suppresses the
    modal that sits on top of it.
    """
    extension = extension_dir()

    # The owner's own Chrome — and the reason this is not the way to be them.
    #
    # It works, in the sense that Chrome starts. What it does not do is arrive
    # signed in. browser_use copies the profile to a temp directory rather than
    # driving the original ("Copied profile (Profile 1) and Local State to temp
    # directory"), which is the right call — it avoids corrupting a live
    # profile and the one-process-per-directory lock. But Chrome 127 added
    # App-Bound Encryption, which ties cookie decryption to the browser's own
    # identity precisely so that a copied profile cannot carry a session. That
    # is an anti-infostealer measure and Dex is not going to defeat it.
    #
    # Measured: with this pointed at the owner's real profile,
    # github.com/settings/profile redirects to the login page.
    #
    # So a browser that looks like theirs and is signed in to nothing is worse
    # than one that admits it — the owner would reasonably expect their
    # accounts. The way to act as them is the extension, driving the Chrome
    # they already have open, where the session is real and never copied. See
    # bridge.routing.
    #
    # Kept because it is still the right thing for a profile with nothing in
    # it, and because `open_profile` uses the same lookup to open their real
    # Chrome for them.
    if owner_profile_match is not None:
        profile = owner_profile(owner_profile_match)
        if profile is None:
            raise RuntimeError(
                'No Chrome profile of the owner could be found. Chrome keeps '
                'them under %LOCALAPPDATA%\\Google\\Chrome\\User Data.',
            )
        return {
            'headless': headless,
            'user_data_dir': profile['user_data_dir'],
            # A field, like user_data_dir. browser_use defaults it to
            # 'Default' and writes its own --profile-directory, so the one
            # passed in args was overwritten and Chrome opened an empty
            # profile — signed in to nothing, which is the opposite of the
            # point. Verified on the launched process both ways.
            'profile_directory': profile['directory'],
            'executable_path': resolve('chrome'),
            'args': [
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-blink-features=AutomationControlled',
            ],
        }

    kwargs: dict = {
        'headless': headless,
        # A field, not a flag.
        #
        # This was `--user-data-dir=…` in args, and browser_use ignored it and
        # launched into its own temp directory instead — verified on the live
        # process: `user-data-dir=…\Temp\browser-use-user-data-…`. So every
        # session started signed out, and the profile design was doing nothing.
        # Which is also why signing in to a site never seemed to stick.
        'user_data_dir': profile_dir(browser),
        'args': [
            '--no-first-run',
            '--no-default-browser-check',
            # The Dex extension, loaded every time Dex drives a browser itself.
            #
            # Playwright's Chromium still honours this switch. Chrome 152 does
            # not — Google removed `--load-extension` outright, and the
            # documented escape hatch
            # (--disable-features=DisableLoadExtensionCommandLineSwitch) is
            # gone with it. Verified on this machine: the extension attaches in
            # two seconds under Playwright's Chromium with all eighteen tools,
            # and Chrome registers zero extensions from the same flag.
            #
            # So this covers Dex's own browser. The owner's Chrome has to be
            # told once by hand, which is Chrome's decision rather than Dex's;
            # `open_profile` makes that one click.
            f'--load-extension={extension}',
            # Both, together. Chromium ignores --load-extension on its own in
            # an automated launch; the pair is what actually loads it, and was
            # what the working test used. Disabling everything else costs
            # nothing here because Dex's profile has nothing else.
            f'--disable-extensions-except={extension}',
            # Sites that check for automation see an ordinary browser.
            #
            # Not about evading detection for its own sake: this is the
            # owner's own signed-in session, and Instagram and GitHub degrade
            # or block a session that announces itself as automated — which
            # would break the thing they signed in for. It also stops Chrome
            # disabling its own password manager, which it does under the
            # automation flag.
            '--disable-blink-features=AutomationControlled',
        ],
    }

    executable = resolve(browser)
    if executable:
        kwargs['executable_path'] = executable

    return kwargs
