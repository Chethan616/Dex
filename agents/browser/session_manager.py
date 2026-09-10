"""
SessionManager: Persistent browser session management for DEX.

Responsibilities:
- Starts one DEX-owned persistent browser profile lazily for normal work.
- Connects to the user's existing browser over CDP only for explicit Mode B.
- Prevents multi-process profile collisions via file-based locking.
- Recovers from browser process crashes and maintains persistent login states.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

log = logging.getLogger("SessionManager")

DEFAULT_CDP_PORT = 9222
CDP_URL = f"http://127.0.0.1:{DEFAULT_CDP_PORT}"

# Browser attachment modes
MODE_A_PERSISTENT = "MODE_A_PERSISTENT"       # Start the selected personal browser profile
MODE_B_USER_ATTACHED = "MODE_B_USER_ATTACHED"  # Attach to the user's browser via CDP


def _local_app_data() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")


def _default_browser_family() -> str | None:
    """Return the Windows default browser family when it is available."""
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
        ) as key:
            prog_id = str(winreg.QueryValueEx(key, "ProgId")[0]).lower()
    except (FileNotFoundError, OSError):
        return None

    if "vivaldi" in prog_id:
        return "vivaldi"
    if "chrome" in prog_id:
        return "chrome"
    if "edge" in prog_id:
        return "edge"
    return None


def _browser_candidates() -> dict[str, list[Path]]:
    local = _local_app_data()
    program_files = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
    program_files_x86 = Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    return {
        "vivaldi": [
            local / "Vivaldi" / "Application" / "vivaldi.exe",
            program_files / "Vivaldi" / "Application" / "vivaldi.exe",
            program_files_x86 / "Vivaldi" / "Application" / "vivaldi.exe",
        ],
        "chrome": [
            program_files / "Google" / "Chrome" / "Application" / "chrome.exe",
            program_files_x86 / "Google" / "Chrome" / "Application" / "chrome.exe",
            local / "Google" / "Chrome" / "Application" / "chrome.exe",
        ],
        "edge": [
            program_files / "Microsoft" / "Edge" / "Application" / "msedge.exe",
            program_files_x86 / "Microsoft" / "Edge" / "Application" / "msedge.exe",
            local / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        ],
    }


def _browser_family(executable_path: str | Path | None) -> str | None:
    if not executable_path:
        return None
    name = Path(executable_path).name.lower()
    if name == "vivaldi.exe":
        return "vivaldi"
    if name == "chrome.exe":
        return "chrome"
    if name == "msedge.exe":
        return "edge"
    return None


def _existing_data_dir(candidates: list[Path]) -> Path:
    """Use the first real Chromium data root, with compatibility fallbacks."""
    for candidate in candidates:
        if (candidate / "Local State").is_file():
            return candidate
    return candidates[0]


def find_browser_executable() -> str | None:
    """Find the user's preferred installed Chromium browser."""
    override = os.environ.get("DEX_BROWSER_EXECUTABLE", "").strip().strip('"')
    if override and os.path.isfile(override):
        return override

    candidates = _browser_candidates()
    requested = os.environ.get("DEX_BROWSER", "").strip().lower()
    families: list[str] = []
    if requested in candidates:
        families.append(requested)
    default_family = _default_browser_family()
    if default_family and default_family not in families:
        families.append(default_family)
    # Vivaldi is the fallback for this Chromium-based setup, then Chrome/Edge.
    for fallback in ("vivaldi", "chrome", "edge"):
        if fallback not in families:
            families.append(fallback)

    for family in families:
        for path in candidates[family]:
            if path.is_file():
                return str(path)
    return None


def get_user_profile_dir(browser_path: str | Path | None = None) -> Path:
    """Return the single persistent profile owned by DEX.

    The default execution mode is deliberately isolated from the user's personal
    browser.  Personal-browser access is an explicit Mode B operation and is
    resolved separately by the CDP attachment path.
    """
    override = os.environ.get("DEX_BROWSER_USER_DATA_DIR", "").strip().strip('"')
    if override:
        profile_dir = Path(override).expanduser()
        return profile_dir

    local = _local_app_data()
    profile_dir = local / "DEX" / "browser-profile" / "profile"
    return profile_dir


