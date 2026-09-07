"""
SessionManager: Persistent browser session management for DEX.

Responsibilities:
- Connects to the user's existing browser over CDP when available.
- Starts the user's selected personal browser profile when needed.
- Prevents multi-process profile collisions via file-based locking.
- Recovers from browser process crashes and maintains persistent login states.
"""
from __future__ import annotations

import asyncio
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
    """Return the user's existing browser data directory.

    DEX previously created a separate Chrome profile here. That discarded the
    user's existing logins and caused a new blank browser window on each restart.
    """
    override = os.environ.get("DEX_BROWSER_USER_DATA_DIR", "").strip().strip('"')
    if override:
        profile_dir = Path(override).expanduser()
        profile_dir.mkdir(parents=True, exist_ok=True)
        return profile_dir

    selected_browser = browser_path
    if selected_browser is None and not os.environ.get("DEX_FORCE_PLAYWRIGHT_CHROMIUM"):
        selected_browser = find_browser_executable()
    family = _browser_family(selected_browser)
    local = _local_app_data()
    profile_dirs = {
        # Vivaldi's Windows installer uses `User` for the live profile on some
        # versions and `User Data` on others. Prefer the existing root that
        # contains Local State so saved sessions are never redirected to a new
        # empty profile.
        "vivaldi": [local / "Vivaldi" / "User", local / "Vivaldi" / "User Data"],
        "chrome": [local / "Google" / "Chrome" / "User Data"],
        "edge": [local / "Microsoft" / "Edge" / "User Data"],
    }
    if family in profile_dirs:
        profile_dir = _existing_data_dir(profile_dirs[family])
        profile_dir.mkdir(parents=True, exist_ok=True)
        return profile_dir

    # Only use an isolated profile when no supported installed browser exists.
    profile_dir = local / "DEX" / "browser-profile" / "user_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir


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


