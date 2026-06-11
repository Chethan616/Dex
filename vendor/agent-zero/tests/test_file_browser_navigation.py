from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


from helpers.file_browser import FileBrowser


def read(*parts: str) -> str:
    return PROJECT_ROOT.joinpath(*parts).read_text(encoding="utf-8")


def test_file_browser_remember_last_directory_defaults_enabled() -> None:
    settings_source = read("helpers", "settings.py")

    assert "file_browser_remember_last_directory: bool" in settings_source
    assert "file_browser_remember_last_directory=get_default_value(" in settings_source
    assert '"file_browser_remember_last_directory",\n            True,' in settings_source


def test_file_browser_editable_path_bar_and_remembered_directory_contract() -> None:
    html = read("webui", "components", "modals", "file-browser", "file-browser.html")
    store = read("webui", "components", "modals", "file-browser", "file-browser-store.js")
    workdir_settings = read("webui", "components", "settings", "agent", "workdir.html")

    assert 'class="path-navigator"' in html
    assert 'x-model="$store.fileBrowser.pathInput"' in html
    assert '@submit.prevent="$store.fileBrowser.submitPath()"' in html
    assert "Go to directory" in html
    assert "$store.fileBrowser.pathError" in html

    assert "FILE_BROWSER_LAST_DIRECTORY_STORAGE_KEY" in store
    assert 'callJsonApi("settings_get", null)' in store
    assert "file_browser_remember_last_directory" in store
    assert "getRememberedDirectory()" in store
    assert "rememberCurrentDirectory(this.browser.currentPath)" in store
    assert "clearRememberedDirectory()" in store

    explicit_path_index = store.index("const explicitPath = this.normalizeOpeningPath")
    remembered_path_index = store.index("const rememberedPath = !explicitPath")
    assert explicit_path_index < remembered_path_index

    assert "Remember last file browser location" in workdir_settings
    assert "$store.settings.settings.file_browser_remember_last_directory" in workdir_settings


def test_file_browser_reports_missing_directory(tmp_path: Path) -> None:
    missing_directory = tmp_path / "missing"

    result = FileBrowser().get_files(str(missing_directory))

    assert result["entries"] == []
    assert result["current_path"] == str(missing_directory)
    assert result["error"] == "Directory not found"