def get_personal_profile_dir(browser_path: str | Path | None = None) -> Path:
    """Best-effort discovery of the user's existing Chromium profile for Mode B."""
    selected_browser = browser_path or find_browser_executable()
    family = _browser_family(selected_browser)
    local = _local_app_data()
    profile_dirs = {
        "vivaldi": [local / "Vivaldi" / "User", local / "Vivaldi" / "User Data"],
        "chrome": [local / "Google" / "Chrome" / "User Data"],
        "edge": [local / "Microsoft" / "Edge" / "User Data"],
    }
    if family in profile_dirs:
        profile_dir = _existing_data_dir(profile_dirs[family])
        return profile_dir
    return get_user_profile_dir(browser_path)


def get_downloads_dir() -> Path:
    """
    Standard user Downloads directory so downloaded files land naturally where users expect.
    """
    home = os.environ.get("USERPROFILE") or str(Path.home())
    downloads = Path(home) / "Downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    return downloads


def find_system_chrome() -> str | None:
    """Backward-compatible name for callers that need the preferred browser."""
    return find_browser_executable()


def _suppress_crash_restore_prompt(user_data_dir: Path, profile_name: str) -> None:
    """
    Make the profile think its last exit was clean, before every launch.

    The actual failure this exists for: DEX connects to the freshly launched
    browser's CDP endpoint fine — the websocket even completes its handshake
    — and then Playwright's connect_over_cdp hangs for the full 180s timeout
    anyway. The browser process is up and the debug port is listening, but
    its main thread is blocked showing a native "Vivaldi didn't shut down
    correctly — restore pages?" dialog, which any prior non-graceful close
    (a taskkill, a crash, DEX's own close_app step) leaves behind by writing
    exit_type != "Normal" into the profile's Preferences file. That dialog
    lives outside any page/renderer target, so no amount of retrying the CDP
    connection gets past it — only closing the dialog (or never showing it)
    does.

    Patching this file to always claim a clean exit is the standard
    workaround browser-automation tooling uses for exactly this. Best
    effort: a missing/unreadable/malformed Preferences file (first run, a
    profile from a browser this session's family-detection did not expect)
    should not block the launch attempt that follows.
    """
    prefs_path = user_data_dir / profile_name / "Preferences"
    if not prefs_path.is_file():
        return
    try:
        data = json.loads(prefs_path.read_text(encoding="utf-8"))
        profile = data.setdefault("profile", {})
        if profile.get("exit_type") != "Normal" or profile.get("exited_cleanly", True) is not True:
            profile["exit_type"] = "Normal"
            profile["exited_cleanly"] = True
            prefs_path.write_text(json.dumps(data), encoding="utf-8")
    except (OSError, ValueError, TypeError) as err:
        log.warning(f"Could not normalize {prefs_path} before launch: {err}")

    # Local State is the browser-wide (not per-profile) counterpart: a crash
    # streak that never resets tells Chromium's "Variations Safe Mode" this
    # install keeps crashing, which changes its own startup behavior. DEX's
    # own non-graceful shutdowns during earlier failed attempts (a timed-out
    # launch, a force-terminate on cleanup) are exactly what drives this
    # counter up — it was observed at 125 while diagnosing this. Reset
    # alongside the per-profile flag rather than left to keep climbing.
    local_state_path = user_data_dir / "Local State"
    if not local_state_path.is_file():
        return
    try:
        state = json.loads(local_state_path.read_text(encoding="utf-8"))
        stability = state.setdefault("user_experience_metrics", {}).setdefault("stability", {})
        changed = state.get("variations_crash_streak", 0) != 0
        state["variations_crash_streak"] = 0
        if stability.get("exited_cleanly") is not True:
            stability["exited_cleanly"] = True
            changed = True
        if changed:
            local_state_path.write_text(json.dumps(state), encoding="utf-8")
    except (OSError, ValueError, TypeError) as err:
        log.warning(f"Could not normalize {local_state_path} before launch: {err}")