def _process_name_is_running(executable_path: str | None) -> bool:
    """Check for an existing browser process without modifying it."""
    if not executable_path or sys.platform != "win32":
        return False
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {Path(executable_path).name}", "/NH"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return Path(executable_path).name.lower() in result.stdout.lower()
    except (OSError, subprocess.SubprocessError):
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
    ):
        self.cdp_port = cdp_port
        self.cdp_url = f"http://127.0.0.1:{cdp_port}"
        force_playwright = bool(os.environ.get("DEX_FORCE_PLAYWRIGHT_CHROMIUM"))
        self._explicit_profile = profile_dir is not None
        self.browser_path = None if force_playwright or self._explicit_profile else find_browser_executable()
        self.browser_family = _browser_family(self.browser_path)
        self.profile_dir = Path(profile_dir) if profile_dir else get_user_profile_dir(self.browser_path)
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self.profile_name = os.environ.get("DEX_BROWSER_PROFILE", "Default").strip() or "Default"
        # Explicit profile paths are used by tests/managed deployments. The normal
        # app path uses the user's real browser profile and attaches over CDP so Dex
        # does not own or close the user's browser process.
        self._use_personal_browser = profile_dir is None and self.browser_path is not None
        if headless is None:
            # Check environment variable, default to False (headed for user visibility & auth)
            self.headless = os.environ.get("DEX_BROWSER_HEADLESS", "").lower() in ("true", "1")
        else:
            self.headless = headless

        self.session_id = str(uuid.uuid4())[:8]
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self._browser: Browser | None = None
        self._is_cdp_attached = False
        self._lock = ProfileLock(self.profile_dir / "session.lock")
        self._browser_process: subprocess.Popen[bytes] | None = None
        self._personal_browser_startup_error: str | None = None
        self._shutting_down = False

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
                       If None or 'dex', uses the selected personal browser profile.
        """
        if self.is_connected:
            return self._context

        if not self._playwright:
            self._playwright = await async_playwright().start()

        want_mode_b = mode_hint in ("owner", "user", "b", MODE_B_USER_ATTACHED)

        # 1. Try to connect to an existing instance on the CDP port. Only attach
        # when it is the browser family Dex selected; this prevents an old Chrome
        # process on port 9222 from hijacking the user's Vivaldi session.
        cdp_info = await self._get_cdp_version()
        if cdp_info and self._cdp_matches_selected_browser(cdp_info):
            try:
                return await self._attach_to_cdp()
            except Exception as err:
                log.warning(f"Failed to connect to existing CDP endpoint: {err}. Launching new session.")
        elif cdp_info:
            log.warning(
                "Ignoring the existing CDP endpoint because it is not the selected "
                f"browser ({self.browser_family or 'configured browser'})."
            )

        # If Mode B was explicitly requested but CDP is not available, fail clearly.
        if want_mode_b:
            raise RuntimeError(
                f"[{MODE_B_USER_ATTACHED}] The user's browser is not attachable via CDP on port {self.cdp_port}. "
                f"Start {self.browser_family or 'your browser'} with "
                f"--remote-debugging-port={self.cdp_port}."
            )

        # 2. Acquire profile lock
        if not self._lock.acquire():
            log.warning(f"Profile at {self.profile_dir} appears locked. Checking if port is freed...")
            # If the process is alive and CDP wasn't responding, give it a moment
            await asyncio.sleep(1.0)
            cdp_info = await self._get_cdp_version()
            if cdp_info and self._cdp_matches_selected_browser(cdp_info):
                return await self._attach_to_cdp()
            raise RuntimeError(
                f"The {self.browser_family or 'browser'} profile is already in use and does not expose "
                f"CDP on port {self.cdp_port}. Close the browser once, then restart Dex so it can reopen "
                "the same personal profile."
            )

        # 3. Launch the selected browser. For the user's real profile, launch it
        # externally and attach over CDP so the browser survives Dex restarts and
        # remains the user's normal Vivaldi/Chrome session. Explicit test profiles
        # retain Playwright's isolated persistent-context behavior.
        if self._use_personal_browser:
            return await self._launch_personal_browser()

        log.info(f"[{MODE_A_PERSISTENT}] Launching isolated browser context using profile: {self.profile_dir} (headless={self.headless})")
        chrome_path = None if self._explicit_profile else find_system_chrome()

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

        if chrome_path and not os.environ.get("DEX_FORCE_PLAYWRIGHT_CHROMIUM"):
            kwargs["executable_path"] = chrome_path
            log.info(f"Using installed browser at: {chrome_path}")
        else:
            log.info("Using Playwright Chromium")

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
            return "vivaldi" in browser
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
        self._browser = await self._playwright.chromium.connect_over_cdp(self.cdp_url)
        contexts = self._browser.contexts
        self._context = contexts[0] if contexts else await self._browser.new_context()
        self._is_cdp_attached = True
        log.info(
            f"[{MODE_B_USER_ATTACHED}] Successfully attached to the user's "
            f"{self.browser_family or 'browser'} session."
        )
        return self._context

    async def _launch_personal_browser(self) -> BrowserContext:
        """Start the user's browser once, then connect without owning its lifetime."""
        if not self._playwright or not self.browser_path:
            self._lock.release()
            raise RuntimeError("No supported personal browser installation was found.")

        if self._personal_browser_startup_error:
            self._lock.release()
            raise RuntimeError(self._personal_browser_startup_error)

        if _process_name_is_running(self.browser_path):
            browser_name = self.browser_family or "personal browser"
            self._personal_browser_startup_error = (
                f"{browser_name.title()} is already open without a CDP connection. "
                f"Close all {browser_name.title()} windows once, then restart Dex; "
                f"Dex will reopen the same {browser_name.title()} profile with your saved logins."
            )
            self._lock.release()
            raise RuntimeError(self._personal_browser_startup_error)

        launch_args = [
            self.browser_path,
            f"--user-data-dir={self.profile_dir}",
            f"--profile-directory={self.profile_name}",
            f"--remote-debugging-port={self.cdp_port}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-infobars",
        ]
        if self.headless:
            launch_args.append("--headless=new")

        log.info(
            f"[{MODE_A_PERSISTENT}] Starting {self.browser_family or 'personal browser'} "
            f"with the user's profile: {self.profile_dir}"
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
        """Keep one initial blank page, but never accumulate startup tabs."""
        if not self._context:
            return
        blank_urls = {"about:blank", "chrome://newtab/", "vivaldi://newtab/", "edge://newtab/"}
        blank_pages = [page for page in self._context.pages if page.url.lower() in blank_urls]
        for page in blank_pages[1:]:
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
        return await self.initialize()

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
            # A personal browser launched by Dex is intentionally left running;
            # CDP attachment lets the next Dex run reuse it without reopening a
            # new profile or tab. The process handle is only bookkeeping here.
            self._browser_process = None
            self._lock.release()

        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        log.info("Browser session closed and lock released.")