def _kill_by_executable(executable_path: str | None) -> None:
    """
    Force-end every process running this exact executable — main window,
    renderer, GPU, crashpad-handler, all of it.

    Only called for a process that was already listening on our own CDP
    debug port and failed to complete an attach: that flag is what makes
    this safe. An ordinary browser window the owner is using is never
    listening on this port at all, so reaching this path already means the
    thing being killed is a DEX-launched debug instance from an earlier
    attempt, not live, unsaved work. Best-effort — a launch that follows
    this is what actually has to succeed, not this cleanup step.
    """
    if not executable_path or sys.platform != "win32":
        return
    try:
        subprocess.run(
            ["taskkill", "/IM", Path(executable_path).name, "/F", "/T"],
            capture_output=True,
            timeout=5,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as err:
        log.warning(f"Could not terminate stuck {executable_path}: {err}")


def _process_name_is_running(executable_path: str | None) -> bool:
    """
    Whether the browser genuinely has a visible window open right now.

    This used to be a bare "is a process with this image name in tasklist"
    check. That is wrong for any Chromium browser: renderer, GPU, utility,
    and crashpad-handler subprocesses all run under the exact same
    executable name and commonly linger for seconds — sometimes indefinitely,
    if "continue running background apps" is on — after every window the
    user can actually see is closed. The result was a false positive that
    made this check report "still open" even seconds after the user closed
    every window (or DEX itself closed and relaunched the app via
    SystemAgent), permanently blocking the exact retry the error message
    itself asked for. What actually determines whether a fresh launch will
    win Chromium's singleton hand-off is a real, visible top-level window —
    not a helper process sharing the binary's name — so that is what gets
    checked now.
    """
    if not executable_path or sys.platform != "win32":
        return False
    try:
        import psutil
        import win32gui
        import win32process

        target_name = Path(executable_path).name.lower()
        found = False

        def _callback(hwnd: int, _: None) -> bool:
            nonlocal found
            if not win32gui.IsWindowVisible(hwnd) or not win32gui.GetWindowText(hwnd):
                return True
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                if Path(psutil.Process(pid).exe()).name.lower() == target_name:
                    found = True
                    return False  # stop enumerating, one is enough
            except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
                pass
            return True

        win32gui.EnumWindows(_callback, None)
        return found
    except Exception:
        return False


class ProfileLock:
    """Simple cross-process file lock to prevent two processes from fighting over the profile."""

    def __init__(self, lock_path: Path):
        self.lock_path = lock_path
        self._acquired = False

    def acquire(self) -> bool:
        try:
            if self.lock_path.exists():
                try:
                    content = self.lock_path.read_text().strip()
                    pid = int(content) if content.isdigit() else None
                    if pid and not self._is_pid_alive(pid):
                        log.info(f"Removing stale lock from PID {pid}")
                        self.lock_path.unlink(missing_ok=True)
                except Exception:
                    pass
            # Atomic file creation
            with open(self.lock_path, "x") as f:
                f.write(str(os.getpid()))
            self._acquired = True
            return True
        except FileExistsError:
            return False

    def release(self) -> None:
        if self._acquired and self.lock_path.exists():
            try:
                self.lock_path.unlink(missing_ok=True)
            except Exception:
                pass
            self._acquired = False

    @staticmethod
    def _is_pid_alive(pid: int) -> bool:
        if sys.platform == "win32":
            import ctypes
            kernel32 = ctypes.windll.kernel32
            SYNCHRONIZE = 0x00100000
            process = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            if process:
                kernel32.CloseHandle(process)
                return True
            return False
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False


class SessionManager:
    def __init__(
        self,
        cdp_port: int = DEFAULT_CDP_PORT,
        profile_dir: Path | None = None,
        headless: bool | None = None,
        auto_launch_owner_browser: bool = False,
    ):
        # Spawning a real, visible browser process is a side effect real
        # enough that it must be opt-in, not implied by "CDP wasn't
        # reachable" alone — a test constructing a SessionManager directly
        # against an arbitrary port must never end up launching Vivaldi.
        # Only the actual server process (server.py) sets this True.
        self._auto_launch_owner_browser = auto_launch_owner_browser
        self.cdp_port = cdp_port
        self.cdp_url = f"http://127.0.0.1:{cdp_port}"
        self._explicit_profile = profile_dir is not None
        # Keep the installed browser identity available for explicit Mode B
        # diagnostics, but never launch it for ordinary DEX work.
        self.browser_path = None if self._explicit_profile else find_browser_executable()
        self.browser_family = _browser_family(self.browser_path)
        self.profile_dir = Path(profile_dir) if profile_dir else get_user_profile_dir(self.browser_path)
        self.profile_name = os.environ.get("DEX_BROWSER_PROFILE", "Default").strip() or "Default"
        # Mode A is always the DEX-owned profile.  Mode B attaches to the user's
        # already-running browser only when initialize(mode_hint="owner") is used.
        self._use_personal_browser = False
        if headless is None:
            configured = os.environ.get("DEX_BROWSER_HEADLESS", "").strip().lower()
            visible = os.environ.get("DEX_BROWSER_VISIBLE", "").strip().lower()
            self.headless = False if visible in ("true", "1", "yes") else configured not in ("false", "0", "no")
        else:
            self.headless = headless

        self.session_id = str(uuid.uuid4())[:8]
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self._browser: Browser | None = None
        self._is_cdp_attached = False
        self._lock = ProfileLock(self.profile_dir / "session.lock")
        self._browser_process: subprocess.Popen[bytes] | None = None
        self._shutting_down = False
        # Set only while a human-wall handoff has temporarily swapped Mode A
        # to a visible window — remembers what to return to afterward.
        self._headless_before_handoff: bool | None = None

    @property
    def context(self) -> BrowserContext:
        if not self._context:
            raise RuntimeError("Browser session is not active. Call initialize() first.")
        return self._context

    @property
    def is_connected(self) -> bool:
        if not self._context:
            return False
        try:
            if self._browser is not None and not self._browser.is_connected():
                return False
            # A context can be valid even when it has no tabs; TabManager creates
            # the task tab lazily instead of opening an empty tab at app startup.
            return True
        except Exception:
            return False

    async def initialize(self, mode_hint: str | None = None) -> BrowserContext:
        """
        Connects to an existing browser or launches persistent context.

        Args:
            mode_hint: If 'owner' or 'user', require Mode B (CDP attachment to the user's browser).
                       If Mode B is requested but unavailable, raises RuntimeError instead of
                       silently falling back — the caller must decide what to do.
                       If None or 'dex', uses the isolated DEX profile.
        """
        if self.is_connected:
            return self._context

        if not self._playwright:
            self._playwright = await async_playwright().start()

        # mode_hint=None means Mode A here, unchanged — this primitive has no
        # opinion on which mode a caller *should* default to; that product
        # decision belongs at the request-handling layer (server.py), which
        # is where DEX_BROWSER_DEFAULT_MODE is actually read. Every direct
        # caller of this class (including the whole test suite) relies on
        # unset meaning the isolated profile with no side effects.
        want_mode_b = mode_hint in ("owner", "user", "b", MODE_B_USER_ATTACHED)

        # Mode B attaches to the user's real browser, launching it once with
        # automation enabled if it is not already running that way. It must
        # never silently fall back to the isolated DEX profile — a caller
        # that asked for (or defaulted to) the owner's browser and can't get
        # it needs to know that, not be quietly handed a different session.
        if want_mode_b:
            cdp_info = await self._get_cdp_version()
            if cdp_info and self._cdp_matches_selected_browser(cdp_info):
                try:
                    return await self._attach_to_cdp()
                except Exception as err:
                    log.warning(f"Failed to connect to existing CDP endpoint: {err}")
                    # It answered /json/version (its debug HTTP server is up)
                    # but would not complete a real attach — a zombie left
                    # over from an earlier DEX-launched attempt (the debug
                    # flag itself is what tells us this is DEX's own child,
                    # not the owner's ordinary browsing session; an ordinary
                    # window is never listening on this port at all). Safe to
                    # replace rather than report as unattachable: killing it
                    # and launching fresh is exactly what the error message
                    # below used to ask the OWNER to do by hand.
                    if self._auto_launch_owner_browser:
                        _kill_by_executable(self.browser_path)
                        await asyncio.sleep(0.5)  # let window handles actually clear
                        return await self._launch_personal_browser()
            if not cdp_info and self._auto_launch_owner_browser:
                # Nothing is listening on the CDP port at all — safe to start
                # the browser ourselves. If it's already running without CDP,
                # _launch_personal_browser refuses rather than killing a live
                # session with unsaved tabs; the caller must close it first.
                return await self._launch_personal_browser()
            raise RuntimeError(
                f"[{MODE_B_USER_ATTACHED}] The user's browser is not attachable via CDP on port {self.cdp_port}. "
                f"Start {self.browser_family or 'your browser'} with "
                f"--remote-debugging-port={self.cdp_port}."
            )

        # 2. Acquire profile lock
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        if not self._lock.acquire():
            log.warning(f"Profile at {self.profile_dir} appears locked. Checking if port is freed...")
            raise RuntimeError(
                f"The DEX browser profile is already in use and does not expose CDP. "
                "Stop the other DEX browser process before retrying."
            )

        log.info(f"[{MODE_A_PERSISTENT}] Launching isolated browser context using profile: {self.profile_dir} (headless={self.headless})")
        # Playwright's managed Chromium keeps Mode A independent from Vivaldi,
        # Chrome, and Edge.  The profile remains stable across DEX restarts.
        chrome_path = None

        launch_args = [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-infobars",
        ]

        kwargs: dict[str, Any] = {
            "user_data_dir": str(self.profile_dir),
            "headless": self.headless,
            "args": launch_args,
            "viewport": {"width": 1280, "height": 800},
            "accept_downloads": True,
            "downloads_path": str(get_downloads_dir()),
        }

        log.info("Using Playwright Chromium for the isolated DEX profile")

        try:
            self._context = await self._playwright.chromium.launch_persistent_context(**kwargs)
            self._is_cdp_attached = False
            await self._trim_startup_blank_pages()
            log.info("Persistent browser context started successfully.")
            return self._context
        except Exception as err:
            self._lock.release()
            log.error(f"Failed to launch persistent context: {err}")
            raise

    async def _get_cdp_version(self) -> dict[str, Any] | None:
        """Read the CDP version payload without changing the browser session."""
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                res = await client.get(f"{self.cdp_url}/json/version")
                if res.status_code != 200:
                    return None
                payload = res.json()
                return payload if isinstance(payload, dict) else None
        except Exception:
            return None

    async def _is_cdp_available(self) -> bool:
        """Check if CDP endpoint answers version query."""
        return await self._get_cdp_version() is not None

    def _cdp_matches_selected_browser(self, payload: dict[str, Any]) -> bool:
        if not self.browser_family:
            return True
        browser = str(payload.get("Browser", "")).lower()
        if self.browser_family == "vivaldi":
            # Vivaldi 8.x reports its CDP product as Chrome even though the
            # executable/profile are Vivaldi. Do not reject the connection Dex
            # started on its own private CDP port.
            return "vivaldi" in browser or ("chrome" in browser and "edg" not in browser)
        if self.browser_family == "chrome":
            return "chrome" in browser and "vivaldi" not in browser
        if self.browser_family == "edge":
            return "edge" in browser
        return True

    async def _attach_to_cdp(self) -> BrowserContext:
        if not self._playwright:
            raise RuntimeError("Playwright is not running.")
        log.info(
            f"[{MODE_B_USER_ATTACHED}] Connecting to the selected browser on "
            f"{self.cdp_url} via CDP..."
        )
        # Playwright's own default here is 180_000ms. Left at that default, a
        # browser whose main thread is stuck (the crash-restore dialog this
        # file now suppresses before every launch, or anything else that can
        # block it) leaves the owner watching "acting" for three minutes
        # before anything is reported at all. 20s is already generous for a
        # local loopback CDP handshake that is actually healthy.
        self._browser = await self._playwright.chromium.connect_over_cdp(self.cdp_url, timeout=20_000)
        contexts = self._browser.contexts
        self._context = contexts[0] if contexts else await self._browser.new_context()
        self.profile_dir = get_personal_profile_dir(self.browser_path)
        self._is_cdp_attached = True
        log.info(
            f"[{MODE_B_USER_ATTACHED}] Successfully attached to the user's "
            f"{self.browser_family or 'browser'} session."
        )
        return self._context

    async def _launch_personal_browser(self) -> BrowserContext:
        """
        Starts the user's REAL browser, pointed at their REAL profile
        directory (not DEX's isolated one), with automation enabled, then
        attaches over CDP. This is what makes "signed in on Instagram/YouTube
        in Vivaldi" mean the same thing for DEX without a second login: the
        profile directory holds those cookies already, so opening it here
        opens with them.
        """
        if not self._playwright or not self.browser_path:
            raise RuntimeError("No supported personal browser installation was found.")

        # Checked fresh on every call, not cached: this used to be latched into
        # self._personal_browser_startup_error the first time it happened and
        # never re-checked, so once a user hit this once, EVERY task for the
        # rest of the server process's life repeated the identical stale
        # error — even long after the user had actually closed the browser
        # like the message told them to. The live process-list check is cheap
        # (a tasklist call), so there is no reason not to just ask again.
        if _process_name_is_running(self.browser_path):
            browser_name = self.browser_family or "personal browser"
            raise RuntimeError(
                f"{browser_name.title()} is already open without a CDP connection. "
                f"Close all {browser_name.title()} windows once, then ask DEX to try again; "
                f"DEX will reopen the same {browser_name.title()} profile with your saved logins."
            )

        personal_profile = get_personal_profile_dir(self.browser_path)
        _suppress_crash_restore_prompt(personal_profile, self.profile_name)
        launch_args = [
            self.browser_path,
            f"--user-data-dir={personal_profile}",
            f"--profile-directory={self.profile_name}",
            f"--remote-debugging-port={self.cdp_port}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-infobars",
            "--disable-session-crashed-bubble",
            "--hide-crash-restore-bubble",
        ]
        if self.headless:
            launch_args.append("--headless=new")

        log.info(
            f"[{MODE_B_USER_ATTACHED}] Starting {self.browser_family or 'personal browser'} "
            f"with the user's real profile: {personal_profile}"
        )
        try:
            self._browser_process = subprocess.Popen(
                launch_args,
                cwd=str(Path(self.browser_path).parent),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            for _ in range(80):
                if self._browser_process.poll() is not None:
                    break
                payload = await self._get_cdp_version()
                if payload and self._cdp_matches_selected_browser(payload):
                    context = await self._attach_to_cdp()
                    await self._trim_startup_blank_pages()
                    log.info("Personal browser started and attached successfully.")
                    return context
                await asyncio.sleep(0.25)
        except Exception as err:
            log.error(f"Failed to start the personal browser: {err}")
            self._lock.release()
            raise

        if self._browser_process and self._browser_process.poll() is None:
            try:
                self._browser_process.terminate()
            except OSError:
                pass
        self._browser_process = None
        self._lock.release()
        raise RuntimeError(
            f"Could not connect to {self.browser_family or 'the personal browser'} on "
            f"CDP port {self.cdp_port}. If it was already open, close it fully once "
            "and restart Dex so it can launch the same profile with automation enabled."
        )

    async def _trim_startup_blank_pages(self) -> None:
        """Remove launch-created blank pages; task binding creates pages on demand."""
        if not self._context:
            return
        blank_urls = {"about:blank", "chrome://newtab/", "vivaldi://newtab/", "edge://newtab/"}
        blank_pages = [page for page in self._context.pages if page.url.lower() in blank_urls]
        for page in blank_pages:
            try:
                await page.close()
            except Exception:
                pass

    async def recover_or_restart(self) -> BrowserContext:
        """Called when browser disconnects or crashes unexpectedly."""
        log.warning("Initiating browser session recovery/restart...")
        try:
            await self.close(graceful=False)
        except Exception:
            pass
        await asyncio.sleep(1.0)
        return await self.initialize(mode_hint=None)

    async def close(self, graceful: bool = True) -> None:
        """Clean shutdown of session."""
        self._shutting_down = True
        try:
            if self._context and not self._is_cdp_attached:
                await self._context.close()
            elif self._browser and self._is_cdp_attached:
                # Disconnect from CDP rather than killing the user's running browser
                await self._browser.close()
        except Exception as e:
            log.debug(f"Error closing browser context: {e}")
        finally:
            self._context = None
            self._browser = None
            self._browser_process = None
            self._lock.release()

        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        log.info("Browser session closed and lock released.")

    async def relaunch_for_human_handoff(self) -> BrowserContext:
        """
        Mode A only: close the current (normally headless) context and
        reopen the exact same profile directory non-headlessly, so the
        owner can actually see and clear a login/CAPTCHA/Cloudflare wall
        detected by recovery.detect_human_wall(). Call
        resume_after_handoff() once it reports clear.

        Hard invariant: self.profile_dir is never touched here — close()
        and initialize() both operate on the one persistent profile this
        SessionManager already owns, so the owner's login carries straight
        back to the headless session that resumes afterward. Never a
        second profile.
        """
        if self._is_cdp_attached:
            raise RuntimeError(
                "relaunch_for_human_handoff is a Mode A operation — Mode B "
                "already shows the owner's real, visible browser."
            )
        self._headless_before_handoff = self.headless
        await self.close()
        self.headless = False
        log.info(f"[{MODE_A_PERSISTENT}] Relaunching {self.profile_dir} visibly for a human-wall handoff.")
        return await self.initialize(mode_hint=None)

    async def resume_after_handoff(self) -> BrowserContext:
        """The other half of relaunch_for_human_handoff: close the visible
        window and reopen the same profile in whatever headless state the
        session was in before the handoff started."""
        was_headless = self._headless_before_handoff
        self._headless_before_handoff = None
        await self.close()
        self.headless = True if was_headless is None else was_headless
        log.info(f"[{MODE_A_PERSISTENT}] Resuming {self.profile_dir} headlessly after handoff.")
        return await self.initialize(mode_hint=None)
